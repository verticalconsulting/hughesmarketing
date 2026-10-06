import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { ConnectorError } from "@/lib/connectors/errors";
import { ga4Connector } from "@/lib/connectors/ga4";
import { gscConnector } from "@/lib/connectors/gsc";
import type { Connectors, MetricPointInput } from "@/lib/connectors/types";
import { db, type DbOrTx } from "@/lib/data/db";
import { integrations, metricPoints, planItems, plans, trackerCheckins, trackers } from "@/lib/data/schema";
import { SERVICE_LABELS } from "@/lib/domain/integrations";
import {
  aggregateWindow,
  defaultSyncDays,
  endOfDay,
  getMetric,
  MAX_DAYS,
  METRIC_SOURCES,
  parseTrackerSource,
  requiredMetrics,
  siteIdentifier,
  syncRange,
  windowRange,
  type MetricSource,
  type Series,
} from "@/lib/domain/metrics";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";
import { listIntegrations } from "./integrations";
import { addCheckin } from "./trackers";

export type SyncSourceResult = {
  source: MetricSource;
  status: "ok" | "error" | "skipped";
  rows: number;
  trackerCheckins: number;
  from?: string;
  to?: string;
  message?: string;
};

export const defaultConnectors: Connectors = { ga4: ga4Connector, gsc: gscConnector };
export const syncLockKey = (brandId: string, source: MetricSource) => `metrics:${brandId}:${source}`;

const BATCH = 500;
type Integration = typeof integrations.$inferSelect;
type SourceCtx = {
  brandId: string;
  source: MetricSource;
  integration: Integration | undefined;
  now: Date;
  days?: number;
  actor: Actor;
  connectors: Connectors;
};

export async function syncBrandMetrics(input: {
  brandSlug: string;
  source?: MetricSource;
  days?: number;
  actor: Actor;
  now?: Date;
  connectors?: Connectors;
}): Promise<SyncSourceResult[]> {
  if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DAYS)) {
    throw new ValidationError(`days must be a whole number between 1 and ${MAX_DAYS}`, "days");
  }
  if (input.source !== undefined && !METRIC_SOURCES.includes(input.source)) {
    throw new ValidationError(`source must be one of: ${METRIC_SOURCES.join(", ")}`, "source");
  }
  const brand = await getBrandBySlug(input.brandSlug);
  const rows = await listIntegrations(brand.id);
  const base = { brandId: brand.id, now: input.now ?? new Date(), days: input.days, actor: input.actor, connectors: input.connectors ?? defaultConnectors };
  const results: SyncSourceResult[] = [];
  for (const source of input.source ? [input.source] : METRIC_SOURCES) {
    try {
      results.push(await syncSource({ ...base, source, integration: rows.find((i) => i.service === source) }));
    } catch (e) {
      // One source crashing (a bug, a database error) must not block the other. Details stay in the server log.
      console.error(`metrics sync crashed for ${source}`, e);
      results.push({ source, status: "error", rows: 0, trackerCheckins: 0, message: "Unexpected error while syncing; see the server logs." });
    }
  }
  return results;
}

async function syncSource(c: SourceCtx): Promise<SyncSourceResult> {
  const label = SERVICE_LABELS[c.source];
  const skipped = (message: string): SyncSourceResult => ({ source: c.source, status: "skipped", rows: 0, trackerCheckins: 0, message });
  const integration = c.integration;
  if (!integration || integration.status !== "connected") return skipped(`${label} is not connected for this brand.`);
  const identifier = c.source === "ga4" ? integration.identifiers.property_id : siteIdentifier(integration.identifiers);
  if (!identifier?.trim()) return skipped(`${label} has no ${c.source === "ga4" ? "property_id" : "site_url"} set.`);

  // The advisory lock is transaction-scoped, so the whole sync runs in one transaction; it is released on commit.
  return db.transaction(async (tx): Promise<SyncSourceResult> => {
    const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${syncLockKey(c.brandId, c.source)})) as ok`);
    if (!lock[0]?.ok) return skipped(`A sync of ${label} is already running.`);

    const days = c.days ?? defaultSyncDays({ firstSync: integration.syncedFrom === null, lastSyncedAt: integration.lastSyncedAt, now: c.now });
    const { from, to } = syncRange(c.now, days);
    const activity = (summary: string) =>
      logActivity({ brandId: c.brandId, actor: c.actor, kind: "integration", summary, refType: "integration", refId: integration.id }, tx);
    try {
      const points = await c.connectors[c.source]({ identifiers: integration.identifiers, from, to });
      const rows = await upsertPoints(tx, c.brandId, c.source, points);
      const syncedFrom = integration.syncedFrom && integration.syncedFrom < from ? integration.syncedFrom : from;
      await tx.update(integrations).set({ lastSyncedAt: c.now, lastSyncError: null, syncedFrom }).where(eq(integrations.id, integration.id));
      const trackerCheckins = await feedTrackers(tx, { brandId: c.brandId, source: c.source, to, syncedFrom, now: c.now, actor: c.actor });
      const extra = trackerCheckins ? `, ${trackerCheckins} tracker check-in${trackerCheckins === 1 ? "" : "s"}` : "";
      await activity(`${label}: synced ${from} to ${to} (${rows} rows${extra})`);
      return { source: c.source, status: "ok", rows, trackerCheckins, from, to };
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
      await tx.update(integrations).set({ lastSyncError: e.message }).where(eq(integrations.id, integration.id));
      await activity(`${label}: sync failed (${e.message})`);
      return { source: c.source, status: "error", rows: 0, trackerCheckins: 0, from, to, message: e.message };
    }
  });
}

async function upsertPoints(tx: DbOrTx, brandId: string, source: MetricSource, points: MetricPointInput[]): Promise<number> {
  // ON CONFLICT cannot touch the same row twice in one statement, so collapse repeats first (last one wins).
  const unique = new Map<string, MetricPointInput>();
  for (const p of points) {
    if (!getMetric(source, p.metric) || !Number.isFinite(p.value)) continue;
    unique.set(`${p.metric}|${p.date}|${p.dimension}`, p);
  }
  const rows = [...unique.values()].map((p) => ({ brandId, source, metric: p.metric, date: p.date, dimension: p.dimension, value: p.value }));
  for (let i = 0; i < rows.length; i += BATCH) {
    await tx
      .insert(metricPoints)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [metricPoints.brandId, metricPoints.source, metricPoints.metric, metricPoints.date, metricPoints.dimension],
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      });
  }
  return rows.length;
}

async function feedTrackers(
  tx: DbOrTx,
  a: { brandId: string; source: MetricSource; to: string; syncedFrom: string; now: Date; actor: Actor },
): Promise<number> {
  const rows = await tx
    .select({ tracker: trackers })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(and(eq(plans.brandId, a.brandId), ilike(trackers.source, `${a.source}:%`)));
  const observedAt = endOfDay(a.to);
  let made = 0;
  for (const { tracker: t } of rows) {
    const parsed = parseTrackerSource(t.source);
    const def = parsed && parsed.source === a.source ? getMetric(parsed.source, parsed.metric) : undefined;
    if (!parsed || !def) continue;
    const win = windowRange(a.to, t.windowDays);
    // Only judge a window we have actually synced end to end.
    if (a.syncedFrom > win.from) continue;
    const autoSource = `${parsed.source}:${parsed.metric} (auto)`;
    const existing = await tx
      .select({ id: trackerCheckins.id })
      .from(trackerCheckins)
      .where(and(eq(trackerCheckins.trackerId, t.id), eq(trackerCheckins.source, autoSource), eq(trackerCheckins.observedAt, observedAt)))
      .limit(1);
    if (existing.length > 0) continue;
    const series = await getMetricSeries({ brandId: a.brandId, source: a.source, metrics: requiredMetrics(def), from: win.from, to: win.to }, tx);
    const value = aggregateWindow(def, series);
    if (value === null) continue;
    try {
      await addCheckin({ trackerId: t.id, value, observedAt, source: autoSource, note: `Automatic: ${win.from} to ${win.to}`, actor: a.actor, now: a.now });
      made++;
    } catch (e) {
      // A bad tracker must not fail the sync that already stored good data.
      console.error(`tracker ${t.id} auto check-in failed`, e);
    }
  }
  return made;
}

export async function getMetricSeries(
  input: { brandId: string; source: MetricSource; metrics: string[]; from: string; to: string },
  tx: DbOrTx = db,
): Promise<Record<string, Series>> {
  const out: Record<string, Series> = Object.fromEntries(input.metrics.map((m) => [m, [] as Series]));
  if (input.metrics.length === 0) return out;
  const rows = await tx
    .select({ metric: metricPoints.metric, date: metricPoints.date, value: metricPoints.value })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.brandId, input.brandId),
        eq(metricPoints.source, input.source),
        inArray(metricPoints.metric, input.metrics),
        eq(metricPoints.dimension, ""),
        gte(metricPoints.date, input.from),
        lte(metricPoints.date, input.to),
      ),
    )
    .orderBy(asc(metricPoints.date));
  for (const r of rows) out[r.metric].push({ date: r.date, value: r.value });
  return out;
}

export async function getTopDimension(
  input: { brandId: string; metric: "query_clicks" | "page_clicks"; from: string; to: string; limit?: number },
  tx: DbOrTx = db,
): Promise<{ label: string; clicks: number }[]> {
  const clicks = sql<number>`sum(${metricPoints.value})`;
  const rows = await tx
    .select({ dimension: metricPoints.dimension, clicks })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.brandId, input.brandId),
        eq(metricPoints.source, "gsc"),
        eq(metricPoints.metric, input.metric),
        gte(metricPoints.date, input.from),
        lte(metricPoints.date, input.to),
      ),
    )
    .groupBy(metricPoints.dimension)
    .orderBy(desc(clicks), asc(metricPoints.dimension))
    .limit(input.limit ?? 20);
  return rows.map((r) => ({ label: r.dimension.replace(/^(query|page):/, ""), clicks: Number(r.clicks) }));
}

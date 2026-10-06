import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser } from "../helpers/db";
import { ConnectorError, type ConnectorErrorCode } from "@/lib/connectors/errors";
import type { Connector, Connectors } from "@/lib/connectors/types";
import { db } from "@/lib/data/db";
import { metricPoints, trackerCheckins } from "@/lib/data/schema";
import { addDays } from "@/lib/domain/metrics";
import type { Actor } from "@/lib/services/actor";
import { listActivity } from "@/lib/services/activity";
import { createBrand, getBrandBySlug } from "@/lib/services/brands";
import { ValidationError } from "@/lib/services/errors";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";
import { getMetricSeries, getTopDimension, syncBrandMetrics, syncLockKey } from "@/lib/services/metrics";
import { createPlanVersion, getActivePlan, updatePlanItem } from "@/lib/services/plans";
import { listTrackers } from "@/lib/services/trackers";

const NOW = new Date("2026-10-05T12:00:00Z");
let sessionsPerDay = 10;
afterEach(() => {
  sessionsPerDay = 10;
  vi.restoreAllMocks();
});

const dayList = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const pt = (metric: string, date: string, value: number, dimension = "") => ({ metric, date, dimension, value });
const fakeGa4: Connector = async ({ from, to }) => dayList(from, to).map((d) => pt("sessions", d, sessionsPerDay));
const fakeGsc: Connector = async ({ from, to }) =>
  dayList(from, to).flatMap((d) => [
    pt("clicks", d, 2),
    pt("impressions", d, 100),
    pt("ctr", d, 0.02),
    pt("position", d, 8),
    pt("query_clicks", d, 1, "query:roof repair"),
  ]);
const connectors: Connectors = { ga4: fakeGa4, gsc: fakeGsc };
const failing =
  (code: ConnectorErrorCode, message: string): Connector =>
  async () => {
    throw new ConnectorError(code, message);
  };

async function setup() {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
  await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: { site_url: "sc-domain:roofcoms.com" }, actor });
  return { actor, brand };
}

async function startTracker(actor: Actor, o: { source: string; windowDays: number; baselineValue: number }) {
  await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "Traffic" }, items: [{ title: "Publish page", funnelStage: "acquisition" }], actor });
  const brand = await getBrandBySlug("roof-co");
  const item = (await getActivePlan(brand.id))!.items[0];
  const done = await updatePlanItem({
    itemId: item.id,
    status: "done",
    tracker: {
      kpi: "Traffic",
      direction: "up",
      baselineValue: o.baselineValue,
      baselineAt: new Date("2026-09-01T00:00:00Z"),
      source: o.source,
      windowDays: o.windowDays,
    },
    actor,
  });
  return done.tracker!.id;
}

const sync = (actor: Actor, over: Partial<Parameters<typeof syncBrandMetrics>[0]> = {}) =>
  syncBrandMetrics({ brandSlug: "roof-co", actor, now: NOW, connectors, ...over });

describe("syncBrandMetrics", () => {
  it("backfills 90 days the first time, then re-pulls a rolling 7 days without duplicating rows", async () => {
    const { actor, brand } = await setup();
    const first = await sync(actor);
    expect(first.map((r) => [r.source, r.status, r.from, r.to, r.rows])).toEqual([
      ["ga4", "ok", "2026-07-07", "2026-10-04", 90],
      ["gsc", "ok", "2026-07-07", "2026-10-04", 450],
    ]);

    sessionsPerDay = 12;
    const second = await sync(actor);
    expect(second.map((r) => [r.from, r.to])).toEqual([
      ["2026-09-28", "2026-10-04"],
      ["2026-09-28", "2026-10-04"],
    ]);
    const rows = await db.select().from(metricPoints).where(and(eq(metricPoints.brandId, brand.id), eq(metricPoints.source, "ga4")));
    expect(rows).toHaveLength(90);
    expect(rows.find((r) => r.date === "2026-10-04")?.value).toBe(12);
    expect(rows.find((r) => r.date === "2026-09-27")?.value).toBe(10);
  });

  it("reaches back over a gap longer than the rolling window so no days are missed", async () => {
    const { actor } = await setup();
    await sync(actor, { source: "ga4", days: 7 });
    const later = new Date("2026-10-25T12:00:00Z");
    const [r] = await sync(actor, { source: "ga4", now: later });
    expect(r.to).toBe("2026-10-24");
    expect(r.from).toBe(addDays("2026-10-24", -20));
  });

  it("records status on the integration and one activity row per source", async () => {
    const { actor, brand } = await setup();
    await sync(actor);
    const integrations = await listIntegrations(brand.id);
    const ga4 = integrations.find((i) => i.service === "ga4")!;
    expect(ga4).toMatchObject({ status: "connected", lastSyncError: null, syncedFrom: "2026-07-07" });
    expect(ga4.lastSyncedAt).toEqual(NOW);
    const summaries = (await listActivity({ brandId: brand.id })).map((a) => a.summary);
    expect(summaries).toContain("Google Analytics 4: synced 2026-07-07 to 2026-10-04 (90 rows)");
    expect(summaries).toContain("Google Search Console: synced 2026-07-07 to 2026-10-04 (450 rows)");
  });

  it("isolates a failing source: the other still syncs, the error is recorded, and status is untouched", async () => {
    const { actor, brand } = await setup();
    const message = "The service account sync@p.iam.gserviceaccount.com does not have access to GA4 property 515827425.";
    const results = await sync(actor, { connectors: { ga4: failing("permission_denied", message), gsc: fakeGsc } });
    expect(results.map((r) => [r.source, r.status])).toEqual([["ga4", "error"], ["gsc", "ok"]]);
    expect(results[0].message).toBe(message);

    const [ga4, gsc] = (await listIntegrations(brand.id)).sort((a, b) => a.service.localeCompare(b.service));
    expect(ga4).toMatchObject({ service: "ga4", status: "connected", lastSyncError: message, lastSyncedAt: null, syncedFrom: null });
    expect(gsc.lastSyncedAt).toEqual(NOW);
    expect(await db.select().from(metricPoints).where(eq(metricPoints.source, "ga4"))).toHaveLength(0);

    await sync(actor, { source: "ga4" });
    expect((await listIntegrations(brand.id)).find((i) => i.service === "ga4")).toMatchObject({ lastSyncError: null });
  });

  it("reports an unexpected crash as an error without leaking details or blocking the other source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { actor } = await setup();
    const results = await sync(actor, {
      connectors: {
        ga4: async () => {
          throw new Error("boom SECRET-DETAIL");
        },
        gsc: fakeGsc,
      },
    });
    expect(results[0]).toMatchObject({ source: "ga4", status: "error" });
    expect(results[0].message).not.toContain("SECRET-DETAIL");
    expect(results[1].status).toBe("ok");
  });

  it("skips sources that are not connected or have no identifier, and honours the source filter", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "not_connected", identifiers: { property_id: "515827425" }, actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: {}, actor });
    const results = await sync(actor);
    expect(results.map((r) => [r.source, r.status])).toEqual([["ga4", "skipped"], ["gsc", "skipped"]]);
    expect(results[0].message).toMatch(/not connected/i);
    expect(results[1].message).toMatch(/site_url/);
    expect(await sync(actor, { source: "gsc" })).toHaveLength(1);
  });

  it("treats a site with no traffic as a successful empty sync (zero-traffic site)", async () => {
    const { actor, brand } = await setup();
    const results = await sync(actor, { connectors: { ga4: async () => [], gsc: async () => [] } });
    expect(results.map((r) => [r.status, r.rows])).toEqual([["ok", 0], ["ok", 0]]);
    expect((await listIntegrations(brand.id)).every((i) => i.syncedFrom === "2026-07-07" && i.lastSyncError === null)).toBe(true);
  });

  it("validates days and source", async () => {
    const { actor } = await setup();
    for (const days of [0, 401, 1.5, Number.NaN]) {
      await expect(sync(actor, { days })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(sync(actor, { source: "google_ads" as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it("de-duplicates repeated points in one batch, drops unknown metrics, and writes more than one batch", async () => {
    const { actor, brand } = await setup();
    const many = Array.from({ length: 1200 }, (_, i) => pt("sessions", "2026-10-01", i, `d${i}`));
    const [r] = await sync(actor, {
      source: "ga4",
      connectors: { ...connectors, ga4: async () => [pt("sessions", "2026-10-02", 1), pt("sessions", "2026-10-02", 2), pt("bogus", "2026-10-02", 9), ...many] },
    });
    expect(r).toMatchObject({ status: "ok", rows: 1201 });
    const rows = await db.select().from(metricPoints).where(eq(metricPoints.brandId, brand.id));
    expect(rows).toHaveLength(1201);
    expect(rows.find((x) => x.date === "2026-10-02" && x.dimension === "")?.value).toBe(2);
  });

  it("skips a second concurrent sync of the same brand and source (no duplicate work)", async () => {
    const { actor, brand } = await setup();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${syncLockKey(brand.id, "ga4")}))`);
      const [r] = await sync(actor, { source: "ga4" });
      expect(r).toMatchObject({ status: "skipped", rows: 0 });
      expect(r.message).toMatch(/already running/i);
    });
    expect((await sync(actor, { source: "ga4" }))[0].status).toBe("ok");
  });
});

describe("tracker feed", () => {
  it("checks in a ga4 tracker once per window end using the window total, and again when the window moves", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 7, baselineValue: 50 });

    expect((await sync(actor, { source: "ga4" }))[0].trackerCheckins).toBe(1);
    expect((await sync(actor, { source: "ga4" }))[0].trackerCheckins).toBe(0);

    const [t] = await listTrackers(brand.id, NOW);
    expect(t).toMatchObject({ latest: 70, verdict: "positive" });
    expect(t.checkins).toHaveLength(1);
    const [c] = await db.select().from(trackerCheckins);
    expect(c.source).toBe("ga4:sessions (auto)");
    expect(c.observedAt).toEqual(new Date("2026-10-04T23:59:59.999Z"));

    const next = await sync(actor, { source: "ga4", now: new Date("2026-10-06T12:00:00Z") });
    expect(next[0].trackerCheckins).toBe(1);
  });

  it("recomputes CTR from clicks and impressions for gsc:ctr trackers", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "gsc:ctr", windowDays: 7, baselineValue: 0.01 });
    expect((await sync(actor, { source: "gsc" }))[0].trackerCheckins).toBe(1);
    const [t] = await listTrackers(brand.id, NOW);
    expect(t.latest).toBeCloseTo(0.02);
    expect(t.verdict).toBe("positive");
  });

  it("checks in 0 for a sum tracker on a zero-traffic site, but not a ratio tracker with no impressions", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 7, baselineValue: 50 });
    expect((await sync(actor, { source: "ga4", connectors: { ...connectors, ga4: async () => [] } }))[0].trackerCheckins).toBe(1);
    const [t] = await listTrackers(brand.id, NOW);
    expect(t).toMatchObject({ latest: 0, verdict: "negative" });
  });

  it("does not check in a ratio tracker when there were no impressions", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "gsc:ctr", windowDays: 7, baselineValue: 0.01 });
    const [r] = await sync(actor, { source: "gsc", connectors: { ...connectors, gsc: async () => [] } });
    expect(r).toMatchObject({ status: "ok", trackerCheckins: 0 });
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
  });

  it("does not check in when synced history is shorter than the tracker window", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 30, baselineValue: 100 });
    expect((await sync(actor, { source: "ga4", days: 7 }))[0].trackerCheckins).toBe(0);
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
    expect((await sync(actor, { source: "ga4", days: 30 }))[0].trackerCheckins).toBe(1);
    expect((await listTrackers(brand.id, NOW))[0].latest).toBe(300);
  });

  it("ignores trackers whose source is free text", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "GA4", windowDays: 7, baselineValue: 50 });
    const [r] = await sync(actor, { source: "ga4" });
    expect(r).toMatchObject({ status: "ok", trackerCheckins: 0 });
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
  });
});

describe("reading metrics", () => {
  it("returns daily totals only, in date order, for the requested range, with every requested metric present", async () => {
    const { actor, brand } = await setup();
    await sync(actor, { source: "gsc" });
    const series = await getMetricSeries({ brandId: brand.id, source: "gsc", metrics: ["clicks", "query_clicks", "position"], from: "2026-10-01", to: "2026-10-03" });
    expect(series.clicks).toEqual([
      { date: "2026-10-01", value: 2 },
      { date: "2026-10-02", value: 2 },
      { date: "2026-10-03", value: 2 },
    ]);
    expect(series.query_clicks).toEqual([]); // dimensional rows are not daily totals
    expect(series.position).toHaveLength(3);
  });

  it("ranks top queries by clicks and strips the dimension prefix", async () => {
    const { actor, brand } = await setup();
    await sync(actor, { source: "gsc" });
    expect(await getTopDimension({ brandId: brand.id, metric: "query_clicks", from: "2026-09-28", to: "2026-10-04" })).toEqual([
      { label: "roof repair", clicks: 7 },
    ]);
  });
});

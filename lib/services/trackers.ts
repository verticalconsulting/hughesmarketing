import { asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { planItems, plans, trackerCheckins, trackers } from "@/lib/data/schema";
import { computeVerdict, DEFAULT_THRESHOLD_PCT, type Direction, type Verdict } from "@/lib/domain/verdict";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type StartTrackerFields = {
  kpi: string;
  unit?: string | null;
  direction: Direction;
  baselineValue: number;
  baselineAt: Date;
  source: string;
  windowDays: number;
  thresholdPct?: number;
};

export async function startTracker(
  input: StartTrackerFields & { planItemId: string; actor: Actor },
  tx: DbOrTx = db,
): Promise<typeof trackers.$inferSelect> {
  if (!input.kpi.trim()) throw new ValidationError("KPI name is required", "kpi");
  if (!Number.isFinite(input.baselineValue)) throw new ValidationError("Baseline must be a number", "baselineValue");
  if (!Number.isInteger(input.windowDays) || input.windowDays < 1) throw new ValidationError("windowDays must be a whole number ≥ 1", "windowDays");
  const threshold = input.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  if (!(threshold > 0)) throw new ValidationError("thresholdPct must be greater than 0", "thresholdPct");
  const existing = await tx.query.trackers.findFirst({ where: (t, { eq }) => eq(t.planItemId, input.planItemId) });
  if (existing) throw new ConflictError("This plan item already has a tracker", { trackerId: existing.id });
  const [row] = await tx
    .insert(trackers)
    .values({
      planItemId: input.planItemId,
      kpi: input.kpi.trim(),
      unit: input.unit ?? null,
      direction: input.direction,
      baselineValue: input.baselineValue,
      baselineAt: input.baselineAt,
      source: input.source,
      windowDays: input.windowDays,
      thresholdPct: threshold,
    })
    .returning();
  return row;
}

export type TrackerSummary = {
  id: string;
  planItemId: string;
  itemTitle: string;
  kpi: string;
  unit: string | null;
  direction: Direction;
  baselineValue: number;
  baselineAt: Date;
  windowDays: number;
  latest: number | null;
  changePct: number | null;
  changeAbs: number | null;
  verdict: Verdict;
  windowEndsAt: Date;
  checkins: { value: number; observedAt: Date }[];
};

export async function addCheckin(input: {
  trackerId: string;
  value: number;
  observedAt: Date;
  source: string;
  note?: string | null;
  actor: Actor;
  now?: Date;
}): Promise<{ verdict: Verdict; changePct: number | null; changeAbs: number | null; latest: number | null }> {
  if (!Number.isFinite(input.value)) throw new ValidationError("Check-in value must be a number", "value");
  if (Number.isNaN(input.observedAt.getTime())) throw new ValidationError("observedAt must be a valid date", "observedAt");
  const [row] = await db
    .select({ tracker: trackers, brandId: plans.brandId })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(trackers.id, input.trackerId));
  if (!row) throw new NotFoundError(`Tracker ${input.trackerId} not found`);
  const t = row.tracker;

  await db.insert(trackerCheckins).values({
    trackerId: t.id,
    value: input.value,
    observedAt: input.observedAt,
    source: input.source,
    note: input.note ?? null,
  });
  const checkins = await db.select().from(trackerCheckins).where(eq(trackerCheckins.trackerId, t.id));
  const r = computeVerdict(t, checkins, input.now ?? new Date());
  await db
    .update(trackers)
    .set({
      verdict: r.verdict,
      changePct: r.changePct,
      verdictAt: r.verdict !== "pending" && t.verdict === "pending" ? new Date() : t.verdictAt,
    })
    .where(eq(trackers.id, t.id));
  await logActivity({
    brandId: row.brandId,
    actor: input.actor,
    kind: "tracker",
    summary: `Check-in ${t.kpi}: ${input.value} (${r.verdict})`,
    refType: "tracker",
    refId: t.id,
  });
  return { verdict: r.verdict, changePct: r.changePct, changeAbs: r.changeAbs, latest: r.latest };
}

export async function listTrackers(brandId: string, now: Date = new Date()): Promise<TrackerSummary[]> {
  const rows = await db
    .select({ tracker: trackers, itemTitle: planItems.title })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(plans.brandId, brandId))
    .orderBy(asc(trackers.baselineAt));
  if (rows.length === 0) return [];
  const checkins = await db
    .select()
    .from(trackerCheckins)
    .where(inArray(trackerCheckins.trackerId, rows.map((r) => r.tracker.id)))
    .orderBy(asc(trackerCheckins.observedAt));
  return rows.map(({ tracker: t, itemTitle }) => {
    const own = checkins.filter((c) => c.trackerId === t.id).map((c) => ({ value: c.value, observedAt: c.observedAt }));
    const r = computeVerdict(t, own, now);
    return {
      id: t.id,
      planItemId: t.planItemId,
      itemTitle,
      kpi: t.kpi,
      unit: t.unit,
      direction: t.direction,
      baselineValue: t.baselineValue,
      baselineAt: t.baselineAt,
      windowDays: t.windowDays,
      latest: r.latest,
      changePct: r.changePct,
      changeAbs: r.changeAbs,
      verdict: r.verdict,
      windowEndsAt: r.windowEndsAt,
      checkins: own,
    };
  });
}

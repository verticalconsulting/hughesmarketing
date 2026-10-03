import { db, type DbOrTx } from "@/lib/data/db";
import { trackers } from "@/lib/data/schema";
import { DEFAULT_THRESHOLD_PCT, type Direction } from "@/lib/domain/verdict";
import type { Actor } from "./actor";
import { ConflictError, ValidationError } from "./errors";

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

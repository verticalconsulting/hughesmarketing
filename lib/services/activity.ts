import { desc, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { activities, activityKindEnum } from "@/lib/data/schema";
import type { Actor } from "./actor";

export type ActivityKind = (typeof activityKindEnum.enumValues)[number];
export type ActivityRow = typeof activities.$inferSelect;

export async function logActivity(
  input: { brandId?: string | null; actor: Actor; kind: ActivityKind; summary: string; refType?: string; refId?: string },
  tx: DbOrTx = db,
): Promise<void> {
  await tx.insert(activities).values({
    brandId: input.brandId ?? null,
    actorKind: input.actor.kind,
    actorLabel: input.actor.label,
    kind: input.kind,
    summary: input.summary,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  });
}

export async function listActivity(opts: { brandId?: string | null; limit?: number }): Promise<ActivityRow[]> {
  const where =
    opts.brandId === undefined ? undefined : opts.brandId === null ? isNull(activities.brandId) : eq(activities.brandId, opts.brandId);
  return db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(opts.limit ?? 100);
}

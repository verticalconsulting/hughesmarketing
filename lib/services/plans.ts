import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { brands, files, itemStatusEnum, planItemFiles, planItems, plans, trackers } from "@/lib/data/schema";
import type { FunnelStage } from "@/lib/domain/funnel";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { advanceStage, getBrandBySlug } from "./brands";
import { ApprovalError, NotFoundError, ValidationError } from "./errors";
import { findFileId } from "./files";
import { startTracker, type StartTrackerFields } from "./trackers";

export type ItemStatus = (typeof itemStatusEnum.enumValues)[number];
export const AGENT_STATUSES = ["planned", "active", "done", "blocked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type PlanInput = {
  objective: string;
  primaryChannel?: string | null;
  secondaryChannels?: string[];
  monthlyBudget?: number | null;
  weeklyHours?: number | null;
  timeline?: string | null;
  summary?: string | null;
  sourceAuditId?: string | null;
  planFilePath?: string | null;
};
export type PlanItemInput = {
  title: string;
  description?: string | null;
  funnelStage: FunnelStage;
  channel?: string | null;
  priority?: number;
  expectedKpi?: string | null;
  needsApproval?: boolean;
};
export type PlanItemView = typeof planItems.$inferSelect & { tracker: typeof trackers.$inferSelect | null; files: string[] };
export type PlanView = typeof plans.$inferSelect & { items: PlanItemView[]; planFilePath: string | null };

async function hydrateItems(rows: (typeof planItems.$inferSelect)[]): Promise<PlanItemView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const trackerRows = await db.select().from(trackers).where(inArray(trackers.planItemId, ids));
  const fileRows = await db
    .select({ planItemId: planItemFiles.planItemId, path: files.path })
    .from(planItemFiles)
    .innerJoin(files, eq(files.id, planItemFiles.fileId))
    .where(inArray(planItemFiles.planItemId, ids));
  return rows.map((r) => ({
    ...r,
    tracker: trackerRows.find((t) => t.planItemId === r.id) ?? null,
    files: fileRows.filter((f) => f.planItemId === r.id).map((f) => f.path).sort(),
  }));
}

async function getItem(itemId: string): Promise<{ item: typeof planItems.$inferSelect; brandId: string }> {
  const [row] = await db
    .select({ item: planItems, brandId: plans.brandId })
    .from(planItems)
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(planItems.id, itemId));
  if (!row) throw new NotFoundError(`Plan item ${itemId} not found`);
  return row;
}

async function viewItem(itemId: string): Promise<PlanItemView> {
  const [row] = await db.select().from(planItems).where(eq(planItems.id, itemId));
  return (await hydrateItems([row]))[0];
}

export async function createPlanVersion(input: {
  brandSlug: string;
  plan: PlanInput;
  items: PlanItemInput[];
  requestId?: string;
  actor: Actor;
}): Promise<{ planId: string; version: number; itemIds: string[]; duplicate: boolean }> {
  const brand = await getBrandBySlug(input.brandSlug);
  const priorResult = async (executor: DbOrTx) => {
    if (!input.requestId) return null;
    const [prior] = await executor.select().from(plans).where(eq(plans.requestId, input.requestId));
    if (!prior) return null;
    const items = await executor.select({ id: planItems.id }).from(planItems).where(eq(planItems.planId, prior.id));
    return { planId: prior.id, version: prior.version, itemIds: items.map((i) => i.id), duplicate: true };
  };
  const early = await priorResult(db);
  if (early) return early;
  if (!input.plan.objective?.trim()) throw new ValidationError("Plan objective is required", "objective");
  for (const item of input.items) {
    if (!item.title?.trim()) throw new ValidationError("Every plan item needs a title", "items");
  }
  const fileId = input.plan.planFilePath ? await findFileId(brand.id, input.plan.planFilePath) : null;

  return db.transaction(async (tx) => {
    // Serialize plan creation per brand: version numbers and the single-active-plan rule depend on it,
    // and a retry racing the original call must see the original's request id.
    await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brand.id)).for("update");
    const raced = await priorResult(tx);
    if (raced) return raced;
    const [{ v }] = await tx.select({ v: max(plans.version) }).from(plans).where(eq(plans.brandId, brand.id));
    const version = (v ?? 0) + 1;
    await tx
      .update(plans)
      .set({ status: "archived" })
      .where(and(eq(plans.brandId, brand.id), eq(plans.status, "active")));
    const [plan] = await tx
      .insert(plans)
      .values({
        brandId: brand.id,
        version,
        status: "active",
        objective: input.plan.objective.trim(),
        primaryChannel: input.plan.primaryChannel ?? null,
        secondaryChannels: input.plan.secondaryChannels ?? [],
        monthlyBudget: input.plan.monthlyBudget ?? null,
        weeklyHours: input.plan.weeklyHours ?? null,
        timeline: input.plan.timeline ?? null,
        summary: input.plan.summary ?? null,
        sourceAuditId: input.plan.sourceAuditId ?? null,
        fileId,
        requestId: input.requestId ?? null,
      })
      .returning({ id: plans.id });
    const itemIds: string[] = [];
    if (input.items.length > 0) {
      const inserted = await tx
        .insert(planItems)
        .values(
          input.items.map((i) => ({
            planId: plan.id,
            title: i.title.trim(),
            description: i.description ?? null,
            funnelStage: i.funnelStage,
            channel: i.channel ?? null,
            priority: i.priority ?? 100,
            expectedKpi: i.expectedKpi ?? null,
            needsApproval: i.needsApproval ?? false,
            status: (i.needsApproval ? "needs_approval" : "planned") as ItemStatus,
          })),
        )
        .returning({ id: planItems.id });
      itemIds.push(...inserted.map((r) => r.id));
    }
    await advanceStage(brand.id, "planned", tx);
    await logActivity(
      { brandId: brand.id, actor: input.actor, kind: "plan", summary: `Plan v${version} created with ${input.items.length} items`, refType: "plan", refId: plan.id },
      tx,
    );
    return { planId: plan.id, version, itemIds, duplicate: false };
  });
}

export async function getActivePlan(brandId: string): Promise<PlanView | null> {
  const [plan] = await db
    .select({ plan: plans, planFilePath: files.path })
    .from(plans)
    .leftJoin(files, eq(files.id, plans.fileId))
    .where(and(eq(plans.brandId, brandId), eq(plans.status, "active")))
    .orderBy(desc(plans.version))
    .limit(1);
  if (!plan) return null;
  const rows = await db
    .select()
    .from(planItems)
    .where(eq(planItems.planId, plan.plan.id))
    .orderBy(asc(planItems.priority), asc(planItems.createdAt));
  return { ...plan.plan, planFilePath: plan.planFilePath, items: await hydrateItems(rows) };
}

export async function getNextPlanItem(brandSlug: string): Promise<PlanItemView | null> {
  const brand = await getBrandBySlug(brandSlug);
  const plan = await getActivePlan(brand.id);
  return plan?.items.find((i) => i.status === "planned" || i.status === "approved") ?? null;
}

export async function updatePlanItem(input: {
  itemId: string;
  status?: AgentStatus;
  note?: string;
  linkFiles?: string[];
  tracker?: StartTrackerFields;
  actor: Actor;
}): Promise<PlanItemView> {
  const { item, brandId } = await getItem(input.itemId);
  if (input.status && !(AGENT_STATUSES as readonly string[]).includes(input.status)) {
    throw new ValidationError(`Status "${input.status}" can only be set in the app (agents may use ${AGENT_STATUSES.join(", ")})`, "status");
  }
  // needs_approval and declined are decisions owned by the app; an agent may not move an item out of them.
  if (input.status && (item.status === "needs_approval" || item.status === "declined")) {
    throw new ApprovalError(`"${item.title}" is ${item.status === "declined" ? "declined" : "awaiting approval"}; only the app can change its status`);
  }
  if ((input.status === "active" || input.status === "done") && item.needsApproval && !item.approvedAt) {
    throw new ApprovalError(`"${item.title}" needs approval in the app before it can be started or completed`);
  }
  const fileIds = await Promise.all((input.linkFiles ?? []).map((p) => findFileId(brandId, p)));

  await db.transaction(async (tx) => {
    const existingTracker = await tx.query.trackers.findFirst({ where: (t, { eq: e }) => e(t.planItemId, item.id) });
    if (input.tracker) {
      await startTracker({ ...input.tracker, planItemId: item.id, actor: input.actor }, tx);
    } else if (input.status === "done" && !existingTracker) {
      throw new ValidationError(
        "Completing an item requires a tracker: pass `tracker` with kpi, direction, baselineValue, baselineAt, source, windowDays",
        "tracker",
      );
    }
    const notes = input.note ? (item.notes ? `${item.notes}\n\n${input.note}` : input.note) : item.notes;
    await tx
      .update(planItems)
      .set({ status: input.status ?? item.status, notes })
      .where(eq(planItems.id, item.id));
    if (fileIds.length > 0) {
      await tx
        .insert(planItemFiles)
        .values(fileIds.map((fileId) => ({ planItemId: item.id, fileId })))
        .onConflictDoNothing();
    }
    if (input.status === "active" || input.status === "done") await advanceStage(brandId, "executing", tx);
    await logActivity(
      {
        brandId,
        actor: input.actor,
        kind: input.tracker ? "tracker" : "plan",
        summary: `Updated "${item.title}"${input.status ? ` → ${input.status}` : ""}${input.tracker ? ` (tracking ${input.tracker.kpi})` : ""}`,
        refType: "plan_item",
        refId: item.id,
      },
      tx,
    );
  });
  return viewItem(item.id);
}

export async function decidePlanItem(input: {
  itemId: string;
  decision: "approve" | "decline";
  note?: string;
  actor: Actor;
}): Promise<PlanItemView> {
  const { item, brandId } = await getItem(input.itemId);
  if (item.status !== "needs_approval") {
    throw new ValidationError(`"${item.title}" is not awaiting approval (status: ${item.status})`, "status");
  }
  const approve = input.decision === "approve";
  await db
    .update(planItems)
    .set({
      status: approve ? "approved" : "declined",
      approvalNote: input.note ?? null,
      approvedBy: approve ? input.actor.userId : null,
      approvedAt: approve ? new Date() : null,
    })
    .where(eq(planItems.id, item.id));
  await logActivity({
    brandId,
    actor: input.actor,
    kind: "approval",
    summary: `${approve ? "Approved" : "Declined"} "${item.title}"`,
    refType: "plan_item",
    refId: item.id,
  });
  return viewItem(item.id);
}

export async function countPendingApprovals(brandId?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(planItems)
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(
      and(
        eq(planItems.status, "needs_approval"),
        eq(plans.status, "active"),
        brandId ? eq(plans.brandId, brandId) : undefined,
      ),
    );
  return Number(row.n);
}

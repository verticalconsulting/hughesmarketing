import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand, getBrandBySlug } from "@/lib/services/brands";
import { writeFile } from "@/lib/services/files";
import {
  countPendingApprovals,
  createPlanVersion,
  decidePlanItem,
  getActivePlan,
  getNextPlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import { ApprovalError, ConflictError, ValidationError } from "@/lib/services/errors";

const tracker = {
  kpi: "Organic clicks",
  direction: "up" as const,
  baselineValue: 10,
  baselineAt: new Date("2026-09-20"),
  source: "GSC",
  windowDays: 28,
};

async function setup() {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  const plan = await createPlanVersion({
    brandSlug: "roof-co",
    plan: { objective: "Generate roofing leads", primaryChannel: "SEO", monthlyBudget: 1000, timeline: "90_day" },
    items: [
      { title: "Publish Flowood page", funnelStage: "acquisition", priority: 2 },
      { title: "Launch $500 search test", funnelStage: "acquisition", priority: 1, needsApproval: true },
    ],
    actor,
  });
  return { actor, brand, plan };
}

describe("plans service", () => {
  it("creates a versioned plan, archives the previous one, and advances the stage", async () => {
    const { actor, brand, plan } = await setup();
    expect(plan.version).toBe(1);
    const v2 = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "v2" }, items: [], actor });
    expect(v2.version).toBe(2);
    const active = await getActivePlan(brand.id);
    expect(active?.objective).toBe("v2");
    expect((await getBrandBySlug("roof-co")).stage).toBe("planned");
  });

  it("starts approval items in needs_approval and is idempotent by request id", async () => {
    const { actor, brand } = await setup();
    const items = (await getActivePlan(brand.id))!.items;
    expect(items.map((i) => [i.title, i.status])).toEqual([
      ["Launch $500 search test", "needs_approval"],
      ["Publish Flowood page", "planned"],
    ]);
    const a = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "x" }, items: [], requestId: "p1", actor });
    const b = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "y" }, items: [], requestId: "p1", actor });
    expect(b).toMatchObject({ planId: a.planId, duplicate: true });
  });

  it("returns the next actionable item by priority, skipping items awaiting approval", async () => {
    await setup();
    expect((await getNextPlanItem("roof-co"))?.title).toBe("Publish Flowood page");
  });

  it("blocks agents from activating or completing unapproved items", async () => {
    const { actor, brand } = await setup();
    const gated = (await getActivePlan(brand.id))!.items[0];
    await expect(updatePlanItem({ itemId: gated.id, status: "active", actor })).rejects.toBeInstanceOf(ApprovalError);
    expect(await countPendingApprovals()).toBe(1);
    await decidePlanItem({ itemId: gated.id, decision: "approve", actor });
    expect(await countPendingApprovals()).toBe(0);
    expect((await getNextPlanItem("roof-co"))?.title).toBe("Launch $500 search test");
    const active = await updatePlanItem({ itemId: gated.id, status: "active", actor });
    expect(active.status).toBe("active");
    expect((await getBrandBySlug("roof-co")).stage).toBe("executing");
  });

  it("rejects agent-set approval statuses", async () => {
    const { actor, brand } = await setup();
    const item = (await getActivePlan(brand.id))!.items[1];
    await expect(
      // @ts-expect-error agents cannot approve
      updatePlanItem({ itemId: item.id, status: "approved", actor }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a tracker to complete an item and links files", async () => {
    const { actor, brand } = await setup();
    const item = (await getActivePlan(brand.id))!.items[1];
    await writeFile({ brandId: brand.id, path: "deliverables/flowood.md", content: "draft", actor });
    await expect(updatePlanItem({ itemId: item.id, status: "done", actor })).rejects.toBeInstanceOf(ValidationError);
    const done = await updatePlanItem({
      itemId: item.id,
      status: "done",
      note: "Published",
      linkFiles: ["deliverables/flowood.md"],
      tracker,
      actor,
    });
    expect(done).toMatchObject({ status: "done", notes: "Published", files: ["deliverables/flowood.md"] });
    expect(done.tracker).toMatchObject({ kpi: "Organic clicks", verdict: "pending" });
    await expect(updatePlanItem({ itemId: item.id, tracker, actor })).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not let agents revive items that await or were refused approval", async () => {
    const { actor, brand } = await setup();
    const gated = (await getActivePlan(brand.id))!.items[0];
    await expect(updatePlanItem({ itemId: gated.id, status: "planned", actor })).rejects.toBeInstanceOf(ApprovalError);
    await decidePlanItem({ itemId: gated.id, decision: "decline", actor });
    await expect(updatePlanItem({ itemId: gated.id, status: "planned", actor })).rejects.toBeInstanceOf(ApprovalError);
    expect((await getNextPlanItem("roof-co"))?.title).toBe("Publish Flowood page");
  });

  it("only decides items that are awaiting approval", async () => {
    const { actor, brand } = await setup();
    const plain = (await getActivePlan(brand.id))!.items[1];
    await expect(decidePlanItem({ itemId: plain.id, decision: "approve", actor })).rejects.toBeInstanceOf(ValidationError);
  });
});

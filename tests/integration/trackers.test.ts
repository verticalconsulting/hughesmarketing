import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { createPlanVersion, getActivePlan, updatePlanItem } from "@/lib/services/plans";
import { addCheckin, listTrackers } from "@/lib/services/trackers";
import { NotFoundError, ValidationError } from "@/lib/services/errors";

async function trackedItem(baselineValue = 10) {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  await createPlanVersion({
    brandSlug: "roof-co",
    plan: { objective: "Leads" },
    items: [{ title: "Publish Flowood page", funnelStage: "acquisition" }],
    actor,
  });
  const item = (await getActivePlan(brand.id))!.items[0];
  const done = await updatePlanItem({
    itemId: item.id,
    status: "done",
    tracker: { kpi: "Leads", direction: "up", baselineValue, baselineAt: new Date("2026-09-01T00:00:00Z"), source: "GA4", windowDays: 30 },
    actor,
  });
  return { actor, brand, trackerId: done.tracker!.id };
}

describe("trackers", () => {
  it("stays pending inside the window and turns positive after it", async () => {
    const { actor, brand, trackerId } = await trackedItem();
    const early = await addCheckin({ trackerId, value: 14, observedAt: new Date("2026-09-15"), source: "GA4", actor, now: new Date("2026-09-15") });
    expect(early).toMatchObject({ verdict: "pending", changePct: 40 });
    const late = await addCheckin({ trackerId, value: 15, observedAt: new Date("2026-10-02"), source: "GA4", actor, now: new Date("2026-10-02") });
    expect(late).toMatchObject({ verdict: "positive", changePct: 50, latest: 15 });
    const [summary] = await listTrackers(brand.id, new Date("2026-10-02"));
    expect(summary).toMatchObject({ itemTitle: "Publish Flowood page", verdict: "positive", latest: 15 });
    expect(summary.checkins).toHaveLength(2);
  });

  it("handles a zero baseline with absolute change", async () => {
    const { actor, trackerId } = await trackedItem(0);
    const r = await addCheckin({ trackerId, value: 3, observedAt: new Date("2026-10-05"), source: "GA4", actor, now: new Date("2026-10-05") });
    expect(r).toMatchObject({ verdict: "positive", changePct: null, changeAbs: 3 });
  });

  it("validates check-ins", async () => {
    const { actor, trackerId } = await trackedItem();
    await expect(
      addCheckin({ trackerId, value: Number.NaN, observedAt: new Date(), source: "GA4", actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addCheckin({ trackerId: "00000000-0000-0000-0000-000000000000", value: 1, observedAt: new Date(), source: "GA4", actor }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

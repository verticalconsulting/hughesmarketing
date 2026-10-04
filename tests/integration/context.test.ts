import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { recordAudit } from "@/lib/services/audits";
import { createBrand, saveOnboarding } from "@/lib/services/brands";
import { getBrandContext, getPlanQuestions } from "@/lib/services/context";
import { createPlanVersion } from "@/lib/services/plans";

describe("brand context", () => {
  it("bundles everything an agent needs in one call", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", domain: "roofcoms.com", actor });
    await saveOnboarding("roof-co", { primary_goal: "leads", monthly_budget: 1000 }, actor);
    await recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 70 }, { category: "geo", score: 50 }, { category: "ai_visibility", score: 10 }, { category: "website_content", score: 60 }], actor });
    await createPlanVersion({
      brandSlug: "roof-co",
      plan: { objective: "Leads" },
      items: [{ title: "A", funnelStage: "acquisition" }, { title: "B", funnelStage: "revenue", needsApproval: true }],
      actor,
    });
    const ctx = await getBrandContext("roof-co");
    expect(ctx.brand).toMatchObject({ slug: "roof-co", domain: "roofcoms.com", stage: "planned" });
    expect(ctx.onboarding.missing).not.toContain("primary_goal");
    expect(ctx.latestAudit?.scores).toHaveLength(4);
    // (70·20 + 50·15 + 10·20 + 60·20) / 75 = 3550 / 75 = 47.33 → 47; coverage 0.75 is not partial
    expect(ctx.health.health).toBe(47);
    expect(ctx.openItems.map((i) => i.title)).toEqual(["A", "B"]);
    expect(ctx.trackers).toEqual([]);
  });

  it("only asks plan questions not answered in onboarding", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await saveOnboarding("roof-co", { primary_goal: "leads", monthly_budget: 1000 }, actor);
    const keys = (await getPlanQuestions("roof-co")).map((q) => q.key);
    expect(keys).not.toContain("primary_goal");
    expect(keys).toContain("primary_channel");
  });
});

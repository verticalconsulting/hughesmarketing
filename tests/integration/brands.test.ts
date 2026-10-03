import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { advanceStage, createBrand, getBrandBySlug, listBrands, saveOnboarding } from "@/lib/services/brands";
import { listActivity } from "@/lib/services/activity";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";

describe("brands service", () => {
  it("creates a brand with slug, normalized domain, color, and an activity entry", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "SuperThrift", domain: "https://superthriftdeals.org/", actor });
    expect(b).toMatchObject({ slug: "superthrift", domain: "superthriftdeals.org", stage: "onboarding" });
    expect(b.color).toMatch(/^#/);
    const acts = await listActivity({ brandId: b.id });
    expect(acts[0]).toMatchObject({ kind: "brand", summary: "Added brand SuperThrift" });
  });

  it("rejects empty names and duplicate slugs", async () => {
    const actor = await createTestUser();
    await expect(createBrand({ name: "  ", actor })).rejects.toBeInstanceOf(ValidationError);
    await createBrand({ name: "Roof Co", actor });
    await expect(createBrand({ name: "roof co", actor })).rejects.toBeInstanceOf(ConflictError);
  });

  it("suggests close slugs when a brand is not found", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "SuperThrift", slug: "superthriftdeals-org", actor });
    const err = await getBrandBySlug("superthrift").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.details.suggestions).toEqual(["superthriftdeals-org"]);
  });

  it("merges onboarding answers and reports what is still missing", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Elite Gutters", actor });
    await saveOnboarding("elite-gutters", { primary_goal: "leads" }, actor);
    const r = await saveOnboarding("elite-gutters", { monthly_budget: 500 }, actor);
    expect(r.brand.onboarding).toEqual({ primary_goal: "leads", monthly_budget: 500 });
    expect(r.missing).not.toContain("primary_goal");
    expect(r.missing).toContain("business_offer");
  });

  it("only advances stages forward", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Mid-State Welding", actor });
    await advanceStage(b.id, "planned");
    await advanceStage(b.id, "audited");
    expect((await getBrandBySlug("mid-state-welding")).stage).toBe("planned");
  });

  it("lists brands with null health before any audit", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    expect(await listBrands()).toEqual([
      expect.objectContaining({ slug: "roof-co", health: null, delta: null, latestAuditAt: null }),
    ]);
  });
});

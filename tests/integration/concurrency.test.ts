import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { db } from "@/lib/data/db";
import { plans } from "@/lib/data/schema";
import { recordAudit } from "@/lib/services/audits";
import { createBrand } from "@/lib/services/brands";
import { listFiles, readFile, writeFile } from "@/lib/services/files";
import { createPlanVersion } from "@/lib/services/plans";

const full = (n: number) =>
  (["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"] as const).map((category) => ({ category, score: n }));

describe("concurrent calls", () => {
  it("gives concurrent plan versions distinct numbers and leaves exactly one active plan", async () => {
    const actor = await createTestUser();
    const brand = await createBrand({ name: "Roof Co", actor });
    const make = () => createPlanVersion({ brandSlug: "roof-co", plan: { objective: "x" }, items: [], actor });
    const results = await Promise.all([make(), make(), make()]);
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3]);
    const active = await db.select().from(plans).where(and(eq(plans.brandId, brand.id), eq(plans.status, "active")));
    expect(active).toHaveLength(1);
  });

  it("treats concurrent create_plan_version retries with one request id as one plan", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    const make = () => createPlanVersion({ brandSlug: "roof-co", plan: { objective: "x" }, items: [], requestId: "same", actor });
    const results = await Promise.all([make(), make(), make()]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.planId)).size).toBe(1);
  });

  it("treats concurrent record_audit retries with one request id as one audit", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    const make = () => recordAudit({ brandSlug: "roof-co", scores: full(50), requestId: "same", actor });
    const results = await Promise.all([make(), make(), make()]);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.auditId)).size).toBe(1);
  });

  it("lets concurrent first writes of one new file both succeed", async () => {
    const actor = await createTestUser();
    const make = (content: string) => writeFile({ brandId: null, path: "skills/new/SKILL.md", content, actor });
    const results = await Promise.all([make("a"), make("b"), make("c")]);
    expect(results).toHaveLength(3);
    expect((await listFiles({ brandId: null })).map((f) => f.path)).toEqual(["skills/new/SKILL.md"]);
    expect((await readFile({ brandId: null, path: "skills/new/SKILL.md" })).version).toBe(3);
  });
});

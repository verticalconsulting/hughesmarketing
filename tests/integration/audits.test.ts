import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { listAudits, recordAudit } from "@/lib/services/audits";
import { createBrand, getBrandBySlug, listBrands } from "@/lib/services/brands";
import { writeFile } from "@/lib/services/files";
import { NotFoundError, ValidationError } from "@/lib/services/errors";

const full = (n: number) =>
  (["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"] as const).map((category) => ({ category, score: n }));

describe("audits service", () => {
  it("records an audit, computes health, links the report, and advances the stage", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await writeFile({ brandId: b.id, path: "audits/2026-09-08-full-audit.md", content: "# Audit", actor });
    const r = await recordAudit({
      brandSlug: "roof-co",
      auditedAt: new Date("2026-09-08T00:00:00Z"),
      reportPath: "audits/2026-09-08-full-audit.md",
      scores: [{ category: "seo", score: 50, target: 80, evidence: "Ranks for 2 of 10" }, ...full(50).slice(0, 5).filter((s) => s.category !== "seo")],
      actor,
    });
    expect(r).toMatchObject({ health: 50, partial: false, delta: null, duplicate: false });
    expect((await getBrandBySlug("roof-co")).stage).toBe("audited");
    const [a] = await listAudits(b.id);
    expect(a.reportPath).toBe("audits/2026-09-08-full-audit.md");
    expect(a.scores.find((s) => s.category === "seo")).toMatchObject({ score: 50, target: 80, evidence: "Ranks for 2 of 10" });
  });

  it("computes delta against the previous full audit and ignores partial ones", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await recordAudit({ brandSlug: "roof-co", auditedAt: new Date("2026-09-01"), scores: full(40), actor });
    const partial = await recordAudit({
      brandSlug: "roof-co",
      auditedAt: new Date("2026-09-10"),
      scores: [{ category: "social", score: 5 }],
      actor,
    });
    expect(partial).toMatchObject({ partial: true, delta: null });
    const second = await recordAudit({ brandSlug: "roof-co", auditedAt: new Date("2026-09-20"), scores: full(55), actor });
    expect(second.delta).toBe(15);
    const [summary] = await listBrands();
    expect(summary).toMatchObject({ health: 55, delta: 15 });
  });

  it("is idempotent by request id", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const first = await recordAudit({ brandSlug: "roof-co", scores: full(60), requestId: "req-1", actor });
    const retry = await recordAudit({ brandSlug: "roof-co", scores: full(10), requestId: "req-1", actor });
    expect(retry).toMatchObject({ auditId: first.auditId, health: 60, duplicate: true });
    expect(await listAudits(b.id)).toHaveLength(1);
  });

  it("validates input", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await expect(recordAudit({ brandSlug: "roof-co", scores: [], actor })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 120 }], actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 1 }, { category: "seo", score: 2 }], actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", reportPath: "audits/missing.md", scores: full(1), actor }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

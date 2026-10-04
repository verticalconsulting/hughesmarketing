import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { runImport } from "@/lib/import/run-import";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { listFiles, readFile } from "@/lib/services/files";
import { listIntegrations } from "@/lib/services/integrations";
import { getActivePlan } from "@/lib/services/plans";

const ROOT = path.resolve("tests/fixtures/ai-assets");

describe("runImport", () => {
  it("imports brands, files, audits, plans, integrations, and shared skills", async () => {
    const actor = await createTestUser();
    const report = await runImport(ROOT, actor);
    expect(report.failed).toEqual([]);
    expect(report.brands.sort()).toEqual(["roofcoms-com", "superthriftdeals-org"]);
    expect(report.audits).toBe(1);
    expect(report.plans).toBe(1);
    expect(report.integrations).toBe(1);
    expect(report.skipped).toEqual(expect.arrayContaining(["README.md", "desktop.ini", "_Personal-Automations"]));

    const roof = await getBrandBySlug("roofcoms-com");
    expect(roof).toMatchObject({ name: "Roof Co", domain: "roofcoms.com", stage: "planned" });
    const [audit] = await listAudits(roof.id);
    expect(audit).toMatchObject({ health: 35, reportPath: "audits/2026-09-08-170920-full-audit.md" });
    const plan = await getActivePlan(roof.id);
    expect(plan).toMatchObject({ objective: "Generate roofing leads and demos over the 90-day sprint.", monthlyBudget: 1000, planFilePath: "PLAN.md" });

    const st = await getBrandBySlug("superthriftdeals-org");
    expect(st.name).toBe("SuperThrift");
    expect(await listIntegrations(st.id)).toEqual([expect.objectContaining({ service: "ga4", identifiers: { property_id: "515827425" } })]);
    expect((await listFiles({ brandId: st.id })).map((f) => f.path)).toEqual(["INTEGRATIONS.md"]);

    expect((await readFile({ brandId: null, path: "skills/ads/SKILL.md" })).text).toContain("# Ads");
    const everything = [...(await listFiles({ brandId: null })), ...(await listFiles({ brandId: roof.id }))];
    expect(everything.some((f) => f.path.includes("secret"))).toBe(false);
  });

  it("is idempotent", async () => {
    const actor = await createTestUser();
    const first = await runImport(ROOT, actor);
    const second = await runImport(ROOT, actor);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(first.written);
    expect(second.audits).toBe(0);
    expect(second.plans).toBe(0);
    expect(await listAudits((await getBrandBySlug("roofcoms-com")).id)).toHaveLength(1);
  });
});

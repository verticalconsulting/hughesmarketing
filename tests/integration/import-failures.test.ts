import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTestUser } from "../helpers/db";
import { runImport } from "@/lib/import/run-import";
import { getBrandBySlug } from "@/lib/services/brands";

// Inject a failure for the plan step only, to prove one bad brand cannot abort the rest of the import.
vi.mock("@/lib/services/plans", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/services/plans")>();
  return { ...real, createPlanVersion: vi.fn().mockRejectedValue(new Error("boom")) };
});

const ROOT = path.resolve("tests/fixtures/ai-assets");

describe("runImport failure isolation", () => {
  it("records a failed plan in the report and still imports later brands", async () => {
    const actor = await createTestUser();
    const report = await runImport(ROOT, actor);
    expect(report.failed).toEqual([expect.objectContaining({ error: "boom", path: expect.stringContaining("PLAN.md") })]);
    expect(report.plans).toBe(0);
    // Superthriftdeals.org sorts after Roofcoms.com, so it is processed after the failure.
    expect(report.integrations).toBe(1);
    await expect(getBrandBySlug("superthriftdeals-org")).resolves.toBeTruthy();
  });
});

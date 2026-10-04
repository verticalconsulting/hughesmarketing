import { describe, expect, it } from "vitest";
import { gettingStarted } from "./checklist";

describe("gettingStarted", () => {
  it("marks steps done from brand state", () => {
    const steps = gettingStarted({ onboardingMissing: 0, auditCount: 1, hasPlan: false, doneItems: 0, decidedVerdicts: 0 });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["brand", true],
      ["onboarding", true],
      ["audit", true],
      ["plan", false],
      ["execute", false],
      ["measure", false],
    ]);
  });
});

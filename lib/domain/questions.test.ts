import { describe, expect, it } from "vitest";
import { isAnswered, missingOnboardingQuestions, missingPlanQuestions, ONBOARDING_QUESTIONS } from "./questions";

describe("questions", () => {
  it("treats empty values as unanswered", () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered("  ")).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(["x"])).toBe(true);
  });

  it("returns all onboarding questions for a new brand and none when complete", () => {
    expect(missingOnboardingQuestions({})).toHaveLength(ONBOARDING_QUESTIONS.length);
    const all = Object.fromEntries(ONBOARDING_QUESTIONS.map((q) => [q.key, q.kind === "list" ? ["x"] : "x"]));
    expect(missingOnboardingQuestions(all)).toEqual([]);
  });

  it("skips plan questions already answered during onboarding", () => {
    const keys = missingPlanQuestions({ primary_goal: "leads", monthly_budget: 500 }).map((q) => q.key);
    expect(keys).not.toContain("primary_goal");
    expect(keys).not.toContain("monthly_budget");
    expect(keys).toContain("primary_channel");
    expect(keys).toContain("timeline_horizon");
  });
});

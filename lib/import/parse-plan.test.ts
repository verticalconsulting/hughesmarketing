import { describe, expect, it } from "vitest";
import { parsePlanHeader } from "./parse-plan";

const PLAN = `# Current Marketing Plan

_Last refreshed: 2026-09-08T17:17:07.326526+00:00_

Status: active
Version: 13
Source audit: audits/2026-09-08-170920-full-audit.md
Objective: Generate roofing leads and demos over the 90-day sprint.
Primary focus: Paid ads
Secondary focuses: GEO, SEO, AI visibility
Monthly budget: $1,000.00
Weekly bandwidth: 2 hours
Timeline horizon: 90_day

## Summary

Turn Roofcoms' existing site into a lead destination.

## Audit overview
`;

describe("parsePlanHeader", () => {
  it("extracts header fields and the summary paragraph", () => {
    expect(parsePlanHeader(PLAN)).toEqual({
      version: 13,
      objective: "Generate roofing leads and demos over the 90-day sprint.",
      primaryChannel: "Paid ads",
      secondaryChannels: ["GEO", "SEO", "AI visibility"],
      monthlyBudget: 1000,
      weeklyHours: 2,
      timeline: "90_day",
      summary: "Turn Roofcoms' existing site into a lead destination.",
    });
  });

  it("returns nulls for a non-plan document", () => {
    expect(parsePlanHeader("# Something else")).toMatchObject({ version: null, objective: null, secondaryChannels: [] });
  });
});

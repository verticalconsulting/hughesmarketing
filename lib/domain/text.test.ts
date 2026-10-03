import { describe, expect, it } from "vitest";
import { closeMatches, colorForSlug, normalizeDomain, slugify } from "./text";

describe("text helpers", () => {
  it("slugifies names and folder names", () => {
    expect(slugify("Superthriftdeals.org")).toBe("superthriftdeals-org");
    expect(slugify("Mercy House — Vehicle Donation!")).toBe("mercy-house-vehicle-donation");
    expect(slugify("  ")).toBe("");
  });

  it("normalizes domains", () => {
    expect(normalizeDomain("https://www.MidStateWelding.com/about/")).toBe("www.midstatewelding.com");
    expect(normalizeDomain("superthriftdeals.org")).toBe("superthriftdeals.org");
  });

  it("finds close slug matches", () => {
    const all = ["superthriftdeals-org", "roofcoms-com", "myelitegutters-com"];
    expect(closeMatches("superthrift", all)).toEqual(["superthriftdeals-org"]);
    expect(closeMatches("roofcom-com", all)).toContain("roofcoms-com");
    expect(closeMatches("zzz", all)).toEqual([]);
  });

  it("assigns a stable color per slug", () => {
    expect(colorForSlug("a")).toBe(colorForSlug("a"));
    expect(colorForSlug("a")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

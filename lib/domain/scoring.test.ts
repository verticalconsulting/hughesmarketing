import { describe, expect, it } from "vitest";
import { band, computeHealth, DEFAULT_WEIGHTS, summarizeHealth } from "./scoring";

describe("computeHealth", () => {
  it("computes the weighted average over all six categories", () => {
    // SuperThrift 2026-09-29: 20, 86, 49, 41, 0, 75
    const r = computeHealth({ ai_visibility: 20, geo: 86, seo: 49, website_content: 41, social: 0, paid_ads: 75 });
    // (20*20 + 86*15 + 49*20 + 41*20 + 0*10 + 75*15) / 100 = 46.15
    expect(r).toEqual({ health: 46, coverage: 1, partial: false });
  });

  it("renormalizes weights when categories are missing", () => {
    const r = computeHealth({ ai_visibility: 50, seo: 70, website_content: 90, geo: 60 });
    // weights 20+20+20+15 = 75 → (1000+1400+1800+900)/75 = 68
    expect(r.health).toBe(68);
    expect(r.coverage).toBeCloseTo(0.75);
    expect(r.partial).toBe(false);
  });

  it("marks low coverage as partial but still computes a number", () => {
    const r = computeHealth({ social: 10, paid_ads: 90 });
    expect(r.coverage).toBeCloseTo(0.25);
    expect(r.partial).toBe(true);
    expect(r.health).toBe(58); // (100 + 1350) / 25
  });

  it("returns null health when nothing is scored", () => {
    expect(computeHealth({})).toEqual({ health: null, coverage: 0, partial: true });
  });

  it("rejects out-of-range scores", () => {
    expect(() => computeHealth({ seo: 101 })).toThrow(RangeError);
    expect(() => computeHealth({ seo: -1 })).toThrow(RangeError);
    expect(() => computeHealth({ seo: Number.NaN })).toThrow(RangeError);
  });

  it("uses custom weights", () => {
    const r = computeHealth({ seo: 100, geo: 0 }, { ...DEFAULT_WEIGHTS, seo: 1, geo: 1 });
    expect(r.health).toBe(50);
  });
});

describe("summarizeHealth", () => {
  it("uses the latest full audit and the previous full audit for delta", () => {
    expect(summarizeHealth([{ health: 53, coverage: 1 }, { health: 51, coverage: 1 }])).toEqual({ health: 53, delta: 2 });
  });

  it("skips partial audits for both health and delta", () => {
    const r = summarizeHealth([
      { health: 10, coverage: 0.2 },
      { health: 60, coverage: 1 },
      { health: 30, coverage: 0.3 },
      { health: 55, coverage: 0.9 },
    ]);
    expect(r).toEqual({ health: 60, delta: 5 });
  });

  it("returns null delta with a single full audit and nulls with none", () => {
    expect(summarizeHealth([{ health: 40, coverage: 1 }])).toEqual({ health: 40, delta: null });
    expect(summarizeHealth([])).toEqual({ health: null, delta: null });
  });
});

describe("band", () => {
  it("maps score bands", () => {
    expect(band(39)).toBe("red");
    expect(band(40)).toBe("amber");
    expect(band(69)).toBe("amber");
    expect(band(70)).toBe("green");
  });
});

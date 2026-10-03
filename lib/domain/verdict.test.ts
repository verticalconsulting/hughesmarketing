import { describe, expect, it } from "vitest";
import { computeVerdict } from "./verdict";

const day = 24 * 60 * 60 * 1000;
const baselineAt = new Date("2026-09-01T00:00:00Z");
const base = { baselineValue: 100, baselineAt, direction: "up" as const, windowDays: 30, thresholdPct: 5 };
const after = (days: number) => new Date(baselineAt.getTime() + days * day);

describe("computeVerdict", () => {
  it("is pending with no check-ins", () => {
    const r = computeVerdict(base, [], after(60));
    expect(r.verdict).toBe("pending");
    expect(r.latest).toBeNull();
    expect(r.windowEndsAt).toEqual(after(30));
  });

  it("is pending while the window is open, but reports change", () => {
    const r = computeVerdict(base, [{ value: 130, observedAt: after(10) }], after(10));
    expect(r.verdict).toBe("pending");
    expect(r.changePct).toBe(30);
  });

  it("is pending after the window if no check-in falls after it", () => {
    const r = computeVerdict(base, [{ value: 130, observedAt: after(10) }], after(45));
    expect(r.verdict).toBe("pending");
  });

  it("is positive when the change meets the threshold after the window", () => {
    const r = computeVerdict(base, [{ value: 105, observedAt: after(31) }], after(31));
    expect(r).toMatchObject({ verdict: "positive", latest: 105, changePct: 5, changeAbs: 5 });
  });

  it("is neutral inside the threshold and negative below it", () => {
    expect(computeVerdict(base, [{ value: 103, observedAt: after(30) }], after(30)).verdict).toBe("neutral");
    expect(computeVerdict(base, [{ value: 90, observedAt: after(30) }], after(30)).verdict).toBe("negative");
  });

  it("uses the most recent check-in", () => {
    const r = computeVerdict(
      base,
      [
        { value: 80, observedAt: after(35) },
        { value: 120, observedAt: after(40) },
        { value: 50, observedAt: after(5) },
      ],
      after(41),
    );
    expect(r.latest).toBe(120);
    expect(r.verdict).toBe("positive");
  });

  it("flips the sign when lower is better", () => {
    const cpa = { ...base, direction: "down" as const };
    expect(computeVerdict(cpa, [{ value: 80, observedAt: after(31) }], after(31)).verdict).toBe("positive");
    expect(computeVerdict(cpa, [{ value: 120, observedAt: after(31) }], after(31)).verdict).toBe("negative");
  });

  it("uses absolute change when the baseline is zero", () => {
    const zero = { ...base, baselineValue: 0 };
    const r = computeVerdict(zero, [{ value: 3, observedAt: after(31) }], after(31));
    expect(r).toMatchObject({ verdict: "positive", changePct: null, changeAbs: 3 });
    expect(computeVerdict(zero, [{ value: 0.5, observedAt: after(31) }], after(31)).verdict).toBe("neutral");
  });
});

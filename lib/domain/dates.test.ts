import { describe, expect, it } from "vitest";
import { groupByRecency } from "./dates";

describe("groupByRecency", () => {
  it("buckets by age", () => {
    const now = new Date("2026-10-02T15:00:00Z");
    const at = (iso: string) => ({ createdAt: new Date(iso) });
    const g = groupByRecency(
      [at("2026-10-02T01:00:00Z"), at("2026-09-28T12:00:00Z"), at("2026-09-20T12:00:00Z"), at("2026-08-01T00:00:00Z")],
      now,
    );
    expect([g.today.length, g.last7.length, g.last14.length, g.older.length]).toEqual([1, 1, 1, 1]);
  });
});

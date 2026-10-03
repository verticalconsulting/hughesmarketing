import { describe, expect, it } from "vitest";
import { normalizePath, PathError } from "./paths";

describe("normalizePath", () => {
  it("normalizes separators and redundant segments", () => {
    expect(normalizePath("audits\\2026-09-29-full-audit.md")).toBe("audits/2026-09-29-full-audit.md");
    expect(normalizePath("./deliverables//brief.md")).toBe("deliverables/brief.md");
    expect(normalizePath("/skills/ads/SKILL.md ")).toBe("skills/ads/SKILL.md");
    expect(normalizePath("a/./b.md")).toBe("a/b.md");
  });

  it("rejects traversal and empty paths", () => {
    expect(() => normalizePath("../secrets.md")).toThrow(PathError);
    expect(() => normalizePath("audits/../../x.md")).toThrow(PathError);
    expect(() => normalizePath("   ")).toThrow(PathError);
    expect(() => normalizePath("folder/")).toThrow(PathError);
  });
});

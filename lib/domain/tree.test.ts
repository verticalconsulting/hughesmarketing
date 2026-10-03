import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";

describe("buildTree", () => {
  it("nests paths with folders before files", () => {
    const tree = buildTree(["PLAN.md", "audits/b.md", "audits/a.md", "BRAND.md", "workflows/x/SKILL.md"]);
    expect(tree.map((n) => n.name)).toEqual(["audits", "workflows", "BRAND.md", "PLAN.md"]);
    expect(tree[0].children?.map((n) => n.path)).toEqual(["audits/a.md", "audits/b.md"]);
    expect(tree[1].children?.[0]).toMatchObject({ name: "x", path: "workflows/x" });
    expect(tree[1].children?.[0].children?.[0]).toEqual({ name: "SKILL.md", path: "workflows/x/SKILL.md" });
  });
});

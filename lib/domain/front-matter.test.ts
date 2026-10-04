import { describe, expect, it } from "vitest";
import { splitFrontMatter } from "./front-matter";

describe("splitFrontMatter", () => {
  it("parses YAML front matter including flow mappings", () => {
    const src = '---\nname: ads-monitor\nmetadata: { "openclaw": { "emoji": "📡" } }\n---\n\n# Body';
    const r = splitFrontMatter(src);
    expect(r.data).toEqual({ name: "ads-monitor", metadata: { openclaw: { emoji: "📡" } } });
    expect(r.body.trim()).toBe("# Body");
  });

  it("handles CRLF and missing front matter", () => {
    expect(splitFrontMatter("---\r\nname: x\r\n---\r\nhi").data).toEqual({ name: "x" });
    expect(splitFrontMatter("# Just text")).toEqual({ data: null, body: "# Just text" });
  });

  it("returns the original text when YAML is invalid", () => {
    const src = "---\nname: [unclosed\n---\nbody";
    expect(splitFrontMatter(src)).toEqual({ data: null, body: src });
  });
});

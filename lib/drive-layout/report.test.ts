import { describe, expect, it } from "vitest";
import { emptiedFolders, formatReport } from "./report";
import type { ClientPlan, FileEntry } from "./types";

const f = (path: string): FileEntry => ({ path, sha256: path, mtimeMs: 0, head: "" });

describe("emptiedFolders", () => {
  it("lists folders whose files all moved out", () => {
    const files = [f("local-service-pages/a.md"), f("local-service-pages/b.md"), f("seo/x.md"), f("seo/keep.md")];
    const moves = [
      { from: "C/local-service-pages/a.md", to: "C/content-drafts/a.md", reason: "local-service-pages" as const },
      { from: "C/local-service-pages/b.md", to: "C/content-drafts/b.md", reason: "local-service-pages" as const },
      { from: "C/seo/x.md", to: "C/resources/seo/x.md", reason: "topic-folder" as const },
    ];
    expect(emptiedFolders(files, moves, "C")).toEqual(["local-service-pages"]);
  });

  it("does not call a folder emptied when a move lands in it", () => {
    const files = [f("plans/p (1).md")];
    const moves = [{ from: "C/plans/p (1).md", to: "C/plans/p.md", reason: "strip-suffix" as const, optional: true }];
    expect(emptiedFolders(files, moves, "C")).toEqual([]);
  });

  it("follows chained moves to the final location", () => {
    const files = [f("seo/a (1).md")];
    const moves = [
      { from: "C/seo/a (1).md", to: "C/resources/seo/a (1).md", reason: "topic-folder" as const },
      { from: "C/resources/seo/a (1).md", to: "C/resources/seo/a.md", reason: "strip-suffix" as const, optional: true },
    ];
    expect(emptiedFolders(files, moves, "C")).toEqual(["seo"]);
  });
});

describe("formatReport", () => {
  const plans: ClientPlan[] = [
    {
      client: "Acme.com",
      moves: [
        { from: "Acme.com/seo/a.md", to: "Acme.com/resources/seo/a.md", reason: "topic-folder" },
        { from: "Acme.com/resources/x (1).md", to: "Acme.com/resources/x.md", reason: "strip-suffix", optional: true },
      ],
      conflicts: [{ path: "Acme.com/data/s (1).csv", kind: "destination-exists", detail: "shared destination" }],
      notes: [{ path: "Acme.com/workflow-results/w.md", message: "used its modified time (2026-09-24)" }],
    },
    { client: "Clean.org", moves: [], conflicts: [], notes: [] },
  ];

  it("shows why a file was classified as a duplicate", () => {
    const out = formatReport({
      generatedAt: "2026-10-05",
      plans: [
        {
          client: "Acme.com",
          moves: [
            {
              from: "Acme.com/seo/k (1).md",
              to: "_Duplicates-to-delete/Acme.com-k-copy1.md",
              reason: "duplicate",
              detail: "identical to deliverables/k.md",
            },
          ],
          conflicts: [],
          notes: [],
        },
      ],
      stale: {},
      emptied: {},
    });
    expect(out).toContain("| Reason | From | To | Detail |");
    expect(out).toContain("identical to deliverables/k.md");
  });

  it("summarises totals and each client", () => {
    const out = formatReport({
      generatedAt: "2026-10-05",
      plans,
      stale: { "Acme.com": [{ file: "Acme.com/deliverables/n.md", mentions: ["seo/"] }] },
      emptied: { "Acme.com": ["seo"] },
    });
    expect(out).toContain("Totals: 1 moves, 1 optional renames, 1 conflicts");
    expect(out).toContain("## Acme.com");
    expect(out).toContain("| topic-folder | Acme.com/seo/a.md | Acme.com/resources/seo/a.md |");
    expect(out).toContain("| strip-suffix (optional) |");
    expect(out).toContain("destination-exists");
    expect(out).toContain("used its modified time");
    expect(out).toContain("Acme.com/deliverables/n.md");
    expect(out).toContain("## Clean.org\n\nNo changes needed.");
  });
});

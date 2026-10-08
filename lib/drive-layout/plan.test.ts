import { describe, expect, it } from "vitest";
import { planClient, splitDownloadSuffix } from "./plan";
import type { FileEntry } from "./types";

const MTIME = Date.UTC(2026, 8, 24, 12);
const f = (path: string, sha = `sha:${path}`, head = ""): FileEntry => ({ path, sha256: sha, mtimeMs: MTIME, head });
const C = "Acme.com";

describe("splitDownloadSuffix", () => {
  it("splits name, number, and extension", () => {
    expect(splitDownloadSuffix("Search keyword report (1).csv")).toEqual({
      stripped: "Search keyword report.csv",
      stem: "Search keyword report",
      ext: ".csv",
      n: 1,
    });
  });
  it("handles names with no extension and ignores plain names", () => {
    expect(splitDownloadSuffix("notes (12)")).toEqual({ stripped: "notes", stem: "notes", ext: "", n: 12 });
    expect(splitDownloadSuffix("notes.md")).toBeNull();
    expect(splitDownloadSuffix("notes (final).md")).toBeNull();
  });
});

describe("planClient: routing", () => {
  it("moves topic folders under resources/", () => {
    const plan = planClient(C, [f("seo/a.md"), f("resources/audits/x.md"), f("audits/y.md")]);
    expect(plan.moves).toEqual([{ from: `${C}/seo/a.md`, to: `${C}/resources/seo/a.md`, reason: "topic-folder" }]);
    expect(plan.conflicts).toEqual([]);
  });

  it("is idempotent: an already-migrated tree has no moves", () => {
    const plan = planClient(C, [
      f("resources/seo/a.md"),
      f("resources/workflow-results/social/2026-09-14/x.md"),
      f("content-drafts/b.md"),
      f("seo-page-map/c.md"),
      f("audits/y.md"),
    ]);
    expect(plan.moves).toEqual([]);
  });

  it("splits local-service-pages", () => {
    const plan = planClient(C, [
      f("local-service-pages/README.md", "r", "# Index (2026-10-03)"),
      f("local-service-pages/brandon-draft.md"),
      f("local-service-pages/keyword-to-page-map-2026-10-03.md"),
    ]);
    expect(plan.moves.map((m) => m.to)).toEqual([
      `${C}/resources/local-service-pages-2026-10-03/README.md`,
      `${C}/content-drafts/brandon-draft.md`,
      `${C}/seo-page-map/keyword-to-page-map-2026-10-03.md`,
    ]);
  });

  it("nests workflow results and records a note when the date is a guess", () => {
    const dated = "bda63dbc-fbf3-4ee3-af90-06d2bfb50f9c-social-content-calendar.md";
    const undated = "8dbf7a47-d24a-4f73-887c-90fbfae82732-pre-launch-seo-audit-report.md";
    const plan = planClient(C, [
      f(`workflow-results/${dated}`, "a", "**Prepared:** September 14, 2026"),
      f(`workflow-results/${undated}`, "b"),
    ]);
    // Moves follow file-path order, and "8dbf..." sorts before "bda6...".
    expect(plan.moves.map((m) => m.to)).toEqual([
      `${C}/resources/workflow-results/pre-launch-seo-audit-report/2026-09-24/${undated}`,
      `${C}/resources/workflow-results/social-content-calendar/2026-09-14/${dated}`,
    ]);
    expect(plan.notes).toHaveLength(1);
    expect(plan.notes[0].path).toBe(`${C}/workflow-results/${undated}`);
  });
});

describe("planClient: download-suffix files", () => {
  it("quarantines a copy that is identical to its same-folder original", () => {
    const plan = planClient(C, [f("plans/p.md", "same"), f("plans/p (1).md", "same")]);
    expect(plan.moves).toEqual([
      { from: `${C}/plans/p (1).md`, to: `_Duplicates-to-delete/${C}-p-copy1.md`, reason: "duplicate", detail: "identical to plans/p.md" },
    ]);
  });

  it("leaves a copy that differs from its original and lists a conflict", () => {
    const plan = planClient(C, [f("data/r.csv", "one"), f("data/r (1).csv", "two")]);
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts).toEqual([
      { path: `${C}/data/r (1).csv`, kind: "duplicate-differs", detail: "content differs from data/r.csv; left in place" },
    ]);
  });

  it("quarantines a suffixed copy that is identical to a plain file elsewhere", () => {
    const plan = planClient(C, [f("seo/k (1).md", "K"), f("deliverables/k.md", "K")]);
    expect(plan.moves).toEqual([
      { from: `${C}/seo/k (1).md`, to: `_Duplicates-to-delete/${C}-k-copy1.md`, reason: "duplicate", detail: "identical to deliverables/k.md" },
    ]);
  });

  it("routes a lone suffixed file and offers an optional rename after it", () => {
    const plan = planClient(C, [f("geo-technical-fixes/review (1).html", "x")]);
    expect(plan.moves).toEqual([
      {
        from: `${C}/geo-technical-fixes/review (1).html`,
        to: `${C}/resources/geo-technical-fixes/review (1).html`,
        reason: "topic-folder",
      },
      {
        from: `${C}/resources/geo-technical-fixes/review (1).html`,
        to: `${C}/resources/geo-technical-fixes/review.html`,
        reason: "strip-suffix",
        optional: true,
      },
    ]);
  });

  it("does not guess among three different downloads that would share one name", () => {
    const plan = planClient(C, [f("data/s (1).csv", "a"), f("data/s (2).csv", "b"), f("data/s (3).csv", "c")]);
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts.map((c) => [c.path, c.kind])).toEqual([
      [`${C}/data/s (1).csv`, "destination-exists"],
      [`${C}/data/s (2).csv`, "destination-exists"],
      [`${C}/data/s (3).csv`, "destination-exists"],
    ]);
  });

  it("keeps the lowest-numbered of identical lone copies and quarantines the rest", () => {
    const plan = planClient(C, [f("data/z (2).csv", "same"), f("data/z (1).csv", "same")]);
    expect(plan.moves).toEqual([
      { from: `${C}/data/z (2).csv`, to: `_Duplicates-to-delete/${C}-z-copy2.csv`, reason: "duplicate", detail: "identical to data/z (1).csv" },
      { from: `${C}/data/z (1).csv`, to: `${C}/data/z.csv`, reason: "strip-suffix", optional: true },
    ]);
  });
});

describe("planClient: duplicates must share a name, not just content", () => {
  it("does not treat an unrelated file with identical content as the original", () => {
    const plan = planClient(C, [f("memory/notes (1).md", "EMPTY"), f("plans/todo (1).md", "EMPTY")]);
    expect(plan.moves.map((m) => [m.reason, m.from])).toEqual([
      ["strip-suffix", `${C}/memory/notes (1).md`],
      ["strip-suffix", `${C}/plans/todo (1).md`],
    ]);
  });

  it("does not quarantine a copy whose only identical file has a different name", () => {
    const plan = planClient(C, [f("data/report (1).csv", "X"), f("deliverables/totally-different-name.csv", "X")]);
    expect(plan.moves.map((m) => m.reason)).toEqual(["strip-suffix"]);
  });

  it("only groups identical lone copies that share a folder and name", () => {
    const plan = planClient(C, [f("data/alpha (1).csv", "X"), f("data/beta (1).csv", "X")]);
    expect(plan.moves.some((m) => m.reason === "duplicate")).toBe(false);
  });
});

describe("planClient: collisions", () => {
  it("never moves onto an existing file, compared case-insensitively", () => {
    const plan = planClient(C, [f("seo/a.md", "A"), f("resources/seo/A.md", "B")]);
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts).toEqual([
      { path: `${C}/seo/a.md`, kind: "destination-exists", detail: `${C}/resources/seo/a.md already exists` },
    ]);
  });

  it("drops renames that depend on a blocked move without listing extra conflicts", () => {
    const plan = planClient(C, [f("seo/a (1).md", "A"), f("resources/seo/a (1).md", "B")]);
    expect(plan.moves).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
  });
});

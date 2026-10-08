# Drive Restructure Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tested script that plans, applies, and undoes the Drive folder restructure (spec section 3), starting with a read-only dry-run report the owner reviews before anything moves.

**Architecture:** Pure TypeScript in `lib/drive-layout/`: a rules module (where does one file go), a planner (duplicates, collisions, idempotency), a scanner (reads the Drive tree from disk), a report formatter, and an executor with a manifest and undo. A thin CLI in `scripts/restructure-drive.ts` wires them. Nothing here touches the database or the Drive API; it works on the locally mounted `Google Drive Streaming` folder.

**Tech Stack:** TypeScript, Node `fs/promises` and `crypto`, Vitest (unit project, `lib/**/*.test.ts`), tsx, pnpm.

**Spec:** `docs/superpowers/specs/2026-10-05-phase0-drive-workspace-and-skills-design.md` (section 3, "Target Drive layout", and "Procedure"). This is sub-project 1 of 4 in the spec's delivery order. The Drive connection, Assets pane, and Skills tab get their own plans.

## Global Constraints

- Nothing is ever deleted and no file content is ever rewritten. Every change is a rename (move) inside the same Drive.
- Skipped top-level folders: `Hughes Files`, `_Personal-Automations`, `_Duplicates-to-delete`, and any dot-folder (`.claude`). Ignored files: `desktop.ini`, `Thumbs.db`, any name starting with `.`.
- Topic folders moved under `resources/`: `ai-answer-foundation`, `ai-visibility`, `geo-technical-fixes`, `mobile-lead-path`, `paid-search`, `seo`.
- `local-service-pages/`: `README.md` goes to `resources/local-service-pages-<date>/`, `keyword-to-page-map-*` to `seo-page-map/`, every other file to `content-drafts/`.
- `workflow-results/<run-id>-<workflow>.md` goes to `resources/workflow-results/<workflow-slug>/<date>/<original filename>`. The date comes from a `Prepared:`/`Audit date:`-style line in the file's first 14 lines (ISO `2026-09-24` or `September 14, 2026`); otherwise the file's modified time, and the report notes that.
- Duplicate convention (matches the Drive's `organize-inbox` skill, which is flat): extras go to `_Duplicates-to-delete/<client>-<name-without-suffix>-copy<N><ext>` at the AI Assets root. A ` (n)` file is quarantined only when byte-identical (same SHA-256) to a plain-named file or to a lower-numbered ` (n)` sibling. If it differs from its same-folder original it is left in place and listed as a conflict. A lone ` (n)` file with no counterpart gets an **optional** rename that strips the suffix, applied only with `--include-optional`.
- Never overwrite: a move whose destination exists (compared case-insensitively, because Drive Streaming is NTFS), or that shares a destination with another move, is dropped from the plan and listed as a conflict.
- `data/` keeps its name. `audits/` stays at the client root.
- Dry-run is the default and writes nothing. `execute` needs `--yes` and `--manifest <file>`.
- Every commit message ends with these two lines, in this order:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` then `Claude-Session: https://claude.ai/code/session_01VGarZFzTj3STQHLQGMtZPQ`. Commit steps run only after the owner has approved this plan.

## Review Focus

Failure modes the spec implies but no obvious test exercises; each has a pinning test in the owning task.

1. **Re-running on an already-migrated tree** must produce zero moves (Task 2, `plan.test.ts` "is idempotent").
2. **Destination already exists**, including a case-only difference (`A.md` vs `a.md`) and a pre-existing quarantine file, must never overwrite and must abort `execute` before moving anything (Task 2 collision tests; Task 4 preflight test).
3. **` (n)` files that differ, have no original, or are three same-named downloads** (`Search keyword report (1).csv`, `(2)`, `(3)`) must never be quarantined; they become conflicts or optional renames (Task 2 duplicate tests).
4. **Names with spaces, parentheses, an em dash, and accented letters** (`résumé – plan.md`, `Search report (1).csv`) must survive plan, execute, and undo byte-for-byte (Task 4 round-trip test).
5. **An interrupted `execute`** leaves a manifest whose `done` count lets `undo` restore exactly what moved and nothing else (Task 4 partial-undo test).

Not covered here, and called out so it is not a surprise: the app importer (`lib/import/run-import.ts`) upserts by path, so if it had already imported the old paths into a real database, those rows would remain after the move. The live check (`docs/superpowers/live-check-2026-10.md`) records that no AI Assets import has been run, so restructure first, import after.

## File Structure

| File | Responsibility |
|---|---|
| `lib/drive-layout/types.ts` | Shared types: `FileEntry`, `Move`, `Conflict`, `Note`, `ClientPlan`. |
| `lib/drive-layout/rules.ts` | Pure: date extraction, `routeFile` (where one file goes), `localServicePagesDate`. |
| `lib/drive-layout/plan.ts` | Pure: `planClient` (duplicates, optional renames, collision resolution). |
| `lib/drive-layout/scan.ts` | Disk reads: `listClients`, `scanClient`, `findStaleReferences`. |
| `lib/drive-layout/report.ts` | Pure: `emptiedFolders`, `formatReport` (markdown). |
| `lib/drive-layout/execute.ts` | Disk writes: `preflight`, `executeMoves`, `undoMoves`, manifest. |
| `scripts/restructure-drive.ts` | CLI: `dry-run`, `execute`, `undo`. |
| `package.json` | Add `drive:restructure` script. |

---

### Task 1: Types and routing rules

**Files:**
- Create: `lib/drive-layout/types.ts`
- Create: `lib/drive-layout/rules.ts`
- Test: `lib/drive-layout/rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FileEntry`, `Move`, `MoveReason`, `Conflict`, `Note`, `ClientPlan` (types); `TOPIC_FOLDERS`; `extractDate(head: string, mtimeMs: number): { date: string; source: "content" | "mtime" }`; `localServicePagesDate(files: FileEntry[]): string | null`; `routeFile(file: FileEntry, ctx: { localServicePagesDate: string | null }): { to: string; reason: MoveReason; note?: string } | null` (paths relative to the client folder, forward slashes).

- [ ] **Step 1: Write the types**

Create `lib/drive-layout/types.ts`:

```ts
export type FileEntry = {
  /** Path relative to the client folder, forward slashes. */
  path: string;
  sha256: string;
  mtimeMs: number;
  /** First 14 lines of text files; "" for anything else. */
  head: string;
};

export type MoveReason = "topic-folder" | "local-service-pages" | "workflow-results" | "duplicate" | "strip-suffix";

export type Move = {
  /** Relative to the AI Assets root, forward slashes, e.g. "Myelitegutters.com/seo/a.md". */
  from: string;
  to: string;
  reason: MoveReason;
  /** Applied only when the caller passes includeOptional. */
  optional?: boolean;
  detail?: string;
};

export type Conflict = {
  /** Root-relative path of the file that was left alone. */
  path: string;
  kind: "duplicate-differs" | "destination-exists";
  detail: string;
};

export type Note = { path: string; message: string };

export type ClientPlan = { client: string; moves: Move[]; conflicts: Conflict[]; notes: Note[] };
```

- [ ] **Step 2: Write the failing tests**

Create `lib/drive-layout/rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractDate, localServicePagesDate, routeFile } from "./rules";
import type { FileEntry } from "./types";

const MTIME = Date.UTC(2026, 8, 24, 12); // 2026-09-24
const file = (path: string, over: Partial<FileEntry> = {}): FileEntry => ({
  path,
  sha256: `sha:${path}`,
  mtimeMs: MTIME,
  head: "",
  ...over,
});

describe("extractDate", () => {
  it("reads an ISO date from a Prepared line", () => {
    expect(extractDate("# T\n\n**Prepared:** 2026-09-24  ", MTIME)).toEqual({ date: "2026-09-24", source: "content" });
  });
  it("reads a long-form date", () => {
    expect(extractDate("**Prepared:** September 14, 2026  ", MTIME)).toEqual({ date: "2026-09-14", source: "content" });
  });
  it("reads an Audit date line", () => {
    expect(extractDate("- **Audit date:** 2026-09-10 UTC", MTIME)).toEqual({ date: "2026-09-10", source: "content" });
  });
  it("ignores dates on lines that are not about when the file was made", () => {
    expect(extractDate("Call us 2026-01-01", MTIME)).toEqual({ date: "2026-09-24", source: "mtime" });
  });
  it("falls back to the modified time", () => {
    expect(extractDate("", MTIME)).toEqual({ date: "2026-09-24", source: "mtime" });
  });
});

describe("localServicePagesDate", () => {
  it("prefers a date in the README head", () => {
    const files = [
      file("local-service-pages/README.md", { head: "# Local service pages — deliverables index (2026-10-03)" }),
      file("local-service-pages/keyword-to-page-map-2026-09-01.md"),
    ];
    expect(localServicePagesDate(files)).toBe("2026-10-03");
  });
  it("otherwise uses the latest date in a file name", () => {
    const files = [file("local-service-pages/a-2026-09-01.md"), file("local-service-pages/b-2026-10-03.md")];
    expect(localServicePagesDate(files)).toBe("2026-10-03");
  });
  it("is null when nothing is dated", () => {
    expect(localServicePagesDate([file("local-service-pages/a.md")])).toBeNull();
  });
});

describe("routeFile", () => {
  const ctx = { localServicePagesDate: "2026-10-03" };

  it("moves topic folders under resources/", () => {
    expect(routeFile(file("seo/a.md"), ctx)).toEqual({ to: "resources/seo/a.md", reason: "topic-folder" });
    expect(routeFile(file("paid-search/x/y.md"), ctx)).toEqual({ to: "resources/paid-search/x/y.md", reason: "topic-folder" });
  });

  it("leaves files that are already in place", () => {
    for (const p of ["resources/seo/a.md", "audits/a.md", "plans/a.md", "data/a.csv", "BRAND.md", "deliverables/a.md"]) {
      expect(routeFile(file(p), ctx)).toBeNull();
    }
  });

  it("splits local-service-pages", () => {
    expect(routeFile(file("local-service-pages/README.md"), ctx)?.to).toBe("resources/local-service-pages-2026-10-03/README.md");
    expect(routeFile(file("local-service-pages/brandon-gutter-installation-draft.md"), ctx)?.to).toBe(
      "content-drafts/brandon-gutter-installation-draft.md",
    );
    expect(routeFile(file("local-service-pages/keyword-to-page-map-2026-10-03.md"), ctx)?.to).toBe(
      "seo-page-map/keyword-to-page-map-2026-10-03.md",
    );
  });

  it("does not date the folder when no date was found", () => {
    expect(routeFile(file("local-service-pages/README.md"), { localServicePagesDate: null })?.to).toBe(
      "resources/local-service-pages/README.md",
    );
  });

  it("nests workflow results by workflow and date", () => {
    const name = "bda63dbc-fbf3-4ee3-af90-06d2bfb50f9c-social-content-calendar.md";
    const r = routeFile(file(`workflow-results/${name}`, { head: "**Prepared:** September 14, 2026" }), ctx);
    expect(r).toEqual({
      to: `resources/workflow-results/social-content-calendar/2026-09-14/${name}`,
      reason: "workflow-results",
      note: undefined,
    });
  });

  it("notes when the date came from the modified time", () => {
    const name = "8dbf7a47-d24a-4f73-887c-90fbfae82732-pre-launch-seo-audit-report.md";
    const r = routeFile(file(`workflow-results/${name}`), ctx);
    expect(r?.to).toBe(`resources/workflow-results/pre-launch-seo-audit-report/2026-09-24/${name}`);
    expect(r?.note).toContain("modified time");
  });

  it("keeps non-run-id workflow results flat under resources/workflow-results", () => {
    expect(routeFile(file("workflow-results/notes.md"), ctx)?.to).toBe("resources/workflow-results/notes.md");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test:unit lib/drive-layout/rules.test.ts`
Expected: FAIL, "Cannot find module './rules'".

- [ ] **Step 4: Write the implementation**

Create `lib/drive-layout/rules.ts`:

```ts
import type { FileEntry, MoveReason } from "./types";

export const TOPIC_FOLDERS = [
  "ai-answer-foundation",
  "ai-visibility",
  "geo-technical-fixes",
  "mobile-lead-path",
  "paid-search",
  "seo",
] as const;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const ISO_DATE = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/;
const ISO_DATE_ALL = /(?<!\d)20\d{2}-\d{2}-\d{2}(?!\d)/g;
const LONG_DATE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s+(20\\d{2})\\b`, "i");
const DATE_LINE = /prepared|date|generated|created/i;
const RUN_ID_NAME = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(.+)\.[^.]+$/i;
const pad = (n: number) => String(n).padStart(2, "0");

export type DateHint = { date: string; source: "content" | "mtime" };

export function extractDate(head: string, mtimeMs: number): DateHint {
  for (const line of head.split(/\r?\n/)) {
    if (!DATE_LINE.test(line)) continue;
    const iso = line.match(ISO_DATE);
    if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, source: "content" };
    const long = line.match(LONG_DATE);
    if (long) {
      const month = MONTHS.indexOf(long[1].toLowerCase()) + 1;
      return { date: `${long[3]}-${pad(month)}-${pad(Number(long[2]))}`, source: "content" };
    }
  }
  return { date: new Date(mtimeMs).toISOString().slice(0, 10), source: "mtime" };
}

export function localServicePagesDate(files: FileEntry[]): string | null {
  const inFolder = files.filter((f) => f.path.startsWith("local-service-pages/"));
  const readme = inFolder.find((f) => f.path === "local-service-pages/README.md");
  const fromReadme = readme?.head.match(ISO_DATE);
  if (fromReadme) return `${fromReadme[1]}-${fromReadme[2]}-${fromReadme[3]}`;
  const dates = inFolder.flatMap((f) => f.path.match(ISO_DATE_ALL) ?? []).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export type Route = { to: string; reason: MoveReason; note?: string };
export type RouteContext = { localServicePagesDate: string | null };

/** Where one file belongs. Paths are relative to the client folder. Null means it is already in place. */
export function routeFile(file: FileEntry, ctx: RouteContext): Route | null {
  const parts = file.path.split("/");
  const top = parts[0];
  const rest = parts.slice(1);
  if (rest.length === 0) return null;

  if ((TOPIC_FOLDERS as readonly string[]).includes(top)) {
    return { to: `resources/${file.path}`, reason: "topic-folder" };
  }

  if (top === "local-service-pages") {
    const name = rest.join("/");
    const dated = ctx.localServicePagesDate ? `local-service-pages-${ctx.localServicePagesDate}` : "local-service-pages";
    if (rest.length > 1 || name === "README.md") return { to: `resources/${dated}/${name}`, reason: "local-service-pages" };
    if (name.startsWith("keyword-to-page-map")) return { to: `seo-page-map/${name}`, reason: "local-service-pages" };
    return { to: `content-drafts/${name}`, reason: "local-service-pages" };
  }

  if (top === "workflow-results") {
    const m = rest.length === 1 ? rest[0].match(RUN_ID_NAME) : null;
    if (!m) return { to: `resources/workflow-results/${rest.join("/")}`, reason: "workflow-results" };
    const { date, source } = extractDate(file.head, file.mtimeMs);
    return {
      to: `resources/workflow-results/${m[1]}/${date}/${rest[0]}`,
      reason: "workflow-results",
      note: source === "mtime" ? `no date in the file; used its modified time (${date})` : undefined,
    };
  }

  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:unit lib/drive-layout/rules.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add lib/drive-layout/types.ts lib/drive-layout/rules.ts lib/drive-layout/rules.test.ts
git commit -m "feat(drive-layout): routing rules for the client folder restructure"
```

---

### Task 2: Planner (duplicates, optional renames, collisions, idempotency)

**Files:**
- Create: `lib/drive-layout/plan.ts`
- Test: `lib/drive-layout/plan.test.ts`

**Interfaces:**
- Consumes: `FileEntry`, `Move`, `Conflict`, `Note`, `ClientPlan` from `./types`; `routeFile`, `localServicePagesDate` from `./rules`.
- Produces: `splitDownloadSuffix(name: string): DownloadSuffix | null` where `DownloadSuffix = { stripped: string; stem: string; ext: string; n: number }`; `planClient(client: string, files: FileEntry[]): ClientPlan`. Moves are root-relative (`<client>/...`); quarantine moves target `_Duplicates-to-delete/<client>-<stem>-copy<n><ext>`. Mandatory moves come before optional ones, in file-path order.

- [ ] **Step 1: Write the failing tests**

Create `lib/drive-layout/plan.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test:unit lib/drive-layout/plan.test.ts`
Expected: FAIL, "Cannot find module './plan'".

- [ ] **Step 3: Write the implementation**

Create `lib/drive-layout/plan.ts`:

```ts
import { localServicePagesDate, routeFile } from "./rules";
import type { ClientPlan, Conflict, FileEntry, Move, Note } from "./types";

export type DownloadSuffix = { stripped: string; stem: string; ext: string; n: number };

const SUFFIX_RE = /^(.*) \((\d+)\)(\.[^./]+)?$/;

/** "report (2).csv" -> { stripped: "report.csv", stem: "report", ext: ".csv", n: 2 }. Null if the name has no download suffix. */
export function splitDownloadSuffix(name: string): DownloadSuffix | null {
  const m = name.match(SUFFIX_RE);
  if (!m) return null;
  const ext = m[3] ?? "";
  return { stripped: `${m[1]}${ext}`, stem: m[1], ext, n: Number(m[2]) };
}

const byPath = (a: FileEntry, b: FileEntry) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

type Suffixed = { file: FileEntry; parts: DownloadSuffix };
type Quarantined = { parts: DownloadSuffix; detail: string };

/** Plans every move for one client folder. Pure: no disk access. Moves are relative to the AI Assets root. */
export function planClient(client: string, input: FileEntry[]): ClientPlan {
  const files = [...input].sort(byPath);
  const byFilePath = new Map(files.map((f) => [f.path, f]));
  const conflicts: Conflict[] = [];
  const notes: Note[] = [];
  const at = (p: string) => `${client}/${p}`;

  // 1. Classify download-suffix files.
  const suffixed: Suffixed[] = [];
  const plainByHash = new Map<string, FileEntry>();
  for (const file of files) {
    const parts = splitDownloadSuffix(baseOf(file.path));
    if (parts) suffixed.push({ file, parts });
    else if (!plainByHash.has(file.sha256)) plainByHash.set(file.sha256, file);
  }

  const quarantine = new Map<string, Quarantined>(); // client-relative path -> why
  const lone: Suffixed[] = [];
  for (const s of suffixed) {
    const strippedPath = joinPath(dirOf(s.file.path), s.parts.stripped);
    const original = byFilePath.get(strippedPath);
    if (original) {
      if (original.sha256 === s.file.sha256) quarantine.set(s.file.path, { parts: s.parts, detail: `identical to ${strippedPath}` });
      else conflicts.push({ path: at(s.file.path), kind: "duplicate-differs", detail: `content differs from ${strippedPath}; left in place` });
      continue;
    }
    const twin = plainByHash.get(s.file.sha256);
    if (twin) {
      quarantine.set(s.file.path, { parts: s.parts, detail: `identical to ${twin.path}` });
      continue;
    }
    lone.push(s);
  }

  const keepers = new Map<string, DownloadSuffix>(); // lone files that get an optional suffix-strip rename
  const groups = new Map<string, Suffixed[]>();
  for (const s of lone) groups.set(s.file.sha256, [...(groups.get(s.file.sha256) ?? []), s]);
  for (const group of groups.values()) {
    group.sort((a, b) => a.parts.n - b.parts.n || (a.file.path < b.file.path ? -1 : 1));
    keepers.set(group[0].file.path, group[0].parts);
    for (const extra of group.slice(1)) {
      quarantine.set(extra.file.path, { parts: extra.parts, detail: `identical to ${group[0].file.path}` });
    }
  }

  // 2. Build moves: mandatory first, optional last, both in file-path order.
  const lspDate = localServicePagesDate(files);
  const mandatory: Move[] = [];
  const optional: Move[] = [];
  for (const file of files) {
    const q = quarantine.get(file.path);
    if (q) {
      mandatory.push({
        from: at(file.path),
        to: `_Duplicates-to-delete/${client}-${q.parts.stem}-copy${q.parts.n}${q.parts.ext}`,
        reason: "duplicate",
        detail: q.detail,
      });
      continue;
    }
    const route = routeFile(file, { localServicePagesDate: lspDate });
    let current = file.path;
    if (route) {
      mandatory.push({ from: at(file.path), to: at(route.to), reason: route.reason });
      if (route.note) notes.push({ path: at(file.path), message: route.note });
      current = route.to;
    }
    const keeper = keepers.get(file.path);
    if (keeper) {
      optional.push({
        from: at(current),
        to: at(joinPath(dirOf(current), keeper.stripped)),
        reason: "strip-suffix",
        optional: true,
      });
    }
  }

  const moves = resolveCollisions(client, files, [...mandatory, ...optional], conflicts);
  return { client, moves, conflicts, notes };
}

/**
 * Drops any move that would overwrite something: its destination already holds a file, or another move shares
 * that destination. Comparison is case-insensitive (Drive Streaming is NTFS). A move that depends on a dropped
 * move (an optional rename after a routing move) is dropped silently.
 */
function resolveCollisions(client: string, files: FileEntry[], moves: Move[], conflicts: Conflict[]): Move[] {
  const key = (p: string) => p.toLowerCase();
  const sharing = new Map<string, Move[]>();
  for (const m of moves) sharing.set(key(m.to), [...(sharing.get(key(m.to)) ?? []), m]);

  const occupied = new Set(files.map((f) => key(`${client}/${f.path}`)));
  const blocked = new Set<string>();
  const kept: Move[] = [];
  for (const m of moves) {
    if (blocked.has(key(m.from))) {
      blocked.add(key(m.to));
      continue;
    }
    const group = sharing.get(key(m.to)) ?? [];
    if (group.length > 1) {
      const others = group.filter((o) => o !== m).map((o) => o.from).join(", ");
      conflicts.push({ path: m.from, kind: "destination-exists", detail: `${m.to} is also the destination of ${others}` });
      blocked.add(key(m.to));
      continue;
    }
    occupied.delete(key(m.from));
    if (occupied.has(key(m.to))) {
      occupied.add(key(m.from));
      conflicts.push({ path: m.from, kind: "destination-exists", detail: `${m.to} already exists` });
      blocked.add(key(m.to));
      continue;
    }
    occupied.add(key(m.to));
    kept.push(m);
  }
  return kept;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test:unit lib/drive-layout/plan.test.ts`
Expected: PASS (all tests). If "keeps the lowest-numbered..." fails on move order, the sort in the file loop is by path: `data/z (1).csv` sorts before `data/z (2).csv`, so the quarantine of `(2)` comes first among mandatory moves and the optional strip of `(1)` last, which is what the test expects.

- [ ] **Step 5: Run the whole unit project to confirm nothing else broke**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/drive-layout/plan.ts lib/drive-layout/plan.test.ts
git commit -m "feat(drive-layout): planner with duplicate handling and collision safety"
```

---

### Task 3: Scanner, stale-reference finder, and report

**Files:**
- Create: `lib/drive-layout/scan.ts`
- Create: `lib/drive-layout/report.ts`
- Test: `lib/drive-layout/scan.test.ts`
- Test: `lib/drive-layout/report.test.ts`

**Interfaces:**
- Consumes: `FileEntry`, `Move`, `ClientPlan` from `./types`.
- Produces: `listClients(root: string): Promise<string[]>`; `scanClient(root: string, client: string): Promise<FileEntry[]>`; `findStaleReferences(root: string, client: string, moves: Move[]): Promise<StaleReference[]>` with `StaleReference = { file: string; mentions: string[] }` (`file` is root-relative); `emptiedFolders(files: FileEntry[], moves: Move[], client: string): string[]` (client-relative, sorted); `formatReport(input: ReportInput): string` with `ReportInput = { generatedAt: string; plans: ClientPlan[]; stale: Record<string, StaleReference[]>; emptied: Record<string, string[]> }`.

- [ ] **Step 1: Write the failing scanner tests**

Create `lib/drive-layout/scan.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findStaleReferences, listClients, scanClient } from "./scan";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drive-layout-scan-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(rel: string, content: string) {
  const full = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

describe("listClients", () => {
  it("skips shared, personal, duplicate, and dot folders and loose files", async () => {
    for (const p of ["Acme.com/a.md", "Beta.org/b.md", "Hughes Files/x.md", "_Personal-Automations/p.md", "_Duplicates-to-delete/d.md", ".claude/s.json"]) {
      await put(p, "x");
    }
    await put("README.md", "x");
    expect(await listClients(root)).toEqual(["Acme.com", "Beta.org"]);
  });
});

describe("scanClient", () => {
  it("returns sorted entries with hash and head, ignoring desktop.ini and dot files", async () => {
    await put("Acme.com/seo/a.md", "line1\nline2\n");
    await put("Acme.com/data/b.csv", "x,y\n1,2\n");
    await put("Acme.com/desktop.ini", "junk");
    await put("Acme.com/.hidden/z.md", "junk");
    const entries = await scanClient(root, "Acme.com");
    expect(entries.map((e) => e.path)).toEqual(["data/b.csv", "seo/a.md"]);
    const a = entries.find((e) => e.path === "seo/a.md")!;
    expect(a.sha256).toBe(createHash("sha256").update("line1\nline2\n").digest("hex"));
    expect(a.head).toBe("line1\nline2\n");
    expect(a.mtimeMs).toBeGreaterThan(0);
  });

  it("leaves head empty for non-text files", async () => {
    await put("Acme.com/data/p.png", "binary");
    expect((await scanClient(root, "Acme.com"))[0].head).toBe("");
  });
});

describe("findStaleReferences", () => {
  it("flags files that mention an old path but not the new one", async () => {
    await put("Acme.com/seo/a.md", "body");
    await put("Acme.com/deliverables/note.md", "See seo/a.md and resources/seo/a.md");
    await put("Acme.com/deliverables/ok.md", "See resources/seo/a.md and https://acme.com/seo/");
    const stale = await findStaleReferences(root, "Acme.com", [
      { from: "Acme.com/seo/a.md", to: "Acme.com/resources/seo/a.md", reason: "topic-folder" },
    ]);
    expect(stale).toEqual([{ file: "Acme.com/deliverables/note.md", mentions: ["seo/", "seo/a.md"] }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit lib/drive-layout/scan.test.ts`
Expected: FAIL, "Cannot find module './scan'".

- [ ] **Step 3: Write the scanner**

Create `lib/drive-layout/scan.ts`:

```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FileEntry, Move } from "./types";

const IGNORED_FILES = new Set(["desktop.ini", "Thumbs.db"]);
const SKIPPED_TOP_LEVEL = new Set(["Hughes Files", "_Personal-Automations", "_Duplicates-to-delete"]);
const TEXT_EXT = new Set([".md", ".txt", ".json", ".jsonl", ".csv", ".html"]);
const HEAD_LINES = 14;
const HEAD_BYTES = 4096;
const MAX_REFERENCE_SCAN_BYTES = 512 * 1024;

export async function listClients(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIPPED_TOP_LEVEL.has(e.name))
    .map((e) => e.name)
    .sort();
}

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || IGNORED_FILES.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function readHead(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).slice(0, HEAD_LINES).join("\n");
  } finally {
    await handle.close();
  }
}

const isText = (rel: string) => TEXT_EXT.has(path.extname(rel).toLowerCase());
const abs = (root: string, ...parts: string[]) => path.join(root, ...parts.flatMap((p) => p.split("/")));

export async function scanClient(root: string, client: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for (const rel of (await walk(abs(root, client))).sort()) {
    const full = abs(root, client, rel);
    entries.push({
      path: rel,
      sha256: await sha256File(full),
      mtimeMs: (await stat(full)).mtimeMs,
      head: isText(rel) ? await readHead(full) : "",
    });
  }
  return entries;
}

export type StaleReference = { file: string; mentions: string[] };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Text files that still mention a path this plan moves. Never edits anything. A mention only counts when it is not
 * preceded by a path character, so "resources/seo/a.md" and "https://x.com/seo/" do not match the token "seo/".
 */
export async function findStaleReferences(root: string, client: string, moves: Move[]): Promise<StaleReference[]> {
  const prefix = `${client}/`;
  const tokens = new Set<string>();
  for (const m of moves) {
    if (m.reason === "duplicate" || m.reason === "strip-suffix") continue;
    const rel = m.from.slice(prefix.length);
    tokens.add(rel);
    tokens.add(`${rel.split("/")[0]}/`);
  }
  if (tokens.size === 0) return [];
  const patterns = [...tokens].sort().map((t) => ({ token: t, re: new RegExp(`(?<![\\w./-])${escapeRe(t)}`) }));

  const results: StaleReference[] = [];
  for (const rel of await walk(abs(root, client))) {
    if (!isText(rel)) continue;
    const full = abs(root, client, rel);
    if ((await stat(full)).size > MAX_REFERENCE_SCAN_BYTES) continue;
    const text = await readFile(full, "utf8");
    const mentions = patterns.filter((p) => p.re.test(text)).map((p) => p.token);
    if (mentions.length) results.push({ file: `${client}/${rel}`, mentions });
  }
  return results.sort((a, b) => (a.file < b.file ? -1 : 1));
}
```

- [ ] **Step 4: Run to verify the scanner tests pass**

Run: `pnpm test:unit lib/drive-layout/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing report tests**

Create `lib/drive-layout/report.test.ts`:

```ts
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
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm test:unit lib/drive-layout/report.test.ts`
Expected: FAIL, "Cannot find module './report'".

- [ ] **Step 7: Write the report module**

Create `lib/drive-layout/report.ts`:

```ts
import type { StaleReference } from "./scan";
import type { ClientPlan, FileEntry, Move } from "./types";

/** Client-relative folders that will have no files left once these moves run. Folders are left in place, never removed. */
export function emptiedFolders(files: FileEntry[], moves: Move[], client: string): string[] {
  const prefix = `${client}/`;
  const moved = new Set(moves.filter((m) => m.from.startsWith(prefix)).map((m) => m.from.slice(prefix.length)));
  const candidates = new Set<string>();
  for (const p of moved) {
    const parts = p.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) candidates.add(parts.slice(0, i).join("/"));
  }
  const stay = files.map((f) => f.path).filter((p) => !moved.has(p));
  return [...candidates].filter((dir) => !stay.some((p) => p.startsWith(`${dir}/`))).sort();
}

export type ReportInput = {
  generatedAt: string;
  plans: ClientPlan[];
  stale: Record<string, StaleReference[]>;
  emptied: Record<string, string[]>;
};

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function formatReport(input: ReportInput): string {
  const mandatory = input.plans.reduce((n, p) => n + p.moves.filter((m) => !m.optional).length, 0);
  const optional = input.plans.reduce((n, p) => n + p.moves.filter((m) => m.optional).length, 0);
  const conflicts = input.plans.reduce((n, p) => n + p.conflicts.length, 0);

  const lines: string[] = [
    "# Drive restructure: dry run",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    `Totals: ${mandatory} moves, ${optional} optional renames, ${conflicts} conflicts`,
    "",
    "Nothing has been moved. Optional renames only apply with `--include-optional`. Stale references are listed, never edited.",
    "",
  ];

  for (const plan of input.plans) {
    lines.push(`## ${plan.client}`, "");
    const stale = input.stale[plan.client] ?? [];
    const emptied = input.emptied[plan.client] ?? [];
    if (!plan.moves.length && !plan.conflicts.length && !plan.notes.length) {
      lines.push("No changes needed.", "");
      continue;
    }
    if (plan.moves.length) {
      lines.push("### Moves", "", "| Reason | From | To |", "|---|---|---|");
      for (const m of plan.moves) {
        const reason = m.optional ? `${m.reason} (optional)` : m.reason;
        lines.push(`| ${reason} | ${cell(m.from)} | ${cell(m.to)} |`);
      }
      lines.push("");
    }
    if (plan.conflicts.length) {
      lines.push("### Conflicts (left alone, your decision)", "");
      for (const c of plan.conflicts) lines.push(`- ${c.kind}: \`${c.path}\`: ${c.detail}`);
      lines.push("");
    }
    if (plan.notes.length) {
      lines.push("### Notes", "");
      for (const n of plan.notes) lines.push(`- \`${n.path}\`: ${n.message}`);
      lines.push("");
    }
    if (emptied.length) {
      lines.push("### Folders left empty after the moves", "");
      for (const dir of emptied) lines.push(`- ${dir}/`);
      lines.push("");
    }
    if (stale.length) {
      lines.push("### Files that still mention an old path (not edited)", "");
      for (const s of stale) lines.push(`- \`${s.file}\`: ${s.mentions.map((t) => `\`${t}\``).join(", ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `pnpm test:unit lib/drive-layout`
Expected: PASS for rules, plan, scan, report.

- [ ] **Step 9: Commit**

```bash
git add lib/drive-layout/scan.ts lib/drive-layout/scan.test.ts lib/drive-layout/report.ts lib/drive-layout/report.test.ts
git commit -m "feat(drive-layout): tree scanner, stale-reference finder, and dry-run report"
```

---

### Task 4: Executor with manifest and undo

**Files:**
- Create: `lib/drive-layout/execute.ts`
- Test: `lib/drive-layout/execute.test.ts`

**Interfaces:**
- Consumes: `Move` from `./types`; `scanClient`, `listClients` from `./scan`; `planClient` from `./plan` (tests only).
- Produces: `type Manifest = { version: 1; root: string; createdAt: string; moves: Move[]; done: number }`; `preflight(root: string, moves: Move[]): Promise<string[]>` (problem list, empty means safe); `executeMoves(root: string, moves: Move[], manifestPath: string, opts: { includeOptional: boolean; now?: () => Date }): Promise<{ moved: number }>` (throws `Preflight failed, nothing was moved:` plus the problems; writes the manifest before the first move and after each); `undoMoves(manifestPath: string): Promise<{ restored: number; skipped: string[] }>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/drive-layout/execute.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeMoves, preflight, undoMoves, type Manifest } from "./execute";
import { planClient } from "./plan";
import { scanClient } from "./scan";

let root: string;
let manifestPath: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "drive-layout-exec-"));
  manifestPath = path.join(root, "..", `manifest-${path.basename(root)}.json`);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(manifestPath, { force: true });
});

async function put(rel: string, content: string) {
  const full = path.join(root, ...rel.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

async function snapshot(dir = root, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await snapshot(path.join(dir, e.name), childRel));
    else out[childRel] = await readFile(path.join(dir, e.name), "utf8");
  }
  return out;
}

const SCENARIO: Record<string, string> = {
  "Acme.com/BRAND.md": "brand",
  "Acme.com/plans/p.md": "same",
  "Acme.com/plans/p (1).md": "same",
  "Acme.com/seo/résumé – plan.md": "plan",
  "Acme.com/seo/Search report (1).csv": "csv",
};

async function planScenario() {
  for (const [rel, content] of Object.entries(SCENARIO)) await put(rel, content);
  return planClient("Acme.com", await scanClient(root, "Acme.com")).moves;
}

describe("executeMoves + undoMoves", () => {
  it("moves files per the plan and undo restores the original tree exactly", async () => {
    const moves = await planScenario();
    const before = await snapshot();

    const { moved } = await executeMoves(root, moves, manifestPath, { includeOptional: true });
    expect(moved).toBe(moves.length);

    const after = await snapshot();
    expect(Object.keys(after).sort()).toEqual([
      "Acme.com/BRAND.md",
      "Acme.com/plans/p.md",
      "Acme.com/resources/seo/Search report.csv",
      "Acme.com/resources/seo/résumé – plan.md",
      "_Duplicates-to-delete/Acme.com-p-copy1.md",
    ]);

    const result = await undoMoves(manifestPath);
    expect(result.skipped).toEqual([]);
    expect(result.restored).toBe(moves.length);
    expect(await snapshot()).toEqual(before);
  });

  it("skips optional renames unless asked", async () => {
    const moves = await planScenario();
    await executeMoves(root, moves, manifestPath, { includeOptional: false });
    const after = await snapshot();
    expect(after["Acme.com/resources/seo/Search report (1).csv"]).toBe("csv");
    expect(after["Acme.com/resources/seo/Search report.csv"]).toBeUndefined();
  });

  it("aborts before moving anything when a destination already exists", async () => {
    const moves = await planScenario();
    await put("_Duplicates-to-delete/Acme.com-p-copy1.md", "someone else's file");
    const before = await snapshot();

    await expect(executeMoves(root, moves, manifestPath, { includeOptional: true })).rejects.toThrow(
      /Preflight failed, nothing was moved/,
    );
    expect(await snapshot()).toEqual(before);
    await expect(stat(manifestPath)).rejects.toThrow();
  });

  it("undo restores only what the manifest says was done (interrupted run)", async () => {
    const moves = await planScenario();
    await executeMoves(root, moves, manifestPath, { includeOptional: true });

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    expect(manifest.done).toBe(moves.length);
    manifest.done = 1; // pretend the run died after the first move
    await writeFile(manifestPath, JSON.stringify(manifest));

    const result = await undoMoves(manifestPath);
    expect(result.restored).toBe(1);
    const after = await snapshot();
    expect(after[moves[0].from]).toBeDefined(); // the first move was reversed
    expect(after[moves[2].to]).toBeDefined(); // later moves are untouched (moves[2] is the résumé file)
  });

  it("undo refuses to overwrite and reports what it skipped", async () => {
    const moves = await planScenario();
    await executeMoves(root, moves, manifestPath, { includeOptional: false });
    await put(moves[0].from, "a new file appeared at the old location");

    const result = await undoMoves(manifestPath);
    expect(result.skipped.some((s) => s.includes(moves[0].from))).toBe(true);
    expect((await snapshot())[moves[0].from]).toBe("a new file appeared at the old location");
  });
});

describe("preflight", () => {
  it("reports missing sources and existing destinations together", async () => {
    await put("Acme.com/a.md", "a");
    await put("Acme.com/b.md", "b");
    const problems = await preflight(root, [
      { from: "Acme.com/a.md", to: "Acme.com/b.md", reason: "topic-folder" },
      { from: "Acme.com/missing.md", to: "Acme.com/c.md", reason: "topic-folder" },
    ]);
    expect(problems).toEqual(["destination exists: Acme.com/b.md", "missing source: Acme.com/missing.md"]);
  });

  it("follows chained moves (rename after routing)", async () => {
    await put("Acme.com/seo/x (1).md", "x");
    const problems = await preflight(root, [
      { from: "Acme.com/seo/x (1).md", to: "Acme.com/resources/seo/x (1).md", reason: "topic-folder" },
      { from: "Acme.com/resources/seo/x (1).md", to: "Acme.com/resources/seo/x.md", reason: "strip-suffix", optional: true },
    ]);
    expect(problems).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:unit lib/drive-layout/execute.test.ts`
Expected: FAIL, "Cannot find module './execute'".

- [ ] **Step 3: Write the implementation**

Create `lib/drive-layout/execute.ts`:

```ts
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Move } from "./types";

export type Manifest = {
  version: 1;
  root: string;
  createdAt: string;
  moves: Move[];
  /** Number of moves from the front of `moves` that have completed. */
  done: number;
};

const abs = (root: string, rel: string) => path.join(root, ...rel.split("/"));

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Dry-checks the moves in order against the disk. An empty list means every move can run. Writes nothing. */
export async function preflight(root: string, moves: Move[]): Promise<string[]> {
  const problems: string[] = [];
  const gone = new Set<string>();
  const added = new Set<string>();
  const has = async (rel: string) => added.has(rel) || (!gone.has(rel) && (await exists(abs(root, rel))));
  for (const m of moves) {
    if (!(await has(m.from))) problems.push(`missing source: ${m.from}`);
    if (await has(m.to)) problems.push(`destination exists: ${m.to}`);
    added.delete(m.from);
    gone.add(m.from);
    added.add(m.to);
    gone.delete(m.to);
  }
  return problems;
}

const writeManifest = (file: string, manifest: Manifest) => writeFile(file, JSON.stringify(manifest, null, 2), "utf8");

export async function executeMoves(
  root: string,
  moves: Move[],
  manifestPath: string,
  opts: { includeOptional: boolean; now?: () => Date },
): Promise<{ moved: number }> {
  const selected = moves.filter((m) => opts.includeOptional || !m.optional);
  const problems = await preflight(root, selected);
  if (problems.length) throw new Error(`Preflight failed, nothing was moved:\n${problems.join("\n")}`);

  const manifest: Manifest = { version: 1, root, createdAt: (opts.now?.() ?? new Date()).toISOString(), moves: selected, done: 0 };
  await writeManifest(manifestPath, manifest);
  for (const m of selected) {
    await mkdir(path.dirname(abs(root, m.to)), { recursive: true });
    await rename(abs(root, m.from), abs(root, m.to));
    manifest.done += 1;
    await writeManifest(manifestPath, manifest);
  }
  return { moved: selected.length };
}

/** Reverses the completed moves, newest first. Never overwrites; anything it cannot restore is reported. */
export async function undoMoves(manifestPath: string): Promise<{ restored: number; skipped: string[] }> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const skipped: string[] = [];
  let restored = 0;
  for (const m of manifest.moves.slice(0, manifest.done).reverse()) {
    const from = abs(manifest.root, m.from);
    const to = abs(manifest.root, m.to);
    if (!(await exists(to))) {
      skipped.push(`${m.to} is missing, cannot restore ${m.from}`);
      continue;
    }
    if (await exists(from)) {
      skipped.push(`${m.from} already exists, left ${m.to} in place`);
      continue;
    }
    await mkdir(path.dirname(from), { recursive: true });
    await rename(to, from);
    restored += 1;
  }
  if (skipped.length === 0) {
    manifest.done = 0;
    await writeManifest(manifestPath, manifest);
  }
  return { restored, skipped };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `pnpm test:unit lib/drive-layout/execute.test.ts`
Expected: PASS (all tests). The empty `resources/` and `_Duplicates-to-delete/` folders left behind by undo do not affect the snapshot because it records files only.

- [ ] **Step 5: Run the whole unit project**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/drive-layout/execute.ts lib/drive-layout/execute.test.ts
git commit -m "feat(drive-layout): executor with preflight, manifest, and undo"
```

---

### Task 5: CLI and a read-only dry run on the real Drive

**Files:**
- Create: `scripts/restructure-drive.ts`
- Modify: `package.json` (add one script after `import:ai-assets`)

**Interfaces:**
- Consumes: everything exported by `lib/drive-layout/*` above.
- Produces: `pnpm drive:restructure dry-run <AI-Assets-path> [--out <file>]`, `pnpm drive:restructure execute <AI-Assets-path> --manifest <file> [--include-optional] --yes`, `pnpm drive:restructure undo <manifest>`.

- [ ] **Step 1: Write the CLI**

Create `scripts/restructure-drive.ts`:

```ts
// Plans, applies, and undoes the Drive layout migration in
// docs/superpowers/specs/2026-10-05-phase0-drive-workspace-and-skills-design.md (section 3).
// Usage:
//   pnpm drive:restructure dry-run <AI-Assets-path> [--out report.md]
//   pnpm drive:restructure execute <AI-Assets-path> --manifest <file.json> [--include-optional] --yes
//   pnpm drive:restructure undo <manifest.json>
import { writeFile } from "node:fs/promises";
import { executeMoves, undoMoves } from "../lib/drive-layout/execute";
import { planClient } from "../lib/drive-layout/plan";
import { emptiedFolders, formatReport } from "../lib/drive-layout/report";
import { findStaleReferences, listClients, scanClient, type StaleReference } from "../lib/drive-layout/scan";
import type { ClientPlan, FileEntry } from "../lib/drive-layout/types";

const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith("--")) positional.push(a);
  else if (a === "--out" || a === "--manifest") flags.set(a, rest[++i] ?? "");
  else flags.set(a, true);
}

function usage(): never {
  console.error(
    "Usage:\n  drive:restructure dry-run <AI-Assets-path> [--out file]\n" +
      "  drive:restructure execute <AI-Assets-path> --manifest <file> [--include-optional] --yes\n" +
      "  drive:restructure undo <manifest>",
  );
  process.exit(2);
}

async function planAll(root: string) {
  const plans: ClientPlan[] = [];
  const stale: Record<string, StaleReference[]> = {};
  const emptied: Record<string, string[]> = {};
  for (const client of await listClients(root)) {
    const files: FileEntry[] = await scanClient(root, client);
    const plan = planClient(client, files);
    plans.push(plan);
    stale[client] = plan.moves.length ? await findStaleReferences(root, client, plan.moves) : [];
    emptied[client] = emptiedFolders(files, plan.moves, client);
  }
  return { plans, stale, emptied };
}

async function main() {
  if (command === "dry-run") {
    const root = positional[0] ?? usage();
    const report = formatReport({ generatedAt: new Date().toISOString().slice(0, 10), ...(await planAll(root)) });
    const out = flags.get("--out");
    if (typeof out === "string" && out) {
      await writeFile(out, report, "utf8");
      console.log(`Report written to ${out}`);
    } else {
      console.log(report);
    }
    return;
  }

  if (command === "execute") {
    const root = positional[0] ?? usage();
    const manifest = flags.get("--manifest");
    if (typeof manifest !== "string" || !manifest) usage();
    if (flags.get("--yes") !== true) {
      console.error("Refusing to move files without --yes. Run dry-run first and review the report.");
      process.exit(2);
    }
    const { plans } = await planAll(root);
    const moves = plans.flatMap((p) => p.moves);
    const includeOptional = flags.get("--include-optional") === true;
    const { moved } = await executeMoves(root, moves, manifest, { includeOptional });
    console.log(`Moved ${moved} file(s). Manifest: ${manifest}. Undo with: pnpm drive:restructure undo ${manifest}`);
    return;
  }

  if (command === "undo") {
    const manifest = positional[0] ?? usage();
    const { restored, skipped } = await undoMoves(manifest);
    console.log(`Restored ${restored} file(s).`);
    for (const s of skipped) console.warn(`Skipped: ${s}`);
    if (skipped.length) process.exit(1);
    return;
  }

  usage();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the package script**

In `package.json`, in `"scripts"`, add this line directly after the `"import:ai-assets"` line (add a comma to that line):

```json
    "drive:restructure": "tsx scripts/restructure-drive.ts"
```

- [ ] **Step 3: Type-check the new files**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors in `lib/drive-layout/*` or `scripts/restructure-drive.ts`. (If `scripts/` is outside the tsconfig `include`, run `pnpm exec tsx --check scripts/restructure-drive.ts` or just run Step 4; the CLI executing without a type error at runtime is sufficient.)

- [ ] **Step 4: Run the dry run on the real Drive (read-only)**

Run:

```bash
pnpm drive:restructure dry-run "C:/Users/ogDevOps/Google Drive Streaming/My Drive/AI Assets" --out docs/superpowers/drive-restructure-dry-run-2026-10-05.md
```

Expected: `Report written to docs/superpowers/drive-restructure-dry-run-2026-10-05.md`, exit 0. Nothing in Drive changes.

- [ ] **Step 5: Sanity-check the report against what was observed in the survey**

Open the report. It must show: for `Myelitegutters.com`, the six topic folders moving under `resources/` and the `local-service-pages` split; for `Bradleybrowninc.com` and `Midstatewelding.com`, the five workflow-results files nested by workflow and date (the `pre-launch-seo-audit-report` file with a modified-time note); the `(1)`/`(2)`/`(3)` files as quarantine, conflict, or optional renames; `Mercyhouseatc.com-vehicledonation`'s three `Search keyword report` CSVs as conflicts; and "No changes needed." for `Mercyhouseatc.com`, `Superthriftdeals.org`, and `Roofcoms.com`. If the report disagrees with the survey, fix the rule and add a test before continuing.

- [ ] **Step 6: Commit the code, not the report**

```bash
git add scripts/restructure-drive.ts package.json
git commit -m "feat(drive-layout): drive:restructure CLI (dry-run, execute, undo)"
```

---

### Task 6: Owner review gate, execution, and Drive docs (human-gated)

This task changes files in the owner's Google Drive. **Do not start Step 3 until the owner has read the report and said yes.**

**Files:**
- Modify (in Drive, outside the repo): `AI Assets/README.md`, `AI Assets/CLAUDE.md`, `AI Assets/.claude/skills/organize-inbox/SKILL.md`

**Interfaces:**
- Consumes: the report from Task 5 and the CLI.
- Produces: a migrated Drive tree, a manifest file, and Drive docs that describe the new layout.

- [ ] **Step 1: Present the report and stop**

Summarize `docs/superpowers/drive-restructure-dry-run-2026-10-05.md` for the owner: counts per client, every conflict, every note, the stale-reference list. Ask: (a) go ahead with the mandatory moves? (b) include the optional suffix-strip renames? (c) how to resolve each conflict (these are left in place regardless).

- [ ] **Step 2: Confirm Drive is idle**

Ask the owner to confirm Google Drive for desktop shows no pending sync and no Magister download is in progress. Moving files mid-sync can race.

- [ ] **Step 3: Execute (only after yes)**

Run:

```bash
pnpm drive:restructure execute "C:/Users/ogDevOps/Google Drive Streaming/My Drive/AI Assets" --manifest docs/superpowers/drive-restructure-manifest-2026-10-05.json --yes
```

Add `--include-optional` only if the owner said yes to (b).
Expected: `Moved N file(s). Manifest: ... Undo with: ...`. If it prints `Preflight failed, nothing was moved:`, report the listed problems; nothing changed.

- [ ] **Step 4: Verify the result**

Run the dry run again:

```bash
pnpm drive:restructure dry-run "C:/Users/ogDevOps/Google Drive Streaming/My Drive/AI Assets"
```

Expected: `Totals: 0 moves` (plus optional renames if they were skipped, plus the conflicts the owner chose to leave), and every migrated client shows "No changes needed." or only conflicts. Also list `Myelitegutters.com/resources` and confirm the six topic folders, `local-service-pages-2026-10-03`, and `audits` are there, and that `Myelitegutters.com/content-drafts` and `seo-page-map` exist.

- [ ] **Step 5: Update the Drive docs**

`AI Assets/README.md`: replace the fenced layout block under `## Layout` with:

````
```
Hughes Files/                 Shared across all clients
  workspace/                  Platform agent contract: AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md
  skills/<skill-name>/        Reusable skills: SKILL.md + references/ assets/ evals/evals.json
  workflow-templates/<name>/  Generic workflow SKILL.md files with no client inputs filled in

<client-domain>/              One folder per client (same structure for every client)
  BRAND.md PLAN.md PROJECT.md INTEGRATIONS.md WORKFLOWS.md MEMORY.md   System-managed exports, when present
  audits/                     Dated Magister audit snapshots (*-full-audit.md); system-managed
  plans/                      Older or archived plan versions
  memory/                     Dated agent memory checkpoints, MEMORY.md, USER.md
  data/                       CSV/XLSX/JSON exports (Ads, GA, Formspree, call logs, GTM)
  workflows/<name>/SKILL.md   Client-specific workflow forks with inputs filled in
  ads-audit/<date>-<scope>/   ads-audit skill output (report.md, findings.json, scores.json)
  ads-optimize/<date>-<scope>/ ads-optimize skill output (plan.md)
  content-drafts/             Drafts awaiting review
  seo-page-map/               Keyword-to-page maps
  deliverables/               Proposals, briefs, agreements, content
  archive/                    Superseded versions (optional)
  resources/
    audits/                   Named audit snapshots
    ai-answer-foundation/ ai-visibility/ geo-technical-fixes/ mobile-lead-path/ paid-search/ seo/
    local-service-pages-<date>/
    workflow-results/<workflow-slug>/<date>/   Workflow run reports

_Personal-Automations/        Non-marketing task prompts
_Duplicates-to-delete/        Byte-identical copies, safe to delete after review
```
````

`AI Assets/CLAUDE.md`: in the `<client-domain>/` bullet under Architecture, replace "identical subfolder set per client (`audits/`, `plans/`, `ads-audit/`, `ads-optimize/`, `workflow-results/`, `deliverables/`, `data/`, `memory/`, `workflows/`)" with "identical layout per client; see `README.md` (system files and `audits/`, `plans/`, `memory/`, `data/`, `workflows/`, `ads-audit/`, `ads-optimize/`, `content-drafts/`, `seo-page-map/`, `deliverables/` at the client root; topic folders and `workflow-results/<workflow>/<date>/` under `resources/`)". In "Rules that matter when editing", change "Dated outputs go in dated paths:" list to add "`resources/workflow-results/<workflow>/<date>/`" and "`resources/local-service-pages-<date>/`".

`AI Assets/.claude/skills/organize-inbox/SKILL.md`: in the step 2 table, replace the client-folder row's destination text with: "That client folder: audit snapshots → `resources/audits/` (full audits → `audits/`); CSV/XLSX/JSON exports & evidence → `data/`; briefs, articles, proposals → `deliverables/`; drafts for review → `content-drafts/`; keyword/page maps → `seo-page-map/`; topic work (AI answers, GEO fixes, mobile, paid search, SEO) → `resources/<topic>/`; workflow run reports → `resources/workflow-results/<workflow-slug>/<date>/`; ads-audit output → `ads-audit/<date>-<scope>/`". Read each file first and edit only those passages.

- [ ] **Step 6: Report back**

Tell the owner what moved, what was left (conflicts), where the manifest is, and how to undo. Do not commit the report or manifest unless the owner asks.

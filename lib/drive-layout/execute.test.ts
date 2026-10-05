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

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

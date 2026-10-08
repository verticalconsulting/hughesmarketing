import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Move } from "./types";

export type Manifest = {
  version: 1;
  /** Absolute path of the AI Assets folder the moves are relative to. */
  root: string;
  createdAt: string;
  moves: Move[];
  /** Number of moves from the front of `moves` that have completed. */
  done: number;
};

/** Turns a root-relative path into a real one, refusing anything that could land outside the root. */
function abs(root: string, rel: string): string {
  const base = path.resolve(root);
  const segments = rel.split("/");
  if (path.isAbsolute(rel) || rel.includes("\\") || segments.includes("..")) {
    throw new Error(`Path is outside the AI Assets root or not a plain relative path: ${rel}`);
  }
  const full = path.resolve(base, ...segments);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Path is outside the AI Assets root: ${rel}`);
  }
  return full;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** fs.rename silently replaces an existing destination on Windows, so look first. */
export async function renameNoClobber(from: string, to: string): Promise<void> {
  if (await exists(to)) throw new Error(`destination appeared during the run: ${to}`);
  await rename(from, to);
}

/** Writes beside the target and renames over it, so a crash never leaves a half-written file. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
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

export async function executeMoves(
  root: string,
  moves: Move[],
  manifestPath: string,
  opts: { includeOptional: boolean; now?: () => Date },
): Promise<{ moved: number }> {
  const base = path.resolve(root);
  // The manifest is the only undo record. A second run must never replace the first run's.
  if (await exists(manifestPath)) {
    throw new Error(
      `Manifest already exists: ${manifestPath}. Undo it first (pnpm drive:restructure undo "${manifestPath}") or choose a new manifest name.`,
    );
  }
  const selected = moves.filter((m) => opts.includeOptional || !m.optional);
  const problems = await preflight(base, selected);
  if (problems.length) throw new Error(`Preflight failed, nothing was moved:\n${problems.join("\n")}`);

  const manifest: Manifest = { version: 1, root: base, createdAt: (opts.now?.() ?? new Date()).toISOString(), moves: selected, done: 0 };
  await writeJsonAtomic(manifestPath, manifest);
  for (const m of selected) {
    try {
      await mkdir(path.dirname(abs(base, m.to)), { recursive: true });
      await renameNoClobber(abs(base, m.from), abs(base, m.to));
      manifest.done += 1;
      await writeJsonAtomic(manifestPath, manifest);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `${reason}\n${manifest.done} of ${selected.length} moves completed. Manifest: ${manifestPath}. ` +
          `Undo with: pnpm drive:restructure undo "${manifestPath}"`,
      );
    }
  }
  return { moved: selected.length };
}

function parseManifest(text: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Not a valid manifest: the file is not readable JSON.");
  }
  const m = raw as Partial<Manifest> | null;
  if (
    !m ||
    m.version !== 1 ||
    typeof m.root !== "string" ||
    !path.isAbsolute(m.root) ||
    !Array.isArray(m.moves) ||
    !Number.isInteger(m.done) ||
    (m.done as number) < 0 ||
    (m.done as number) > m.moves.length
  ) {
    throw new Error("Not a valid manifest: expected version 1 with an absolute root, a moves list, and a done count.");
  }
  for (const move of m.moves) {
    abs(m.root, move.from); // throws if either path could leave the root
    abs(m.root, move.to);
  }
  return m as Manifest;
}

/** Reverses the completed moves, newest first. Never overwrites; anything it cannot restore is reported. */
export async function undoMoves(manifestPath: string): Promise<{ restored: number; skipped: string[] }> {
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
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
    await writeJsonAtomic(manifestPath, manifest);
  }
  return { restored, skipped };
}

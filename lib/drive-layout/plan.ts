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
  // A copy only counts as a duplicate of a file with the same name and the same bytes. Matching on bytes alone
  // would call every empty "(1)" file a copy of every other empty file.
  const nameAndHash = (name: string, sha: string) => `${name}\u0000${sha}`;
  const suffixed: Suffixed[] = [];
  const plainByNameAndHash = new Map<string, FileEntry>();
  for (const file of files) {
    const parts = splitDownloadSuffix(baseOf(file.path));
    if (parts) {
      suffixed.push({ file, parts });
      continue;
    }
    const key = nameAndHash(baseOf(file.path), file.sha256);
    if (!plainByNameAndHash.has(key)) plainByNameAndHash.set(key, file);
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
    const twin = plainByNameAndHash.get(nameAndHash(s.parts.stripped, s.file.sha256));
    if (twin) {
      quarantine.set(s.file.path, { parts: s.parts, detail: `identical to ${twin.path}` });
      continue;
    }
    lone.push(s);
  }

  const keepers = new Map<string, DownloadSuffix>(); // lone files that get an optional suffix-strip rename
  const groups = new Map<string, Suffixed[]>();
  for (const s of lone) {
    const key = `${dirOf(s.file.path)}\u0000${nameAndHash(s.parts.stripped, s.file.sha256)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
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

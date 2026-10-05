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

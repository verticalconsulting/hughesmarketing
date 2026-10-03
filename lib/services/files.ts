import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { files, fileVersions } from "@/lib/data/schema";
import { guessContentType, isTextContentType } from "@/lib/domain/content-type";
import { normalizePath, PathError } from "@/lib/domain/paths";
import { closeMatches } from "@/lib/domain/text";
import { getBlobStore } from "@/lib/storage/blob";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type FileInfo = { path: string; version: number; size: number; contentType: string; updatedAt: Date };

const scope = (brandId: string | null) => (brandId ? eq(files.brandId, brandId) : isNull(files.brandId));

function safePath(p: string): string {
  try {
    return normalizePath(p);
  } catch (e) {
    if (e instanceof PathError) throw new ValidationError(e.message, "path");
    throw e;
  }
}

function storageKey(brandId: string | null, path: string, version: number): string {
  return `${brandId ?? "shared"}/v${version}/${path}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function notFound(brandId: string | null, path: string): Promise<never> {
  const all = await db.select({ path: files.path }).from(files).where(scope(brandId));
  throw new NotFoundError(`File "${path}" not found`, closeMatches(path, all.map((f) => f.path)));
}

export async function findFileId(brandId: string | null, path: string, tx: DbOrTx = db): Promise<string> {
  const p = safePath(path);
  const [f] = await tx.select({ id: files.id }).from(files).where(and(scope(brandId), eq(files.path, p)));
  if (!f) return notFound(brandId, p);
  return f.id;
}

export async function writeFile(input: {
  brandId: string | null;
  path: string;
  content: string | Uint8Array;
  contentType?: string;
  expectedVersion?: number;
  actor: Actor;
  quiet?: boolean;
}): Promise<{ fileId: string; path: string; version: number; unchanged: boolean }> {
  const path = safePath(input.path);
  const bytes = typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
  const contentType = input.contentType ?? guessContentType(path);
  const blob = getBlobStore();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(files).where(and(scope(input.brandId), eq(files.path, path))).for("update");
    const current = existing?.currentVersion ?? 0;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
      throw new ConflictError(`Version mismatch for ${path}: expected ${input.expectedVersion}, current is ${current}`, {
        path,
        currentVersion: current,
      });
    }
    if (existing) {
      const [cur] = await tx
        .select({ storageKey: fileVersions.storageKey })
        .from(fileVersions)
        .where(and(eq(fileVersions.fileId, existing.id), eq(fileVersions.version, current)));
      if (cur && sameBytes(await blob.get(cur.storageKey), bytes)) {
        return { fileId: existing.id, path, version: current, unchanged: true };
      }
    }

    const version = current + 1;
    const key = storageKey(input.brandId, path, version);
    await blob.put(key, bytes, contentType);

    let fileId: string;
    if (existing) {
      await tx.update(files).set({ currentVersion: version, size: bytes.length, contentType }).where(eq(files.id, existing.id));
      fileId = existing.id;
    } else {
      const [created] = await tx
        .insert(files)
        .values({ brandId: input.brandId, path, contentType, size: bytes.length, currentVersion: version })
        .returning({ id: files.id });
      fileId = created.id;
    }
    await tx.insert(fileVersions).values({ fileId, version, storageKey: key, size: bytes.length, author: input.actor.label });
    if (!input.quiet) {
      await logActivity(
        { brandId: input.brandId, actor: input.actor, kind: "file", summary: `Wrote ${path} (v${version})`, refType: "file", refId: fileId },
        tx,
      );
    }
    return { fileId, path, version, unchanged: false };
  });
}

export async function readFile(input: { brandId: string | null; path: string; version?: number }) {
  const path = safePath(input.path);
  const [f] = await db.select().from(files).where(and(scope(input.brandId), eq(files.path, path)));
  if (!f) return notFound(input.brandId, path);
  const version = input.version ?? f.currentVersion;
  const [v] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, f.id), eq(fileVersions.version, version)));
  if (!v) throw new NotFoundError(`Version ${version} of "${path}" not found`);
  const bytes = await getBlobStore().get(v.storageKey);
  return {
    fileId: f.id,
    path,
    version,
    contentType: f.contentType,
    size: v.size,
    bytes,
    text: isTextContentType(f.contentType) ? new TextDecoder().decode(bytes) : null,
  };
}

export async function listFiles(input: { brandId: string | null; prefix?: string }): Promise<FileInfo[]> {
  const prefix = input.prefix ? input.prefix.replace(/\\/g, "/").replace(/^\/+/, "") : "";
  const rows = await db
    .select()
    .from(files)
    .where(prefix ? and(scope(input.brandId), like(files.path, `${prefix.replace(/[%_]/g, "\\$&")}%`)) : scope(input.brandId))
    .orderBy(files.path);
  return rows.map((r) => ({ path: r.path, version: r.currentVersion, size: r.size, contentType: r.contentType, updatedAt: r.updatedAt }));
}

export async function listVersions(input: { brandId: string | null; path: string }) {
  const fileId = await findFileId(input.brandId, input.path);
  return db
    .select({ version: fileVersions.version, author: fileVersions.author, size: fileVersions.size, createdAt: fileVersions.createdAt })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version));
}

export async function fileDownloadUrl(input: { brandId: string | null; path: string; version?: number }): Promise<string> {
  const fileId = await findFileId(input.brandId, input.path);
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  const version = input.version ?? f.currentVersion;
  const [v] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, version)));
  if (!v) throw new NotFoundError(`Version ${version} of "${input.path}" not found`);
  return getBlobStore().signedUrl(v.storageKey, 300);
}

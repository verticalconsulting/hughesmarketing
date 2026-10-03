import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { apiTokens, users } from "@/lib/data/schema";
import { ValidationError } from "./errors";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export async function createApiToken(userId: string, name: string): Promise<{ id: string; token: string }> {
  if (!name.trim()) throw new ValidationError("Token name is required", "name");
  const token = `hm_${randomBytes(32).toString("base64url")}`;
  const [row] = await db.insert(apiTokens).values({ userId, name: name.trim(), tokenHash: hash(token) }).returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function verifyApiToken(raw: string) {
  const [row] = await db
    .select({ tokenId: apiTokens.id, userId: apiTokens.userId, name: apiTokens.name, email: users.email })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hash(raw)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  return row;
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

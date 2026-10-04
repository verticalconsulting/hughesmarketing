import { getEnv } from "@/lib/env";
import { db } from "@/lib/data/db";
import { users } from "@/lib/data/schema";

export type SessionUser = { id: string; email: string; name: string | null; avatarUrl: string | null };

export function isAllowedEmail(email: string): boolean {
  return getEnv().ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export async function upsertUserByEmail(input: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const [u] = await db
    .insert(users)
    .values({ email, name: input.name ?? null, avatarUrl: input.avatarUrl ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: input.name ?? null, avatarUrl: input.avatarUrl ?? null },
    })
    .returning();
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl };
}

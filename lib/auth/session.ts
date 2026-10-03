import { redirect } from "next/navigation";
import type { Actor } from "@/lib/services/actor";
import { isAllowedEmail, upsertUserByEmail, type SessionUser } from "@/lib/services/users";
import { bypassEmail } from "./bypass";
import { createSupabaseServerClient } from "./supabase-server";

export async function requireUser(): Promise<SessionUser> {
  const bypass = bypassEmail();
  if (bypass) return upsertUserByEmail({ email: bypass, name: "Local Dev" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isAllowedEmail(user.email)) redirect("/login");
  return upsertUserByEmail({
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });
}

export function actorFor(user: SessionUser): Actor {
  return { kind: "user", userId: user.id, label: user.email };
}

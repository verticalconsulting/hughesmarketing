import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isAllowedEmail, upsertUserByEmail } from "@/lib/services/users";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data.user?.email;
  if (error || !email) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", url.origin));
  }
  await upsertUserByEmail({
    email,
    name: (data.user?.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (data.user?.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  return NextResponse.redirect(new URL("/", url.origin));
}

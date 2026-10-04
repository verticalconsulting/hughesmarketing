// Local development and E2E only. VERCEL is always set on Vercel deployments, so this can never activate there.
export function bypassEmail(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL) return null;
  if (env.ALLOW_AUTH_BYPASS !== "true") return null;
  return env.AUTH_BYPASS_EMAIL?.trim().toLowerCase() || null;
}

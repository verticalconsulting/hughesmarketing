export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeDomain(s: string): string {
  const withoutProto = s.trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  return withoutProto.split(/[/?#]/)[0];
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function closeMatches(needle: string, haystack: string[], max = 3): string[] {
  const n = needle.toLowerCase();
  return haystack
    .map((h) => ({ h, d: h.includes(n) || n.includes(h) ? 0 : levenshtein(n, h) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.h);
}

const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#14b8a6", "#8b5cf6", "#f59e0b", "#22c55e", "#ec4899", "#ef4444"];
export function colorForSlug(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

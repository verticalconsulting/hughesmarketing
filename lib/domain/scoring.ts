export const CATEGORIES = ["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ai_visibility: "AI Visibility",
  geo: "GEO",
  seo: "SEO",
  website_content: "Website & Content",
  social: "Social Media",
  paid_ads: "Paid Ads",
};

export type Weights = Record<Category, number>;
export const DEFAULT_WEIGHTS: Weights = {
  ai_visibility: 20,
  geo: 15,
  seo: 20,
  website_content: 20,
  social: 10,
  paid_ads: 15,
};

export const MIN_COVERAGE = 0.6;
export type CategoryScores = Partial<Record<Category, number>>;

export function isPartial(coverage: number): boolean {
  return coverage < MIN_COVERAGE;
}

export function computeHealth(
  scores: CategoryScores,
  weights: Weights = DEFAULT_WEIGHTS,
): { health: number | null; coverage: number; partial: boolean } {
  const total = CATEGORIES.reduce((sum, c) => sum + weights[c], 0);
  let weighted = 0;
  let present = 0;
  for (const c of CATEGORIES) {
    const s = scores[c];
    if (s === undefined) continue;
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      throw new RangeError(`Score for ${c} must be between 0 and 100 (got ${s})`);
    }
    weighted += weights[c] * s;
    present += weights[c];
  }
  const coverage = total === 0 ? 0 : present / total;
  if (present === 0) return { health: null, coverage: 0, partial: true };
  return { health: Math.round(weighted / present), coverage, partial: isPartial(coverage) };
}

export function summarizeHealth(
  auditsNewestFirst: { health: number | null; coverage: number }[],
): { health: number | null; delta: number | null } {
  const full = auditsNewestFirst.filter((a) => a.health !== null && !isPartial(a.coverage));
  const latest = full[0]?.health ?? null;
  const previous = full[1]?.health ?? null;
  return { health: latest, delta: latest !== null && previous !== null ? latest - previous : null };
}

// The arrow already carries the sign of a drop, so show its magnitude (not "▼ -12").
export function formatDelta(delta: number): string {
  return delta >= 0 ? `▲ +${delta}` : `▼ ${Math.abs(delta)}`;
}

export type Band = "red" | "amber" | "green";
export function band(score: number): Band {
  if (score < 40) return "red";
  if (score < 70) return "amber";
  return "green";
}

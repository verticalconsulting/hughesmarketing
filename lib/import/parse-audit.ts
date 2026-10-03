import type { Category } from "@/lib/domain/scoring";

const HEADINGS: Record<string, Category> = {
  "ai visibility": "ai_visibility",
  geo: "geo",
  seo: "seo",
  "website & content": "website_content",
  "social media": "social",
  "paid ads": "paid_ads",
};

export function parseAuditMarkdown(md: string): { category: Category; score: number; evidence: string | null }[] {
  const out: { category: Category; score: number; evidence: string | null }[] = [];
  let current: { category: Category; score: number | null; evidence: string | null } | null = null;
  const flush = () => {
    if (current && current.score !== null) out.push({ category: current.category, score: current.score, evidence: current.evidence });
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const cat = HEADINGS[heading[1].toLowerCase()];
      current = cat && !out.some((o) => o.category === cat) ? { category: cat, score: null, evidence: null } : null;
      continue;
    }
    if (!current) continue;
    const readiness = /\*\*Readiness:\*\*\s*(\d{1,3})\s*\/\s*100/.exec(line);
    if (readiness && current.score === null) {
      current.score = Math.min(100, Number(readiness[1]));
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(line.trim());
    if (bullet && current.evidence === null && current.score !== null) current.evidence = bullet[1].slice(0, 300);
  }
  flush();
  return out;
}

export function auditDateFromFilename(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?-/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

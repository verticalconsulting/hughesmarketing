import { missingOnboardingQuestions, missingPlanQuestions, type Question } from "@/lib/domain/questions";
import { summarizeHealth } from "@/lib/domain/scoring";
import { listAudits, type AuditWithScores } from "./audits";
import { getBrandBySlug } from "./brands";
import { listIntegrations } from "./integrations";
import { getActivePlan, type PlanItemView, type PlanView } from "./plans";
import { listTrackers, type TrackerSummary } from "./trackers";

const OPEN = new Set(["planned", "active", "needs_approval", "approved", "blocked"]);

export type BrandContext = {
  brand: { name: string; slug: string; domain: string | null; stage: string };
  onboarding: { answers: Record<string, unknown>; missing: string[] };
  health: { health: number | null; delta: number | null };
  latestAudit: AuditWithScores | null;
  activePlan: PlanView | null;
  openItems: PlanItemView[];
  trackers: TrackerSummary[];
  integrations: {
    service: string;
    status: string;
    identifiers: Record<string, string>;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  }[];
};

export async function getBrandContext(slug: string): Promise<BrandContext> {
  const brand = await getBrandBySlug(slug);
  const [audits, activePlan, trackers, integrations] = await Promise.all([
    listAudits(brand.id),
    getActivePlan(brand.id),
    listTrackers(brand.id),
    listIntegrations(brand.id),
  ]);
  return {
    brand: { name: brand.name, slug: brand.slug, domain: brand.domain, stage: brand.stage },
    onboarding: { answers: brand.onboarding, missing: missingOnboardingQuestions(brand.onboarding).map((q) => q.key) },
    health: summarizeHealth(audits),
    latestAudit: audits[0] ?? null,
    activePlan,
    openItems: activePlan?.items.filter((i) => OPEN.has(i.status)) ?? [],
    trackers,
    integrations: integrations.map((i) => ({
      service: i.service,
      status: i.status,
      identifiers: i.identifiers,
      lastSyncedAt: i.lastSyncedAt,
      lastSyncError: i.lastSyncError,
    })),
  };
}

export async function getPlanQuestions(slug: string): Promise<Question[]> {
  const brand = await getBrandBySlug(slug);
  return missingPlanQuestions(brand.onboarding);
}

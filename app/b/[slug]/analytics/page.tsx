import { CategoryTrend } from "@/components/analytics/category-trend";
import { HealthTrend } from "@/components/analytics/health-trend";
import { TrackersTable } from "@/components/analytics/trackers-table";
import { isPartial } from "@/lib/domain/scoring";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { listTrackers } from "@/lib/services/trackers";

export default async function AnalyticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const [audits, trackers] = await Promise.all([listAudits(brand.id), listTrackers(brand.id)]);
  const chronological = [...audits].reverse();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const healthPoints = chronological
    .filter((a) => a.health !== null && !isPartial(a.coverage))
    .map((a) => ({ date: fmt(a.auditedAt), health: a.health! }));
  const categoryPoints = chronological.map((a) => ({
    date: fmt(a.auditedAt),
    ...Object.fromEntries(a.scores.map((s) => [s.category, s.score])),
  }));
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="font-display text-3xl font-semibold">Analytics</h1>
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Health over time</h2>
        <p className="text-xs text-muted-foreground">Full audits only; partial audits are excluded.</p>
        <HealthTrend points={healthPoints} />
      </section>
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Categories</h2>
        <CategoryTrend points={categoryPoints} />
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Did the changes work?</h2>
        <TrackersTable trackers={trackers} />
      </section>
    </div>
  );
}

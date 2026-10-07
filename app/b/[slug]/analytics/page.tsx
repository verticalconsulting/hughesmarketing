import { CategoryTrend } from "@/components/analytics/category-trend";
import { HealthTrend } from "@/components/analytics/health-trend";
import { RangeToggle } from "@/components/analytics/range-toggle";
import { SearchChart } from "@/components/analytics/search-chart";
import { SyncNote } from "@/components/analytics/sync-note";
import { TopTable } from "@/components/analytics/top-table";
import { TrackersTable } from "@/components/analytics/trackers-table";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import { addDays, aggregateWindow, getMetric, isoDay, mergeSeries, pageLabel } from "@/lib/domain/metrics";
import { isPartial } from "@/lib/domain/scoring";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { listIntegrations } from "@/lib/services/integrations";
import { getMetricSeries, getTopDimension } from "@/lib/services/metrics";
import { listTrackers } from "@/lib/services/trackers";

const nf = new Intl.NumberFormat("en-US");

function Stat({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p data-testid={id} className="text-xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  const range: 30 | 90 = (await searchParams).range === "30" ? 30 : 90;
  const brand = await getBrandBySlug(slug);
  const to = addDays(isoDay(new Date()), -1);
  const from = addDays(to, -(range - 1));
  const [audits, trackers, integrations, traffic, search, topQueries, topPages] = await Promise.all([
    listAudits(brand.id),
    listTrackers(brand.id),
    listIntegrations(brand.id),
    getMetricSeries({ brandId: brand.id, source: "ga4", metrics: ["sessions", "users", "key_events"], from, to }),
    getMetricSeries({ brandId: brand.id, source: "gsc", metrics: ["clicks", "impressions", "ctr", "position"], from, to }),
    getTopDimension({ brandId: brand.id, metric: "query_clicks", from, to }),
    getTopDimension({ brandId: brand.id, metric: "page_clicks", from, to }),
  ]);
  const ga4 = integrations.find((i) => i.service === "ga4");
  const gsc = integrations.find((i) => i.service === "gsc");

  const chronological = [...audits].reverse();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const healthPoints = chronological
    .filter((a) => a.health !== null && !isPartial(a.coverage))
    .map((a) => ({ date: fmt(a.auditedAt), health: a.health! }));
  const categoryPoints = chronological.map((a) => ({
    date: fmt(a.auditedAt),
    ...Object.fromEntries(a.scores.map((s) => [s.category, s.score])),
  }));

  const gscTotal = (id: string) => aggregateWindow(getMetric("gsc", id)!, search);
  const clicks = gscTotal("clicks");
  const impressions = gscTotal("impressions");
  const ctr = gscTotal("ctr");
  const position = gscTotal("position");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-3xl font-semibold">Analytics</h1>
        <RangeToggle slug={slug} range={range} />
      </div>
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Health over time</h2>
        <p className="text-xs text-muted-foreground">Full audits only; partial audits are excluded.</p>
        <HealthTrend points={healthPoints} />
      </section>
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">Categories</h2>
        <CategoryTrend points={categoryPoints} />
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div>
          <h2 className="font-semibold">Traffic (GA4)</h2>
          <SyncNote label="Google Analytics 4" integration={ga4} />
        </div>
        {ga4?.status === "connected" && <TrafficChart points={mergeSeries(traffic, { zeroFill: true })} />}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div>
          <h2 className="font-semibold">Search (Search Console)</h2>
          <SyncNote label="Google Search Console" integration={gsc} />
        </div>
        {gsc?.status === "connected" && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat id="gsc-clicks" label="Clicks" value={clicks === null ? "—" : nf.format(clicks)} />
              <Stat id="gsc-impressions" label="Impressions" value={impressions === null ? "—" : nf.format(impressions)} />
              <Stat id="gsc-ctr" label="CTR" value={ctr === null ? "—" : `${(ctr * 100).toFixed(1)}%`} />
              <Stat id="gsc-position" label="Avg. position" value={position === null ? "—" : position.toFixed(1)} />
            </div>
            <SearchChart points={mergeSeries({ clicks: search.clicks, impressions: search.impressions }, { zeroFill: true })} />
            <div className="grid gap-3 md:grid-cols-2">
              <TopTable title="Top queries (clicks)" rows={topQueries} />
              <TopTable title="Top pages (clicks)" rows={topPages} labelFor={pageLabel} />
            </div>
          </>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Did the changes work?</h2>
        <TrackersTable trackers={trackers} />
      </section>
    </div>
  );
}

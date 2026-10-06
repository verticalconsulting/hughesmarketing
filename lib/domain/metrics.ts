export const METRIC_SOURCES = ["ga4", "gsc"] as const;
export type MetricSource = (typeof METRIC_SOURCES)[number];
export type Direction = "up" | "down";
export type Aggregation = "sum" | "ctr" | "weighted_position";

export type MetricDef = {
  id: string;
  source: MetricSource;
  label: string;
  unit: string | null;
  direction: Direction;
  aggregation: Aggregation;
  /** True when rows carry a non-empty `dimension` (top queries / pages). Never charted or tracked as a daily total. */
  dimensional: boolean;
};

const def = (
  source: MetricSource,
  id: string,
  label: string,
  over: Partial<Pick<MetricDef, "unit" | "direction" | "aggregation" | "dimensional">> = {},
): MetricDef => ({ source, id, label, unit: null, direction: "up", aggregation: "sum", dimensional: false, ...over });

export const METRICS: readonly MetricDef[] = [
  def("ga4", "sessions", "Sessions"),
  // Unique users across a window cannot be rebuilt from daily rows, so this is a sum of daily active users.
  def("ga4", "users", "Users (user-days)", { unit: "user-days" }),
  def("ga4", "key_events", "Key events"),
  def("gsc", "clicks", "Clicks"),
  def("gsc", "impressions", "Impressions"),
  def("gsc", "ctr", "CTR", { unit: "ratio", aggregation: "ctr" }),
  def("gsc", "position", "Average position", { direction: "down", aggregation: "weighted_position" }),
  def("gsc", "query_clicks", "Clicks by query", { dimensional: true }),
  def("gsc", "page_clicks", "Clicks by page", { dimensional: true }),
];

export const getMetric = (source: MetricSource, id: string): MetricDef | undefined =>
  METRICS.find((m) => m.source === source && m.id === id);

/** "ga4:sessions" → { source, metric }. Anything else (free text, dimensional metrics) → null. */
export function parseTrackerSource(value: string): { source: MetricSource; metric: string } | null {
  const m = /^(ga4|gsc):([a-z_]+)$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const found = getMetric(m[1] as MetricSource, m[2]);
  return found && !found.dimensional ? { source: found.source, metric: found.id } : null;
}

export type Series = { date: string; value: number }[];

/** The daily-total metrics that must be loaded to aggregate `def` over a window. */
export function requiredMetrics(def: MetricDef): string[] {
  switch (def.aggregation) {
    case "sum":
      return [def.id];
    case "ctr":
      return ["clicks", "impressions"];
    case "weighted_position":
      return ["position", "impressions"];
  }
}

const total = (s: Series | undefined) => (s ?? []).reduce((acc, p) => acc + p.value, 0);

/** One number for a whole window. `null` means "cannot be computed" (no impressions), never "zero". */
export function aggregateWindow(def: MetricDef, series: Record<string, Series>): number | null {
  switch (def.aggregation) {
    case "sum":
      return total(series[def.id]);
    case "ctr": {
      const impressions = total(series.impressions);
      return impressions > 0 ? total(series.clicks) / impressions : null;
    }
    case "weighted_position": {
      const weights = new Map((series.impressions ?? []).map((p) => [p.date, p.value]));
      let num = 0;
      let den = 0;
      for (const p of series.position ?? []) {
        const w = weights.get(p.date);
        if (w && w > 0) {
          num += p.value * w;
          den += w;
        }
      }
      return den > 0 ? num / den : null;
    }
  }
}

export const FIRST_SYNC_DAYS = 90;
export const ROLLING_DAYS = 7;
export const MAX_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number): string => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS));
export const endOfDay = (iso: string): Date => new Date(Date.parse(`${iso}T23:59:59.999Z`));

/**
 * How far back a sync should reach when the caller did not say. A first sync backfills; later syncs re-pull a rolling
 * week (GSC revises recent days), or longer when the last sync was more than a week ago, so no day is ever skipped.
 */
export function defaultSyncDays(opts: { firstSync: boolean; lastSyncedAt: Date | null; now: Date }): number {
  if (opts.firstSync) return FIRST_SYNC_DAYS;
  if (!opts.lastSyncedAt) return ROLLING_DAYS;
  const gap = Math.ceil((opts.now.getTime() - opts.lastSyncedAt.getTime()) / DAY_MS) + 1;
  return Math.min(MAX_DAYS, Math.max(ROLLING_DAYS, gap));
}

/** The last `days` complete UTC days: ends yesterday because today's data is incomplete. */
export function syncRange(now: Date, days: number): { from: string; to: string } {
  const to = addDays(isoDay(now), -1);
  return { from: addDays(to, -(days - 1)), to };
}

export function windowRange(to: string, windowDays: number): { from: string; to: string } {
  return { from: addDays(to, -(windowDays - 1)), to };
}

export function parsePropertyId(raw: string | undefined): string | null {
  const v = raw?.trim().replace(/^properties\//, "");
  return v && /^\d{3,15}$/.test(v) ? v : null;
}

export function parseSiteUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^sc-domain:[a-z0-9.-]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** The v1 importer stores the Search Console site under `site`; the editor documents `site_url`. Accept both. */
export const siteIdentifier = (identifiers: Record<string, string>): string | undefined => identifiers.site_url ?? identifiers.site;

export function mergeSeries(series: Record<string, Series>, opts: { zeroFill?: boolean } = {}): Record<string, string | number>[] {
  const byDate = new Map<string, Record<string, string | number>>();
  for (const [metric, points] of Object.entries(series)) {
    for (const p of points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[metric] = p.value;
      byDate.set(p.date, row);
    }
  }
  const rows = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (opts.zeroFill) for (const row of rows) for (const m of Object.keys(series)) row[m] ??= 0;
  return rows;
}

export function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

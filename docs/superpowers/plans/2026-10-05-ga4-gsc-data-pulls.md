# GA4 + Search Console Data Pulls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app pull its own daily Google Analytics 4 and Search Console metrics per brand (manual "Sync now" button and an MCP `sync_metrics` tool), chart them on the Analytics tab, and auto check-in trackers whose source is `ga4:<metric>` or `gsc:<metric>`.

**Architecture:** One Google service account (key in `GOOGLE_SERVICE_ACCOUNT_JSON`) authenticates plain REST calls (`google-auth-library` for the token only). Pure connectors (`lib/connectors/ga4.ts`, `gsc.ts`) turn API responses into `MetricPointInput[]`; `lib/services/metrics.ts` orchestrates sync per source inside a per-(brand, source) advisory-locked transaction, upserts into a generic `metric_points` table, records status on the integration, feeds trackers through the existing `addCheckin`, and logs activity. The UI button, the MCP tool, and later a cron all call the same service function.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM + Postgres (Supabase), zod, recharts, vitest (unit + integration projects), Playwright, `google-auth-library` (new).

**Spec:** `docs/superpowers/specs/2026-10-05-ga4-gsc-data-pulls-design.md` (builds on `docs/superpowers/specs/2026-10-02-marketing-workspace-design.md`). Task 10 amends the spec where this plan makes a concrete choice the spec left open.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- Google auth is one **service account**; no per-user OAuth, no refresh tokens. Scopes are read-only: `analytics.readonly` and `webmasters.readonly`.
- The key lives only in env `GOOGLE_SERVICE_ACCOUNT_JSON`. It is **never printed, logged, committed, returned by a tool, put in an activity row, or included in an error message**. The service account's public `client_email` may appear in error messages.
- Sync is **manual only** (button + MCP tool). No cron in this slice.
- Storage is the generic `metric_points` table, **daily** granularity, unique on (`brand_id`, `source`, `metric`, `date`, `dimension`), RLS enabled (deny-all for anon).
- One GA4 property and one GSC site per brand, held in `integrations.identifiers`.
- HTTP uses built-in `fetch`; the only new dependency is `google-auth-library`. Charts use the existing `recharts`.
- First sync of a source backfills **90 days**; later syncs re-pull a rolling **7 days** (longer when the last sync was more than 7 days ago, so no day is skipped); `days` overrides, max **400**; the range **ends yesterday (UTC)**.
- Upserts run in batches of **500** rows. Re-running a sync never duplicates data.
- A failure on one source never blocks the other. A sync never changes `integrations.status`.
- Tracker auto check-ins: at most one per tracker per window-end date, source string `"<source>:<metric> (auto)"`; v1 verdict logic is unchanged.
- Repo conventions: TypeScript, double quotes, semicolons, 2-space indent, `@/` import alias, services throw `DomainError` subclasses, tests next to code (`lib/**/*.test.ts` = unit project) or in `tests/integration/*.test.ts` (integration project, real Postgres test DB).
- Commits: end each commit message with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (plus any session trailer your harness specifies). Never push to `main`; never force-push.

## Review Focus

Failure modes the spec implies but a straightforward implementation would miss. Each has a test in the task that owns the code.

1. **Key pasted wrong.** `GOOGLE_SERVICE_ACCOUNT_JSON` that is not valid JSON (for example a pretty-printed multi-line paste) must give a readable "not configured / must be one line" error, never a stack trace and never echo any part of the value. (Task 3)
2. **Zero-traffic site.** GA4 or GSC returns no rows for a window. The sync must succeed with 0 rows, the sum-style tracker value is 0 (not an error, not null), and ratio metrics with no impressions produce no check-in. (Tasks 1 and 6)
3. **Double click / agent and button at once.** Two concurrent syncs of the same brand and source: the second is skipped with "already running"; no duplicate rows, no duplicate check-ins. (Task 6)
4. **Identifier formats people actually paste.** `properties/515827425`, a site URL without trailing slash, `sc-domain:` properties, and the legacy importer key `site` (the v1 importer stores the Search Console site under `site`, not `site_url`). (Tasks 1, 4, 5)
5. **Window longer than synced history.** A 30-day tracker when only 7 days have ever been synced must not receive a misleading partial-window check-in. (Task 6)

## File Structure

**Create**

| Path | Responsibility |
|---|---|
| `lib/domain/metrics.ts` (+ `.test.ts`) | Metric catalog, aggregation rules, date-range helpers, identifier parsing, series merge, page label. Pure. |
| `lib/connectors/types.ts` | `MetricPointInput`, `FetchContext`, `Connector`, `Connectors`. |
| `lib/connectors/errors.ts` | `ConnectorError` with stable `code`. |
| `lib/connectors/google-auth.ts` (+ test) | Parse service-account env, access token per scope, test-only API base override. |
| `lib/connectors/http.ts` (+ test) | `postJson` with one retry and status → `ConnectorError` mapping. |
| `lib/connectors/ga4.ts` (+ test) | GA4 Data API `runReport` → points. |
| `lib/connectors/gsc.ts` (+ test) | Search Console `searchAnalytics.query` (daily + top queries/pages) → points. |
| `lib/services/metrics.ts` | `syncBrandMetrics`, `getMetricSeries`, `getTopDimension`, tracker feed. |
| `app/actions/metrics.ts` | `syncMetricsAction` server action for the button. |
| `components/analytics/traffic-chart.tsx`, `search-chart.tsx`, `top-table.tsx`, `sync-note.tsx`, `range-toggle.tsx` | Analytics tab pieces. |
| `drizzle/0002_*.sql` (+ meta) | Migration: `metric_points`, integration columns, RLS. |
| `tests/integration/metric-points.test.ts`, `metrics.test.ts` | Schema and service tests. |
| `tests/e2e/fake-google.ts`, `tests/e2e/z-metrics-sync.spec.ts` | Fake Google server and the e2e. |

**Modify**

`lib/data/schema.ts`, `lib/env.ts` (+ `lib/env.test.ts`), `tests/helpers/db.ts`, `lib/mcp/tools.ts`, `lib/services/context.ts`, `lib/prompts.ts` (+ test), `components/workspace/integrations-pane.tsx`, `app/b/[slug]/analytics/page.tsx`, `tests/integration/mcp-tools.test.ts`, `tests/e2e/global-setup.ts`, `playwright.config.ts`, `scripts/verify-deployment.ts`, `docs/superpowers/deploy-runbook.md`, `README.md`, the spec, `package.json` and `pnpm-lock.yaml`.

## Prerequisites (do once, before Task 1)

You are in the worktree `.claude/worktrees/ga4-gsc-data-pulls` on branch `worktree-ga4-gsc-data-pulls`.

- [ ] `pnpm install --frozen-lockfile` (the worktree has no `node_modules`).
- [ ] Integration tests need a Postgres test database. If `.env.test` is missing in this worktree it is gitignored: copy it from the main checkout (`D:\sources\hughes-marketing\.env.test`) without printing it. Start Docker Desktop and local Supabase (`pnpm dlx supabase start`), then once: `pnpm tsx scripts/create-test-db.ts && pnpm db:migrate:test`.
- [ ] Baseline is green before you change anything: `pnpm test` → all pass. If it is not, stop and report; do not build on a red baseline.

---

### Task 1: Metric domain — catalog, aggregation, ranges, identifiers

**Files:**
- Create: `lib/domain/metrics.ts`
- Test: `lib/domain/metrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact names; later tasks import them):
  - `METRIC_SOURCES = ["ga4", "gsc"] as const`, `type MetricSource`
  - `type Direction = "up" | "down"`, `type Aggregation = "sum" | "ctr" | "weighted_position"`
  - `type MetricDef = { id: string; source: MetricSource; label: string; unit: string | null; direction: Direction; aggregation: Aggregation; dimensional: boolean }`
  - `METRICS: readonly MetricDef[]`, `getMetric(source: MetricSource, id: string): MetricDef | undefined`
  - `parseTrackerSource(value: string): { source: MetricSource; metric: string } | null`
  - `type Series = { date: string; value: number }[]`
  - `requiredMetrics(def: MetricDef): string[]`
  - `aggregateWindow(def: MetricDef, series: Record<string, Series>): number | null`
  - `FIRST_SYNC_DAYS = 90`, `ROLLING_DAYS = 7`, `MAX_DAYS = 400`
  - `defaultSyncDays(opts: { firstSync: boolean; lastSyncedAt: Date | null; now: Date }): number`
  - `isoDay(d: Date): string`, `addDays(iso: string, n: number): string`, `endOfDay(iso: string): Date`
  - `syncRange(now: Date, days: number): { from: string; to: string }`, `windowRange(to: string, windowDays: number): { from: string; to: string }`
  - `parsePropertyId(raw: string | undefined): string | null`, `parseSiteUrl(raw: string | undefined): string | null`, `siteIdentifier(identifiers: Record<string, string>): string | undefined`
  - `mergeSeries(series: Record<string, Series>, opts?: { zeroFill?: boolean }): Record<string, string | number>[]`
  - `pageLabel(url: string): string`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregateWindow,
  defaultSyncDays,
  endOfDay,
  getMetric,
  mergeSeries,
  pageLabel,
  parsePropertyId,
  parseSiteUrl,
  parseTrackerSource,
  requiredMetrics,
  siteIdentifier,
  syncRange,
  windowRange,
  type Series,
} from "./metrics";

const s = (...pairs: [string, number][]): Series => pairs.map(([date, value]) => ({ date, value }));
const gsc = (id: string) => getMetric("gsc", id)!;
const ga4 = (id: string) => getMetric("ga4", id)!;

describe("metric catalog", () => {
  it("knows each metric's source, direction, and whether it is dimensional", () => {
    expect(getMetric("ga4", "sessions")).toMatchObject({ aggregation: "sum", direction: "up", dimensional: false });
    expect(getMetric("gsc", "position")).toMatchObject({ aggregation: "weighted_position", direction: "down" });
    expect(getMetric("gsc", "query_clicks")?.dimensional).toBe(true);
    expect(getMetric("ga4", "clicks")).toBeUndefined();
  });
});

describe("parseTrackerSource", () => {
  it("accepts source:metric for daily-total metrics, case-insensitively", () => {
    expect(parseTrackerSource("ga4:sessions")).toEqual({ source: "ga4", metric: "sessions" });
    expect(parseTrackerSource(" GSC:CTR ")).toEqual({ source: "gsc", metric: "ctr" });
  });

  it("rejects free text, unknown metrics, dimensional metrics, and the auto suffix", () => {
    for (const bad of ["GA4", "Google Ads", "ga4:bounce_rate", "gsc:query_clicks", "ga4:sessions (auto)", ""]) {
      expect(parseTrackerSource(bad)).toBeNull();
    }
  });
});

describe("aggregateWindow", () => {
  it("sums count metrics and treats an empty window as zero (a zero-traffic site is not an error)", () => {
    expect(aggregateWindow(ga4("sessions"), { sessions: s(["2026-10-01", 10], ["2026-10-02", 5]) })).toBe(15);
    expect(aggregateWindow(ga4("sessions"), { sessions: [] })).toBe(0);
    expect(aggregateWindow(ga4("sessions"), {})).toBe(0);
  });

  it("recomputes CTR from total clicks over total impressions, not by averaging daily CTR", () => {
    const series = {
      clicks: s(["d1", 9], ["d2", 9]),
      impressions: s(["d1", 900], ["d2", 100]),
      ctr: s(["d1", 0.01], ["d2", 0.09]),
    };
    expect(aggregateWindow(gsc("ctr"), series)).toBeCloseTo(0.018);
  });

  it("returns null for CTR and position when there are no impressions", () => {
    expect(aggregateWindow(gsc("ctr"), { clicks: [], impressions: [] })).toBeNull();
    expect(aggregateWindow(gsc("position"), { position: s(["d1", 3]), impressions: [] })).toBeNull();
  });

  it("weights average position by impressions and ignores days without an impressions row", () => {
    const series = {
      position: s(["d1", 2], ["d2", 10], ["d3", 99]),
      impressions: s(["d1", 900], ["d2", 100]),
    };
    expect(aggregateWindow(gsc("position"), series)).toBeCloseTo(2.8);
  });

  it("lists the metrics each aggregation needs", () => {
    expect(requiredMetrics(ga4("sessions"))).toEqual(["sessions"]);
    expect(requiredMetrics(gsc("ctr"))).toEqual(["clicks", "impressions"]);
    expect(requiredMetrics(gsc("position"))).toEqual(["position", "impressions"]);
  });
});

describe("date ranges", () => {
  it("ends the sync range at yesterday (UTC)", () => {
    expect(syncRange(new Date("2026-10-05T12:00:00Z"), 7)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(syncRange(new Date("2026-10-05T00:00:00Z"), 1)).toEqual({ from: "2026-10-04", to: "2026-10-04" });
    expect(syncRange(new Date("2026-10-05T12:00:00Z"), 90)).toEqual({ from: "2026-07-07", to: "2026-10-04" });
  });

  it("covers windowDays days ending at `to`", () => {
    expect(windowRange("2026-10-04", 30)).toEqual({ from: "2026-09-05", to: "2026-10-04" });
    expect(windowRange("2026-10-04", 1)).toEqual({ from: "2026-10-04", to: "2026-10-04" });
  });

  it("adds days across month boundaries and finds the end of a day", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(endOfDay("2026-10-04").toISOString()).toBe("2026-10-04T23:59:59.999Z");
  });
});

describe("defaultSyncDays", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("backfills 90 days on the first sync", () => {
    expect(defaultSyncDays({ firstSync: true, lastSyncedAt: null, now })).toBe(90);
  });

  it("re-pulls a rolling 7 days after a recent sync", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2026-10-05T11:00:00Z"), now })).toBe(7);
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: null, now })).toBe(7);
  });

  it("reaches back over a gap longer than the rolling window so no days are missed", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2026-09-15T12:00:00Z"), now })).toBe(21);
  });

  it("never exceeds 400 days", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2025-01-01T00:00:00Z"), now })).toBe(400);
  });
});

describe("identifiers", () => {
  it("accepts the GA4 property id formats people paste", () => {
    expect(parsePropertyId("515827425")).toBe("515827425");
    expect(parsePropertyId(" properties/515827425 ")).toBe("515827425");
    for (const bad of ["UA-123456-1", "12", "abc", "", undefined]) expect(parsePropertyId(bad)).toBeNull();
  });

  it("accepts sc-domain and URL-prefix Search Console sites and normalizes a bare origin", () => {
    expect(parseSiteUrl("sc-domain:example.com")).toBe("sc-domain:example.com");
    expect(parseSiteUrl("https://example.com")).toBe("https://example.com/");
    expect(parseSiteUrl("https://example.com/blog/")).toBe("https://example.com/blog/");
    for (const bad of ["example.com", "ftp://example.com/", "sc-domain:bad host", "", undefined]) {
      expect(parseSiteUrl(bad)).toBeNull();
    }
  });

  it("reads the site from site_url, falling back to the importer's legacy `site` key", () => {
    expect(siteIdentifier({ site_url: "a", site: "b" })).toBe("a");
    expect(siteIdentifier({ site: "b" })).toBe("b");
    expect(siteIdentifier({})).toBeUndefined();
  });
});

describe("mergeSeries", () => {
  it("joins metrics by date in date order, optionally zero-filling missing values", () => {
    const series = { sessions: s(["2026-10-02", 5], ["2026-10-01", 3]), users: s(["2026-10-01", 2]) };
    expect(mergeSeries(series, { zeroFill: true })).toEqual([
      { date: "2026-10-01", sessions: 3, users: 2 },
      { date: "2026-10-02", sessions: 5, users: 0 },
    ]);
    expect(mergeSeries(series)[1]).toEqual({ date: "2026-10-02", sessions: 5 });
  });
});

describe("pageLabel", () => {
  it("shows the path and query of a URL, and leaves non-URLs alone", () => {
    expect(pageLabel("https://x.com/a/b?x=1")).toBe("/a/b?x=1");
    expect(pageLabel("https://x.com/")).toBe("/");
    expect(pageLabel("not a url")).toBe("not a url");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit lib/domain/metrics.test.ts`
Expected: FAIL — cannot resolve `./metrics`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/metrics.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit lib/domain/metrics.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/metrics.ts lib/domain/metrics.test.ts
git commit -m "feat(metrics): metric catalog, aggregation, ranges, identifier parsing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Data layer — schema, migration, env, test reset

**Files:**
- Modify: `lib/data/schema.ts` (imports; `integrations` table; new `metricPoints` table), `lib/env.ts`, `lib/env.test.ts`, `tests/helpers/db.ts`, `package.json`, `pnpm-lock.yaml`
- Create: `drizzle/0002_*.sql` (generated; then edited), `drizzle/meta/*` (generated), `tests/integration/metric-points.test.ts`

**Interfaces:**
- Consumes: existing `brands`, `integrations` tables and the `id()` / `timestamps` helpers in `lib/data/schema.ts`.
- Produces:
  - `metricPoints` table: `{ id, brandId, source: string, metric: string, date: string ("YYYY-MM-DD"), dimension: string (default ""), value: number (double precision), createdAt, updatedAt }`, unique constraint `metric_points_key` on (`brandId`, `source`, `metric`, `date`, `dimension`), index `metric_points_lookup`.
  - `integrations.lastSyncedAt: Date | null`, `integrations.lastSyncError: string | null`, `integrations.syncedFrom: string | null` ("YYYY-MM-DD": the earliest day this source has been synced end to end; lets the tracker feed tell "no data" from "never fetched").
  - `getEnv().GOOGLE_SERVICE_ACCOUNT_JSON: string | undefined`.
  - `resetDb()` also truncates `metric_points`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/env.test.ts`, inside the existing `describe("parseEnv", ...)` block, before its closing `});`:

```ts
  it("treats GOOGLE_SERVICE_ACCOUNT_JSON as optional so existing deployments keep working", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://x" }).GOOGLE_SERVICE_ACCOUNT_JSON).toBeUndefined();
    expect(parseEnv({ DATABASE_URL: "postgresql://x", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" }).GOOGLE_SERVICE_ACCOUNT_JSON).toBe("{}");
  });
```

Create `tests/integration/metric-points.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { db, sql } from "@/lib/data/db";
import { brands, integrations, metricPoints } from "@/lib/data/schema";
import { createBrand } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

const point = (brandId: string, over: Partial<typeof metricPoints.$inferInsert> = {}) => ({
  brandId,
  source: "ga4",
  metric: "sessions",
  date: "2026-10-01",
  value: 10,
  ...over,
});

describe("metric_points", () => {
  it("allows one row per brand, source, metric, date, and dimension", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await db.insert(metricPoints).values(point(b.id));
    await expect(db.insert(metricPoints).values(point(b.id, { value: 11 }))).rejects.toThrow();
    // A different dimension or date is a different row.
    await db.insert(metricPoints).values([point(b.id, { dimension: "query:roof" }), point(b.id, { date: "2026-10-02" })]);
    expect(await db.select().from(metricPoints)).toHaveLength(3);
  });

  it("defaults the dimension to an empty string and stores the date as YYYY-MM-DD", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const [row] = await db.insert(metricPoints).values(point(b.id)).returning();
    expect(row.dimension).toBe("");
    expect(row.date).toBe("2026-10-01");
  });

  it("has row-level security enabled, like every other table", async () => {
    const rows = await sql`select relrowsecurity from pg_class where relname = 'metric_points'`;
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("is deleted with its brand", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await db.insert(metricPoints).values(point(b.id));
    await db.delete(brands).where(eq(brands.id, b.id));
    expect(await db.select().from(metricPoints)).toHaveLength(0);
  });
});

describe("integrations sync columns", () => {
  it("start empty and survive an upsert", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const [row] = await listIntegrations(b.id);
    expect(row.lastSyncedAt).toBeNull();
    expect(row.lastSyncError).toBeNull();
    expect(row.syncedFrom).toBeNull();
    await db
      .update(integrations)
      .set({ lastSyncedAt: new Date("2026-10-04T00:00:00Z"), lastSyncError: "x", syncedFrom: "2026-07-07" })
      .where(eq(integrations.id, row.id));
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const [after] = await listIntegrations(b.id);
    expect(after.lastSyncedAt).toEqual(new Date("2026-10-04T00:00:00Z"));
    expect(after.lastSyncError).toBe("x");
    expect(after.syncedFrom).toBe("2026-07-07");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run --project unit lib/env.test.ts` → the new env test FAILS (`GOOGLE_SERVICE_ACCOUNT_JSON` is stripped by zod).
Run: `pnpm exec vitest run --project integration tests/integration/metric-points.test.ts` → FAILS (`metricPoints` is not exported).

- [ ] **Step 3: Add the env variable**

In `lib/env.ts`, add one line inside the `z.object({ ... })`, after `AUTH_BYPASS_EMAIL`:

```ts
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
```

- [ ] **Step 4: Add the schema**

In `lib/data/schema.ts`:

1. In the `drizzle-orm/pg-core` import list add `date`, `doublePrecision`, and `index` (keep the list alphabetical: `boolean, date, doublePrecision, index, integer, jsonb, ...`).
2. In the `integrations` table, after `verifiedAt`, add:

```ts
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    syncedFrom: date("synced_from", { mode: "string" }),
```

3. After the `integrations` table definition, add:

```ts
export const metricPoints = pgTable(
  "metric_points",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    metric: text("metric").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    dimension: text("dimension").notNull().default(""),
    value: doublePrecision("value").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("metric_points_key").on(t.brandId, t.source, t.metric, t.date, t.dimension),
    index("metric_points_lookup").on(t.brandId, t.source, t.metric, t.date),
  ],
);
```

- [ ] **Step 5: Generate the migration, enable RLS, apply to the test DB**

```bash
pnpm db:generate
f=$(ls drizzle/0002_*.sql) && printf '\n--> statement-breakpoint\nALTER TABLE "metric_points" ENABLE ROW LEVEL SECURITY;\n' >> "$f" && cat "$f"
pnpm db:migrate:test
```

Expected: the file contains `CREATE TABLE "metric_points"`, three `ALTER TABLE "integrations" ADD COLUMN` statements (`last_synced_at`, `last_sync_error`, `synced_from`), the unique constraint, the index, and the final `ENABLE ROW LEVEL SECURITY` statement; `db:migrate:test` reports success. Do not hand-edit anything else in `drizzle/meta`.

- [ ] **Step 6: Make the test reset clear the new table**

In `tests/helpers/db.ts`, change the TRUNCATE list to start with `metric_points`:

```ts
  await sql`TRUNCATE metric_points, activities, tracker_checkins, trackers, plan_item_files, plan_items, plans,
    audit_scores, audits, file_versions, files, integrations, brands, api_tokens, users,
    companies, scoring_config RESTART IDENTITY CASCADE`;
```

- [ ] **Step 7: Add the dependency**

Run: `pnpm add google-auth-library`
Expected: `package.json` gains `google-auth-library` under `dependencies`; lockfile updated.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS — the new env test and all of `metric-points.test.ts`, and nothing that passed before has regressed.

- [ ] **Step 9: Commit**

```bash
git add lib/data/schema.ts lib/env.ts lib/env.test.ts tests/helpers/db.ts tests/integration/metric-points.test.ts drizzle package.json pnpm-lock.yaml
git commit -m "feat(metrics): metric_points table, integration sync columns, optional Google key env" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Connector foundation — types, errors, auth, HTTP

**Files:**
- Create: `lib/connectors/types.ts`, `lib/connectors/errors.ts`, `lib/connectors/google-auth.ts`, `lib/connectors/http.ts`
- Test: `lib/connectors/google-auth.test.ts`, `lib/connectors/http.test.ts`

**Interfaces:**
- Consumes: `MetricSource` from `@/lib/domain/metrics` (Task 1); `getEnv().GOOGLE_SERVICE_ACCOUNT_JSON` (Task 2).
- Produces:
  - `type MetricPointInput = { metric: string; date: string; dimension: string; value: number }`
  - `type FetchContext = { identifiers: Record<string, string>; from: string; to: string }`
  - `type Connector = (ctx: FetchContext) => Promise<MetricPointInput[]>`; `type Connectors = Record<MetricSource, Connector>`
  - `type ConnectorErrorCode = "not_configured" | "permission_denied" | "not_found" | "bad_identifier" | "quota" | "unavailable"`; `class ConnectorError extends Error { code: ConnectorErrorCode }`
  - `SCOPES`, `parseServiceAccount(raw: string | undefined): { client_email: string; private_key: string }`, `apiBase(defaultBase: string): string`, `usingFakeGoogle(): boolean`, `getAccessToken(source: "ga4" | "gsc"): Promise<string>`, `serviceAccountEmail(): string | null`
  - `postJson<T>(o: { url: string; token: string; body: unknown; what: string; serviceAccountEmail?: string | null; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Promise<T>`

- [ ] **Step 1: Write the failing tests**

Create `lib/connectors/google-auth.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors";
import { apiBase, parseServiceAccount } from "./google-auth";

afterEach(() => vi.unstubAllEnvs());

function failure(raw: string | undefined): ConnectorError {
  try {
    parseServiceAccount(raw);
  } catch (e) {
    return e as ConnectorError;
  }
  throw new Error("expected parseServiceAccount to throw");
}

describe("parseServiceAccount", () => {
  it("returns the client email and private key", () => {
    const sa = parseServiceAccount(JSON.stringify({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: "KEY", other: 1 }));
    expect(sa).toEqual({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: "KEY" });
  });

  it("explains an unset value", () => {
    for (const raw of [undefined, "", "   "]) {
      const e = failure(raw);
      expect(e).toBeInstanceOf(ConnectorError);
      expect(e.code).toBe("not_configured");
      expect(e.message).toMatch(/not configured/i);
    }
  });

  it("explains invalid JSON (for example a pretty-printed paste) without echoing any of it", () => {
    // A truncated paste: valid-looking start, no closing brace.
    const e = failure('{\n  "client_email": "a@b.c",\n  "private_key": "SECRETVALUE"\n');
    expect(e.code).toBe("not_configured");
    expect(e.message).toMatch(/one line/i);
    expect(e.message).not.toContain("SECRETVALUE");
    expect(String(e.stack)).not.toContain("SECRETVALUE");
  });

  it("explains a key file that lacks client_email or private_key without echoing it", () => {
    const e = failure(JSON.stringify({ client_email: "a@b.c", note: "SECRETVALUE" }));
    expect(e.code).toBe("not_configured");
    expect(e.message).toMatch(/client_email and private_key/);
    expect(e.message).not.toContain("SECRETVALUE");
  });
});

describe("apiBase", () => {
  it("uses the real base by default", () => {
    expect(apiBase("https://analyticsdata.googleapis.com/")).toBe("https://analyticsdata.googleapis.com");
  });

  it("uses the test override outside production", () => {
    vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://127.0.0.1:3199/");
    expect(apiBase("https://analyticsdata.googleapis.com")).toBe("http://127.0.0.1:3199");
  });

  it("ignores the test override in production", () => {
    vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://127.0.0.1:3199");
    vi.stubEnv("NODE_ENV", "production");
    expect(apiBase("https://analyticsdata.googleapis.com")).toBe("https://analyticsdata.googleapis.com");
  });
});
```

Create `lib/connectors/http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorError } from "./errors";
import { postJson } from "./http";

const base = { url: "https://example.test/x", token: "SECRET-TOKEN", body: { a: 1 }, what: "GA4 property 515827425", sleep: async () => {} };
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

async function failure(p: Promise<unknown>): Promise<ConnectorError> {
  try {
    await p;
  } catch (e) {
    return e as ConnectorError;
  }
  throw new Error("expected a rejection");
}

describe("postJson", () => {
  it("posts JSON with a bearer token and returns the parsed body", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const out = await postJson<{ ok: boolean }>({
      ...base,
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init! };
        return res(200, { ok: true });
      },
    });
    expect(out).toEqual({ ok: true });
    expect(seen?.url).toBe("https://example.test/x");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-TOKEN");
    expect(seen?.init.body).toBe('{"a":1}');
  });

  it("maps 403 to permission_denied naming the service account and the target, and never leaks the token", async () => {
    const e = await failure(postJson({ ...base, serviceAccountEmail: "sync@proj.iam.gserviceaccount.com", fetchImpl: async () => res(403, { error: "SECRET-BODY" }) }));
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("sync@proj.iam.gserviceaccount.com");
    expect(e.message).toContain("GA4 property 515827425");
    expect(e.message).not.toContain("SECRET-TOKEN");
    expect(e.message).not.toContain("SECRET-BODY");
  });

  it("maps 404 and 400 to not_found and bad_identifier", async () => {
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(404) }))).code).toBe("not_found");
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(400) }))).code).toBe("bad_identifier");
  });

  it("retries once on 429 and succeeds", async () => {
    let calls = 0;
    const out = await postJson<{ ok: boolean }>({ ...base, fetchImpl: async () => (++calls === 1 ? res(429) : res(200, { ok: true })) });
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("gives up after one retry: quota for 429, unavailable for 5xx and network errors", async () => {
    let calls = 0;
    const quota = await failure(postJson({ ...base, fetchImpl: async () => (calls++, res(429)) }));
    expect(quota.code).toBe("quota");
    expect(calls).toBe(2);
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(503) }))).code).toBe("unavailable");
    expect((await failure(postJson({ ...base, fetchImpl: async () => { throw new TypeError("fetch failed"); } }))).code).toBe("unavailable");
  });

  it("does not retry a 403", async () => {
    let calls = 0;
    await failure(postJson({ ...base, fetchImpl: async () => (calls++, res(403)) }));
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run --project unit lib/connectors`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `lib/connectors/types.ts`:

```ts
import type { MetricSource } from "@/lib/domain/metrics";

export type MetricPointInput = { metric: string; date: string; dimension: string; value: number };
export type FetchContext = { identifiers: Record<string, string>; from: string; to: string };
/** Pure fetch + parse: credentials come from the environment, nothing touches the database. */
export type Connector = (ctx: FetchContext) => Promise<MetricPointInput[]>;
export type Connectors = Record<MetricSource, Connector>;
```

Create `lib/connectors/errors.ts`:

```ts
export type ConnectorErrorCode = "not_configured" | "permission_denied" | "not_found" | "bad_identifier" | "quota" | "unavailable";

/** Messages are shown to the team and recorded on the integration. They never contain tokens, keys, or response bodies. */
export class ConnectorError extends Error {
  constructor(
    public code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}
```

Create `lib/connectors/google-auth.ts`:

```ts
import { JWT } from "google-auth-library";
import { getEnv } from "@/lib/env";
import { ConnectorError } from "./errors";

export const SCOPES = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export type ServiceAccount = { client_email: string; private_key: string };

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw?.trim()) {
    throw new ConnectorError("not_configured", "Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_JSON is not set).");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Deliberately no detail from the parser: its message can quote part of the value.
    throw new ConnectorError("not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the key file's contents on one line.");
  }
  const o = json as Record<string, unknown> | null;
  if (typeof o?.client_email !== "string" || typeof o?.private_key !== "string") {
    throw new ConnectorError("not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key.");
  }
  return { client_email: o.client_email, private_key: o.private_key };
}

/** Test-only hook: GOOGLE_API_BASE_OVERRIDE points the connectors at a local fake Google. Ignored in production. */
export const usingFakeGoogle = (): boolean => process.env.NODE_ENV !== "production" && !!process.env.GOOGLE_API_BASE_OVERRIDE;

export function apiBase(defaultBase: string): string {
  const override = usingFakeGoogle() ? process.env.GOOGLE_API_BASE_OVERRIDE : undefined;
  return (override ?? defaultBase).replace(/\/+$/, "");
}

const clients = new Map<string, JWT>();

export async function getAccessToken(source: keyof typeof SCOPES): Promise<string> {
  if (usingFakeGoogle()) return "fake-token";
  const account = parseServiceAccount(getEnv().GOOGLE_SERVICE_ACCOUNT_JSON);
  let client = clients.get(source);
  if (!client) {
    client = new JWT({ email: account.client_email, key: account.private_key, scopes: [SCOPES[source]] });
    clients.set(source, client);
  }
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("empty token");
    return token;
  } catch {
    // The library's error can include request details; do not forward it.
    throw new ConnectorError("permission_denied", "Google rejected the service account credentials. Check GOOGLE_SERVICE_ACCOUNT_JSON.");
  }
}

/** The service account's public email, safe to show in messages. Null when not configured. */
export function serviceAccountEmail(): string | null {
  try {
    return parseServiceAccount(getEnv().GOOGLE_SERVICE_ACCOUNT_JSON).client_email;
  } catch {
    return null;
  }
}
```

Create `lib/connectors/http.ts`:

```ts
import { ConnectorError } from "./errors";

export type PostJsonOptions = {
  url: string;
  token: string;
  body: unknown;
  /** Human description of the target for error messages, e.g. "GA4 property 515827425". */
  what: string;
  serviceAccountEmail?: string | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

function mapStatus(status: number, o: PostJsonOptions): ConnectorError {
  if (status === 401 || status === 403) {
    const who = o.serviceAccountEmail ? `The service account ${o.serviceAccountEmail}` : "The service account";
    return new ConnectorError("permission_denied", `${who} does not have access to ${o.what}. Add it as a Viewer there.`);
  }
  if (status === 404) return new ConnectorError("not_found", `Google could not find ${o.what}. Check the identifier.`);
  if (status === 400) return new ConnectorError("bad_identifier", `Google rejected the request for ${o.what}. Check the identifier.`);
  if (status === 429) return new ConnectorError("quota", `Google API quota exceeded while reading ${o.what}. Try again later.`);
  return new ConnectorError("unavailable", `Google returned an error (${status}) while reading ${o.what}. Try again later.`);
}

/** POST JSON, retrying once (after a pause) on 429, 5xx, and network failures. Never puts the token or response body in an error. */
export async function postJson<T>(o: PostJsonOptions): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(o.url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
        body: JSON.stringify(o.body),
      });
    } catch {
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw new ConnectorError("unavailable", `Could not reach Google while reading ${o.what}. Try again later.`);
    }
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(1000);
      continue;
    }
    throw mapStatus(res.status, o);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project unit lib/connectors`
Expected: PASS (google-auth and http suites).

- [ ] **Step 5: Commit**

```bash
git add lib/connectors
git commit -m "feat(connectors): service-account auth, HTTP retry, and error mapping" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: GA4 connector

**Files:**
- Create: `lib/connectors/ga4.ts`
- Test: `lib/connectors/ga4.test.ts`

**Interfaces:**
- Consumes: `Connector`, `MetricPointInput` (Task 3); `postJson`, `apiBase`, `getAccessToken`, `serviceAccountEmail` (Task 3); `parsePropertyId` (Task 1); `ConnectorError`.
- Produces: `ga4Connector: Connector`, `parseRunReport(res): MetricPointInput[]`. Emits metric ids `sessions`, `users`, `key_events` with `dimension: ""`.

GA4 Data API facts this task relies on: `POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`; metric API names `sessions`, `activeUsers`, `keyEvents`; the `date` dimension returns `YYYYMMDD`; rows for days with no data are omitted.

- [ ] **Step 1: Write the failing test**

Create `lib/connectors/ga4.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors";
import { ga4Connector, parseRunReport } from "./ga4";

// Response shape follows the GA4 Data API runReport reference (dimension "date" = YYYYMMDD).
const report = {
  rows: [
    { dimensionValues: [{ value: "20261003" }], metricValues: [{ value: "120" }, { value: "95" }, { value: "4" }] },
    { dimensionValues: [{ value: "20261004" }], metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }] },
  ],
};

beforeEach(() => vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://fake-google"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const stubFetch = (status: number, body: unknown) => {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("parseRunReport", () => {
  it("turns each row into one point per metric with ISO dates", () => {
    expect(parseRunReport(report)).toEqual([
      { metric: "sessions", date: "2026-10-03", dimension: "", value: 120 },
      { metric: "users", date: "2026-10-03", dimension: "", value: 95 },
      { metric: "key_events", date: "2026-10-03", dimension: "", value: 4 },
      { metric: "sessions", date: "2026-10-04", dimension: "", value: 0 },
      { metric: "users", date: "2026-10-04", dimension: "", value: 0 },
      { metric: "key_events", date: "2026-10-04", dimension: "", value: 0 },
    ]);
  });

  it("returns nothing for a property with no traffic (GA4 omits the rows key entirely)", () => {
    expect(parseRunReport({})).toEqual([]);
  });

  it("skips malformed rows and non-numeric values instead of failing the sync", () => {
    const rows = [
      { dimensionValues: [{ value: "not-a-date" }], metricValues: [{ value: "1" }] },
      { dimensionValues: [{ value: "20261003" }], metricValues: [{ value: "12" }, { value: "oops" }, { value: "3" }] },
    ];
    expect(parseRunReport({ rows }).map((p) => p.metric)).toEqual(["sessions", "key_events"]);
  });
});

describe("ga4Connector", () => {
  it("requests the date range with the three metrics for the property", async () => {
    const fetchMock = stubFetch(200, report);
    const points = await ga4Connector({ identifiers: { property_id: "properties/515827425" }, from: "2026-10-01", to: "2026-10-04" });
    expect(points).toHaveLength(6);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fake-google/v1beta/properties/515827425:runReport");
    expect(JSON.parse(String(init.body))).toEqual({
      dateRanges: [{ startDate: "2026-10-01", endDate: "2026-10-04" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "keyEvents" }],
      limit: 1000,
    });
  });

  it("rejects a malformed property id before making any request", async () => {
    const fetchMock = stubFetch(200, report);
    for (const property_id of ["UA-123-1", "", "abc"]) {
      await expect(ga4Connector({ identifiers: { property_id }, from: "2026-10-01", to: "2026-10-04" })).rejects.toMatchObject({
        code: "bad_identifier",
      });
    }
    await expect(ga4Connector({ identifiers: {}, from: "2026-10-01", to: "2026-10-04" })).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 403 as permission_denied naming the property", async () => {
    stubFetch(403, { error: { message: "nope" } });
    const e = await ga4Connector({ identifiers: { property_id: "515827425" }, from: "2026-10-01", to: "2026-10-04" }).catch((x) => x);
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("GA4 property 515827425");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit lib/connectors/ga4.test.ts`
Expected: FAIL — `./ga4` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/connectors/ga4.ts`:

```ts
import { parsePropertyId } from "@/lib/domain/metrics";
import { ConnectorError } from "./errors";
import { apiBase, getAccessToken, serviceAccountEmail } from "./google-auth";
import { postJson } from "./http";
import type { Connector, MetricPointInput } from "./types";

// Order matters: parseRunReport reads metricValues by index.
const GA4_METRICS = [
  { api: "sessions", id: "sessions" },
  { api: "activeUsers", id: "users" },
  { api: "keyEvents", id: "key_events" },
] as const;

type RunReportResponse = {
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
};

export function parseRunReport(res: RunReportResponse): MetricPointInput[] {
  const out: MetricPointInput[] = [];
  for (const row of res.rows ?? []) {
    const raw = row.dimensionValues?.[0]?.value;
    if (!raw || !/^\d{8}$/.test(raw)) continue;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    GA4_METRICS.forEach((m, i) => {
      const n = Number(row.metricValues?.[i]?.value);
      if (Number.isFinite(n)) out.push({ metric: m.id, date, dimension: "", value: n });
    });
  }
  return out;
}

export const ga4Connector: Connector = async ({ identifiers, from, to }) => {
  const propertyId = parsePropertyId(identifiers.property_id);
  if (!propertyId) {
    throw new ConnectorError(
      "bad_identifier",
      `GA4 property_id "${identifiers.property_id ?? ""}" must be the numeric property ID (digits only, from Admin → Property details).`,
    );
  }
  const token = await getAccessToken("ga4");
  const body = await postJson<RunReportResponse>({
    url: `${apiBase("https://analyticsdata.googleapis.com")}/v1beta/properties/${propertyId}:runReport`,
    token,
    // At most 400 days of one-row-per-day data, so a single page always suffices.
    body: {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: "date" }],
      metrics: GA4_METRICS.map((m) => ({ name: m.api })),
      limit: 1000,
    },
    what: `GA4 property ${propertyId}`,
    serviceAccountEmail: serviceAccountEmail(),
  });
  return parseRunReport(body);
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit lib/connectors/ga4.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/ga4.ts lib/connectors/ga4.test.ts
git commit -m "feat(connectors): GA4 daily sessions, users, key events" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Search Console connector

**Files:**
- Create: `lib/connectors/gsc.ts`
- Test: `lib/connectors/gsc.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers; `parseSiteUrl`, `siteIdentifier` (Task 1).
- Produces: `gscConnector: Connector`, `parseDailyRows(rows): MetricPointInput[]`, `topDimension(rows, metric, n?): MetricPointInput[]`, `GSC_ROW_LIMIT = 25_000`. Emits `clicks`, `impressions`, `ctr`, `position` (dimension `""`), plus `query_clicks` (dimension `query:<text>`) and `page_clicks` (dimension `page:<full url>`) for the **top 100** queries / pages by total clicks over the fetched range, each with their per-day rows.

Search Console facts this task relies on: `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` with the site URL percent-encoded; request `{startDate, endDate, dimensions, rowLimit, startRow}`; response rows `{keys: string[], clicks, impressions, ctr (0–1), position}`; at most 25,000 rows per request, paginated with `startRow`.

- [ ] **Step 1: Write the failing test**

Create `lib/connectors/gsc.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GSC_ROW_LIMIT, gscConnector, parseDailyRows, topDimension } from "./gsc";

const row = (keys: string[], clicks: number, impressions = 100) => ({ keys, clicks, impressions, ctr: clicks / impressions, position: 8 });

beforeEach(() => vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://fake-google"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseDailyRows", () => {
  it("emits clicks, impressions, ctr, and position per date", () => {
    expect(parseDailyRows([{ keys: ["2026-10-03"], clicks: 5, impressions: 100, ctr: 0.05, position: 7.5 }])).toEqual([
      { metric: "clicks", date: "2026-10-03", dimension: "", value: 5 },
      { metric: "impressions", date: "2026-10-03", dimension: "", value: 100 },
      { metric: "ctr", date: "2026-10-03", dimension: "", value: 0.05 },
      { metric: "position", date: "2026-10-03", dimension: "", value: 7.5 },
    ]);
  });
});

describe("topDimension", () => {
  it("keeps only the top N labels by total clicks, with all of their per-day rows", () => {
    const rows = [
      row(["2026-10-01", "roof repair"], 5),
      row(["2026-10-02", "roof repair"], 5),
      row(["2026-10-01", "roofers near me"], 7),
      row(["2026-10-01", "shingles"], 1),
    ];
    const out = topDimension(rows, "query_clicks", 2);
    expect(out).toEqual([
      { metric: "query_clicks", date: "2026-10-01", dimension: "query:roof repair", value: 5 },
      { metric: "query_clicks", date: "2026-10-02", dimension: "query:roof repair", value: 5 },
      { metric: "query_clicks", date: "2026-10-01", dimension: "query:roofers near me", value: 7 },
    ]);
  });

  it("prefixes pages with page: and keeps the full URL so hosts do not collide", () => {
    const out = topDimension([row(["2026-10-01", "https://a.com/x"], 3), row(["2026-10-01", "https://b.com/x"], 2)], "page_clicks", 5);
    expect(out.map((p) => p.dimension)).toEqual(["page:https://a.com/x", "page:https://b.com/x"]);
  });

  it("breaks ties by label so results are deterministic", () => {
    const out = topDimension([row(["d", "b"], 1), row(["d", "a"], 1)], "query_clicks", 1);
    expect(out.map((p) => p.dimension)).toEqual(["query:a"]);
  });
});

describe("gscConnector", () => {
  function stubGsc(handler: (body: Record<string, unknown>, url: string) => unknown) {
    const fn = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(handler(JSON.parse(String(init.body)), url)), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("makes a daily, a query, and a page request against the percent-encoded site and combines the results", async () => {
    const fetchMock = stubGsc((body) => {
      const dims = body.dimensions as string[];
      if (dims.join() === "date") return { rows: [{ keys: ["2026-10-03"], clicks: 5, impressions: 100, ctr: 0.05, position: 7 }] };
      if (dims.join() === "date,query") return { rows: [row(["2026-10-03", "roof repair"], 3)] };
      return { rows: [row(["2026-10-03", "https://example.com/"], 4)] };
    });
    const points = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fake-google/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(JSON.parse(String(init.body))).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-04", dimensions: ["date"], rowLimit: GSC_ROW_LIMIT, startRow: 0 });
    expect(points.map((p) => p.metric)).toEqual(["clicks", "impressions", "ctr", "position", "query_clicks", "page_clicks"]);
  });

  it("falls back to the importer's legacy `site` identifier and normalizes a bare origin", async () => {
    const fetchMock = stubGsc(() => ({}));
    await gscConnector({ identifiers: { site: "https://example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("/sites/https%3A%2F%2Fexample.com%2F/");
  });

  it("returns no points for a site with no search data", async () => {
    stubGsc(() => ({}));
    expect(await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" })).toEqual([]);
  });

  it("pages through a full 25,000-row response using startRow", async () => {
    const full = Array.from({ length: GSC_ROW_LIMIT }, (_, i) => ({ keys: [`2026-10-01`], clicks: 1, impressions: 1, ctr: 1, position: 1, i }));
    const startRows: number[] = [];
    stubGsc((body) => {
      if ((body.dimensions as string[]).join() !== "date") return {};
      startRows.push(body.startRow as number);
      return { rows: body.startRow === 0 ? full : [{ keys: ["2026-10-02"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] };
    });
    const points = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect(startRows).toEqual([0, GSC_ROW_LIMIT]);
    expect(points.filter((p) => p.metric === "clicks")).toHaveLength(GSC_ROW_LIMIT + 1);
  });

  it("rejects a missing or malformed site before making any request", async () => {
    const fetchMock = stubGsc(() => ({}));
    for (const identifiers of [{}, { site_url: "example.com" }, { site_url: "ftp://example.com/" }]) {
      await expect(gscConnector({ identifiers, from: "2026-10-01", to: "2026-10-04" })).rejects.toMatchObject({ code: "bad_identifier" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 403 as permission_denied naming the site", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const e = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" }).catch((x) => x);
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("sc-domain:example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run --project unit lib/connectors/gsc.test.ts`
Expected: FAIL — `./gsc` not found.

- [ ] **Step 3: Write the implementation**

Create `lib/connectors/gsc.ts`:

```ts
import { parseSiteUrl, siteIdentifier } from "@/lib/domain/metrics";
import { ConnectorError } from "./errors";
import { apiBase, getAccessToken, serviceAccountEmail } from "./google-auth";
import { postJson } from "./http";
import type { Connector, MetricPointInput } from "./types";

export const GSC_ROW_LIMIT = 25_000;
const MAX_PAGES = 4; // 100,000 rows per dimension set is far beyond what 400 days of top queries needs
const TOP_N = 100;

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
type GscResponse = { rows?: GscRow[] };

export function parseDailyRows(rows: GscRow[]): MetricPointInput[] {
  const out: MetricPointInput[] = [];
  for (const r of rows) {
    const date = r.keys?.[0];
    if (!date) continue;
    out.push(
      { metric: "clicks", date, dimension: "", value: r.clicks },
      { metric: "impressions", date, dimension: "", value: r.impressions },
      { metric: "ctr", date, dimension: "", value: r.ctr },
      { metric: "position", date, dimension: "", value: r.position },
    );
  }
  return out;
}

/** Rows are keyed [date, label]. Keep the `n` labels with the most total clicks and every per-day row for them. */
export function topDimension(rows: GscRow[], metric: "query_clicks" | "page_clicks", n = TOP_N): MetricPointInput[] {
  const prefix = metric === "query_clicks" ? "query" : "page";
  const totals = new Map<string, number>();
  for (const r of rows) {
    const label = r.keys?.[1];
    if (label) totals.set(label, (totals.get(label) ?? 0) + r.clicks);
  }
  const keep = new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([label]) => label),
  );
  const out: MetricPointInput[] = [];
  for (const r of rows) {
    const [date, label] = r.keys ?? [];
    if (date && label && keep.has(label)) out.push({ metric, date, dimension: `${prefix}:${label}`, value: r.clicks });
  }
  return out;
}

async function query(siteUrl: string, token: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await postJson<GscResponse>({
      url: `${apiBase("https://searchconsole.googleapis.com")}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      token,
      body: { ...body, rowLimit: GSC_ROW_LIMIT, startRow: page * GSC_ROW_LIMIT },
      what: `Search Console site ${siteUrl}`,
      serviceAccountEmail: serviceAccountEmail(),
    });
    const got = res.rows ?? [];
    rows.push(...got);
    if (got.length < GSC_ROW_LIMIT) break;
  }
  return rows;
}

export const gscConnector: Connector = async ({ identifiers, from, to }) => {
  const siteUrl = parseSiteUrl(siteIdentifier(identifiers));
  if (!siteUrl) {
    throw new ConnectorError(
      "bad_identifier",
      `Search Console site_url "${siteIdentifier(identifiers) ?? ""}" must be sc-domain:example.com or a full URL like https://example.com/.`,
    );
  }
  const token = await getAccessToken("gsc");
  const range = { startDate: from, endDate: to };
  const daily = await query(siteUrl, token, { ...range, dimensions: ["date"] });
  const byQuery = await query(siteUrl, token, { ...range, dimensions: ["date", "query"] });
  const byPage = await query(siteUrl, token, { ...range, dimensions: ["date", "page"] });
  return [...parseDailyRows(daily), ...topDimension(byQuery, "query_clicks"), ...topDimension(byPage, "page_clicks")];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run --project unit lib/connectors`
Expected: PASS (all connector suites).

- [ ] **Step 5: Commit**

```bash
git add lib/connectors/gsc.ts lib/connectors/gsc.test.ts
git commit -m "feat(connectors): Search Console daily totals plus top queries and pages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Metrics service — sync, upsert, status, lock, tracker feed, reads

**Files:**
- Create: `lib/services/metrics.ts`
- Test: `tests/integration/metrics.test.ts`

**Interfaces:**
- Consumes: `Connectors`, `MetricPointInput` (Task 3); `ConnectorError` (Task 3); `ga4Connector` (Task 4); `gscConnector` (Task 5); domain helpers from Task 1 (`aggregateWindow`, `defaultSyncDays`, `endOfDay`, `getMetric`, `MAX_DAYS`, `METRIC_SOURCES`, `parseTrackerSource`, `requiredMetrics`, `siteIdentifier`, `syncRange`, `windowRange`); tables from Task 2; existing `addCheckin` (`lib/services/trackers.ts`), `logActivity`, `getBrandBySlug`, `listIntegrations`.
- Produces:
  - `type SyncSourceResult = { source: MetricSource; status: "ok" | "error" | "skipped"; rows: number; trackerCheckins: number; from?: string; to?: string; message?: string }`
  - `syncBrandMetrics(input: { brandSlug: string; source?: MetricSource; days?: number; actor: Actor; now?: Date; connectors?: Connectors }): Promise<SyncSourceResult[]>` (one result per source, `ga4` then `gsc`; throws `ValidationError` only for bad `days`/`source`, `NotFoundError` for an unknown brand)
  - `getMetricSeries(input: { brandId: string; source: MetricSource; metrics: string[]; from: string; to: string }, tx?: DbOrTx): Promise<Record<string, Series>>` (daily totals, dimension `""`, ascending by date; every requested metric is present, possibly `[]`)
  - `getTopDimension(input: { brandId: string; metric: "query_clicks" | "page_clicks"; from: string; to: string; limit?: number }): Promise<{ label: string; clicks: number }[]>` (descending by clicks; `label` has the `query:`/`page:` prefix removed)
  - `syncLockKey(brandId: string, source: MetricSource): string`, `defaultConnectors: Connectors`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/metrics.test.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser } from "../helpers/db";
import { ConnectorError, type ConnectorErrorCode } from "@/lib/connectors/errors";
import type { Connector, Connectors } from "@/lib/connectors/types";
import { db } from "@/lib/data/db";
import { metricPoints, trackerCheckins } from "@/lib/data/schema";
import { addDays } from "@/lib/domain/metrics";
import type { Actor } from "@/lib/services/actor";
import { listActivity } from "@/lib/services/activity";
import { createBrand, getBrandBySlug } from "@/lib/services/brands";
import { ValidationError } from "@/lib/services/errors";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";
import { getMetricSeries, getTopDimension, syncBrandMetrics, syncLockKey } from "@/lib/services/metrics";
import { createPlanVersion, getActivePlan, updatePlanItem } from "@/lib/services/plans";
import { listTrackers } from "@/lib/services/trackers";

const NOW = new Date("2026-10-05T12:00:00Z");
let sessionsPerDay = 10;
afterEach(() => {
  sessionsPerDay = 10;
  vi.restoreAllMocks();
});

const dayList = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const pt = (metric: string, date: string, value: number, dimension = "") => ({ metric, date, dimension, value });
const fakeGa4: Connector = async ({ from, to }) => dayList(from, to).map((d) => pt("sessions", d, sessionsPerDay));
const fakeGsc: Connector = async ({ from, to }) =>
  dayList(from, to).flatMap((d) => [
    pt("clicks", d, 2),
    pt("impressions", d, 100),
    pt("ctr", d, 0.02),
    pt("position", d, 8),
    pt("query_clicks", d, 1, "query:roof repair"),
  ]);
const connectors: Connectors = { ga4: fakeGa4, gsc: fakeGsc };
const failing =
  (code: ConnectorErrorCode, message: string): Connector =>
  async () => {
    throw new ConnectorError(code, message);
  };

async function setup() {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
  await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: { site_url: "sc-domain:roofcoms.com" }, actor });
  return { actor, brand };
}

async function startTracker(actor: Actor, o: { source: string; windowDays: number; baselineValue: number }) {
  await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "Traffic" }, items: [{ title: "Publish page", funnelStage: "acquisition" }], actor });
  const brand = await getBrandBySlug("roof-co");
  const item = (await getActivePlan(brand.id))!.items[0];
  const done = await updatePlanItem({
    itemId: item.id,
    status: "done",
    tracker: {
      kpi: "Traffic",
      direction: "up",
      baselineValue: o.baselineValue,
      baselineAt: new Date("2026-09-01T00:00:00Z"),
      source: o.source,
      windowDays: o.windowDays,
    },
    actor,
  });
  return done.tracker!.id;
}

const sync = (actor: Actor, over: Partial<Parameters<typeof syncBrandMetrics>[0]> = {}) =>
  syncBrandMetrics({ brandSlug: "roof-co", actor, now: NOW, connectors, ...over });

describe("syncBrandMetrics", () => {
  it("backfills 90 days the first time, then re-pulls a rolling 7 days without duplicating rows", async () => {
    const { actor, brand } = await setup();
    const first = await sync(actor);
    expect(first.map((r) => [r.source, r.status, r.from, r.to, r.rows])).toEqual([
      ["ga4", "ok", "2026-07-07", "2026-10-04", 90],
      ["gsc", "ok", "2026-07-07", "2026-10-04", 450],
    ]);

    sessionsPerDay = 12;
    const second = await sync(actor);
    expect(second.map((r) => [r.from, r.to])).toEqual([
      ["2026-09-28", "2026-10-04"],
      ["2026-09-28", "2026-10-04"],
    ]);
    const rows = await db.select().from(metricPoints).where(and(eq(metricPoints.brandId, brand.id), eq(metricPoints.source, "ga4")));
    expect(rows).toHaveLength(90);
    expect(rows.find((r) => r.date === "2026-10-04")?.value).toBe(12);
    expect(rows.find((r) => r.date === "2026-09-27")?.value).toBe(10);
  });

  it("reaches back over a gap longer than the rolling window so no days are missed", async () => {
    const { actor } = await setup();
    await sync(actor, { source: "ga4", days: 7 });
    const later = new Date("2026-10-25T12:00:00Z");
    const [r] = await sync(actor, { source: "ga4", now: later });
    expect(r.to).toBe("2026-10-24");
    expect(r.from).toBe(addDays("2026-10-24", -20));
  });

  it("records status on the integration and one activity row per source", async () => {
    const { actor, brand } = await setup();
    await sync(actor);
    const integrations = await listIntegrations(brand.id);
    const ga4 = integrations.find((i) => i.service === "ga4")!;
    expect(ga4).toMatchObject({ status: "connected", lastSyncError: null, syncedFrom: "2026-07-07" });
    expect(ga4.lastSyncedAt).toEqual(NOW);
    const summaries = (await listActivity({ brandId: brand.id })).map((a) => a.summary);
    expect(summaries).toContain("Google Analytics 4: synced 2026-07-07 to 2026-10-04 (90 rows)");
    expect(summaries).toContain("Google Search Console: synced 2026-07-07 to 2026-10-04 (450 rows)");
  });

  it("isolates a failing source: the other still syncs, the error is recorded, and status is untouched", async () => {
    const { actor, brand } = await setup();
    const message = "The service account sync@p.iam.gserviceaccount.com does not have access to GA4 property 515827425.";
    const results = await sync(actor, { connectors: { ga4: failing("permission_denied", message), gsc: fakeGsc } });
    expect(results.map((r) => [r.source, r.status])).toEqual([["ga4", "error"], ["gsc", "ok"]]);
    expect(results[0].message).toBe(message);

    const [ga4, gsc] = (await listIntegrations(brand.id)).sort((a, b) => a.service.localeCompare(b.service));
    expect(ga4).toMatchObject({ service: "ga4", status: "connected", lastSyncError: message, lastSyncedAt: null, syncedFrom: null });
    expect(gsc.lastSyncedAt).toEqual(NOW);
    expect(await db.select().from(metricPoints).where(eq(metricPoints.source, "ga4"))).toHaveLength(0);

    await sync(actor, { source: "ga4" });
    expect((await listIntegrations(brand.id)).find((i) => i.service === "ga4")).toMatchObject({ lastSyncError: null });
  });

  it("reports an unexpected crash as an error without leaking details or blocking the other source", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { actor } = await setup();
    const results = await sync(actor, {
      connectors: {
        ga4: async () => {
          throw new Error("boom SECRET-DETAIL");
        },
        gsc: fakeGsc,
      },
    });
    expect(results[0]).toMatchObject({ source: "ga4", status: "error" });
    expect(results[0].message).not.toContain("SECRET-DETAIL");
    expect(results[1].status).toBe("ok");
  });

  it("skips sources that are not connected or have no identifier, and honours the source filter", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "not_connected", identifiers: { property_id: "515827425" }, actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: {}, actor });
    const results = await sync(actor);
    expect(results.map((r) => [r.source, r.status])).toEqual([["ga4", "skipped"], ["gsc", "skipped"]]);
    expect(results[0].message).toMatch(/not connected/i);
    expect(results[1].message).toMatch(/site_url/);
    expect(await sync(actor, { source: "gsc" })).toHaveLength(1);
  });

  it("treats a site with no traffic as a successful empty sync (zero-traffic site)", async () => {
    const { actor, brand } = await setup();
    const results = await sync(actor, { connectors: { ga4: async () => [], gsc: async () => [] } });
    expect(results.map((r) => [r.status, r.rows])).toEqual([["ok", 0], ["ok", 0]]);
    expect((await listIntegrations(brand.id)).every((i) => i.syncedFrom === "2026-07-07" && i.lastSyncError === null)).toBe(true);
  });

  it("validates days and source", async () => {
    const { actor } = await setup();
    for (const days of [0, 401, 1.5, Number.NaN]) {
      await expect(sync(actor, { days })).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(sync(actor, { source: "google_ads" as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it("de-duplicates repeated points in one batch, drops unknown metrics, and writes more than one batch", async () => {
    const { actor, brand } = await setup();
    const many = Array.from({ length: 1200 }, (_, i) => pt("sessions", "2026-10-01", i, `d${i}`));
    const [r] = await sync(actor, {
      source: "ga4",
      connectors: { ...connectors, ga4: async () => [pt("sessions", "2026-10-02", 1), pt("sessions", "2026-10-02", 2), pt("bogus", "2026-10-02", 9), ...many] },
    });
    expect(r).toMatchObject({ status: "ok", rows: 1201 });
    const rows = await db.select().from(metricPoints).where(eq(metricPoints.brandId, brand.id));
    expect(rows).toHaveLength(1201);
    expect(rows.find((x) => x.date === "2026-10-02" && x.dimension === "")?.value).toBe(2);
  });

  it("skips a second concurrent sync of the same brand and source (no duplicate work)", async () => {
    const { actor, brand } = await setup();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${syncLockKey(brand.id, "ga4")}))`);
      const [r] = await sync(actor, { source: "ga4" });
      expect(r).toMatchObject({ status: "skipped", rows: 0 });
      expect(r.message).toMatch(/already running/i);
    });
    expect((await sync(actor, { source: "ga4" }))[0].status).toBe("ok");
  });
});

describe("tracker feed", () => {
  it("checks in a ga4 tracker once per window end using the window total, and again when the window moves", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 7, baselineValue: 50 });

    expect((await sync(actor, { source: "ga4" }))[0].trackerCheckins).toBe(1);
    expect((await sync(actor, { source: "ga4" }))[0].trackerCheckins).toBe(0);

    const [t] = await listTrackers(brand.id, NOW);
    expect(t).toMatchObject({ latest: 70, verdict: "positive" });
    expect(t.checkins).toHaveLength(1);
    const [c] = await db.select().from(trackerCheckins);
    expect(c.source).toBe("ga4:sessions (auto)");
    expect(c.observedAt).toEqual(new Date("2026-10-04T23:59:59.999Z"));

    const next = await sync(actor, { source: "ga4", now: new Date("2026-10-06T12:00:00Z") });
    expect(next[0].trackerCheckins).toBe(1);
  });

  it("recomputes CTR from clicks and impressions for gsc:ctr trackers", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "gsc:ctr", windowDays: 7, baselineValue: 0.01 });
    expect((await sync(actor, { source: "gsc" }))[0].trackerCheckins).toBe(1);
    const [t] = await listTrackers(brand.id, NOW);
    expect(t.latest).toBeCloseTo(0.02);
    expect(t.verdict).toBe("positive");
  });

  it("checks in 0 for a sum tracker on a zero-traffic site, but not a ratio tracker with no impressions", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 7, baselineValue: 50 });
    expect((await sync(actor, { source: "ga4", connectors: { ...connectors, ga4: async () => [] } }))[0].trackerCheckins).toBe(1);
    const [t] = await listTrackers(brand.id, NOW);
    expect(t).toMatchObject({ latest: 0, verdict: "negative" });
  });

  it("does not check in a ratio tracker when there were no impressions", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "gsc:ctr", windowDays: 7, baselineValue: 0.01 });
    const [r] = await sync(actor, { source: "gsc", connectors: { ...connectors, gsc: async () => [] } });
    expect(r).toMatchObject({ status: "ok", trackerCheckins: 0 });
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
  });

  it("does not check in when synced history is shorter than the tracker window", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "ga4:sessions", windowDays: 30, baselineValue: 100 });
    expect((await sync(actor, { source: "ga4", days: 7 }))[0].trackerCheckins).toBe(0);
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
    expect((await sync(actor, { source: "ga4", days: 30 }))[0].trackerCheckins).toBe(1);
    expect((await listTrackers(brand.id, NOW))[0].latest).toBe(300);
  });

  it("ignores trackers whose source is free text", async () => {
    const { actor, brand } = await setup();
    await startTracker(actor, { source: "GA4", windowDays: 7, baselineValue: 50 });
    const [r] = await sync(actor, { source: "ga4" });
    expect(r).toMatchObject({ status: "ok", trackerCheckins: 0 });
    expect((await listTrackers(brand.id, NOW))[0].checkins).toHaveLength(0);
  });
});

describe("reading metrics", () => {
  it("returns daily totals only, in date order, for the requested range, with every requested metric present", async () => {
    const { actor, brand } = await setup();
    await sync(actor, { source: "gsc" });
    const series = await getMetricSeries({ brandId: brand.id, source: "gsc", metrics: ["clicks", "query_clicks", "position"], from: "2026-10-01", to: "2026-10-03" });
    expect(series.clicks).toEqual([
      { date: "2026-10-01", value: 2 },
      { date: "2026-10-02", value: 2 },
      { date: "2026-10-03", value: 2 },
    ]);
    expect(series.query_clicks).toEqual([]); // dimensional rows are not daily totals
    expect(series.position).toHaveLength(3);
  });

  it("ranks top queries by clicks and strips the dimension prefix", async () => {
    const { actor, brand } = await setup();
    await sync(actor, { source: "gsc" });
    expect(await getTopDimension({ brandId: brand.id, metric: "query_clicks", from: "2026-09-28", to: "2026-10-04" })).toEqual([
      { label: "roof repair", clicks: 7 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run --project integration tests/integration/metrics.test.ts`
Expected: FAIL — `@/lib/services/metrics` not found (and the `syncedFrom` column is missing until Task 2 includes it; if Task 2 is done as written in this plan it exists).

- [ ] **Step 3: Write the implementation**

Create `lib/services/metrics.ts`:

```ts
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { ConnectorError } from "@/lib/connectors/errors";
import { ga4Connector } from "@/lib/connectors/ga4";
import { gscConnector } from "@/lib/connectors/gsc";
import type { Connectors, MetricPointInput } from "@/lib/connectors/types";
import { db, type DbOrTx } from "@/lib/data/db";
import { integrations, metricPoints, planItems, plans, trackerCheckins, trackers } from "@/lib/data/schema";
import { SERVICE_LABELS } from "@/lib/domain/integrations";
import {
  aggregateWindow,
  defaultSyncDays,
  endOfDay,
  getMetric,
  MAX_DAYS,
  METRIC_SOURCES,
  parseTrackerSource,
  requiredMetrics,
  siteIdentifier,
  syncRange,
  windowRange,
  type MetricSource,
  type Series,
} from "@/lib/domain/metrics";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";
import { listIntegrations } from "./integrations";
import { addCheckin } from "./trackers";

export type SyncSourceResult = {
  source: MetricSource;
  status: "ok" | "error" | "skipped";
  rows: number;
  trackerCheckins: number;
  from?: string;
  to?: string;
  message?: string;
};

export const defaultConnectors: Connectors = { ga4: ga4Connector, gsc: gscConnector };
export const syncLockKey = (brandId: string, source: MetricSource) => `metrics:${brandId}:${source}`;

const BATCH = 500;
type Integration = typeof integrations.$inferSelect;
type SourceCtx = {
  brandId: string;
  source: MetricSource;
  integration: Integration | undefined;
  now: Date;
  days?: number;
  actor: Actor;
  connectors: Connectors;
};

export async function syncBrandMetrics(input: {
  brandSlug: string;
  source?: MetricSource;
  days?: number;
  actor: Actor;
  now?: Date;
  connectors?: Connectors;
}): Promise<SyncSourceResult[]> {
  if (input.days !== undefined && (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DAYS)) {
    throw new ValidationError(`days must be a whole number between 1 and ${MAX_DAYS}`, "days");
  }
  if (input.source !== undefined && !METRIC_SOURCES.includes(input.source)) {
    throw new ValidationError(`source must be one of: ${METRIC_SOURCES.join(", ")}`, "source");
  }
  const brand = await getBrandBySlug(input.brandSlug);
  const rows = await listIntegrations(brand.id);
  const base = { brandId: brand.id, now: input.now ?? new Date(), days: input.days, actor: input.actor, connectors: input.connectors ?? defaultConnectors };
  const results: SyncSourceResult[] = [];
  for (const source of input.source ? [input.source] : METRIC_SOURCES) {
    try {
      results.push(await syncSource({ ...base, source, integration: rows.find((i) => i.service === source) }));
    } catch (e) {
      // One source crashing (a bug, a database error) must not block the other. Details stay in the server log.
      console.error(`metrics sync crashed for ${source}`, e);
      results.push({ source, status: "error", rows: 0, trackerCheckins: 0, message: "Unexpected error while syncing; see the server logs." });
    }
  }
  return results;
}

async function syncSource(c: SourceCtx): Promise<SyncSourceResult> {
  const label = SERVICE_LABELS[c.source];
  const skipped = (message: string): SyncSourceResult => ({ source: c.source, status: "skipped", rows: 0, trackerCheckins: 0, message });
  const integration = c.integration;
  if (!integration || integration.status !== "connected") return skipped(`${label} is not connected for this brand.`);
  const identifier = c.source === "ga4" ? integration.identifiers.property_id : siteIdentifier(integration.identifiers);
  if (!identifier?.trim()) return skipped(`${label} has no ${c.source === "ga4" ? "property_id" : "site_url"} set.`);

  // The advisory lock is transaction-scoped, so the whole sync runs in one transaction; it is released on commit.
  return db.transaction(async (tx): Promise<SyncSourceResult> => {
    const lock = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${syncLockKey(c.brandId, c.source)})) as ok`);
    if (!lock[0]?.ok) return skipped(`A sync of ${label} is already running.`);

    const days = c.days ?? defaultSyncDays({ firstSync: integration.syncedFrom === null, lastSyncedAt: integration.lastSyncedAt, now: c.now });
    const { from, to } = syncRange(c.now, days);
    const activity = (summary: string) =>
      logActivity({ brandId: c.brandId, actor: c.actor, kind: "integration", summary, refType: "integration", refId: integration.id }, tx);
    try {
      const points = await c.connectors[c.source]({ identifiers: integration.identifiers, from, to });
      const rows = await upsertPoints(tx, c.brandId, c.source, points);
      const syncedFrom = integration.syncedFrom && integration.syncedFrom < from ? integration.syncedFrom : from;
      await tx.update(integrations).set({ lastSyncedAt: c.now, lastSyncError: null, syncedFrom }).where(eq(integrations.id, integration.id));
      const trackerCheckins = await feedTrackers(tx, { brandId: c.brandId, source: c.source, to, syncedFrom, now: c.now, actor: c.actor });
      const extra = trackerCheckins ? `, ${trackerCheckins} tracker check-in${trackerCheckins === 1 ? "" : "s"}` : "";
      await activity(`${label}: synced ${from} to ${to} (${rows} rows${extra})`);
      return { source: c.source, status: "ok", rows, trackerCheckins, from, to };
    } catch (e) {
      if (!(e instanceof ConnectorError)) throw e;
      await tx.update(integrations).set({ lastSyncError: e.message }).where(eq(integrations.id, integration.id));
      await activity(`${label}: sync failed (${e.message})`);
      return { source: c.source, status: "error", rows: 0, trackerCheckins: 0, from, to, message: e.message };
    }
  });
}

async function upsertPoints(tx: DbOrTx, brandId: string, source: MetricSource, points: MetricPointInput[]): Promise<number> {
  // ON CONFLICT cannot touch the same row twice in one statement, so collapse repeats first (last one wins).
  const unique = new Map<string, MetricPointInput>();
  for (const p of points) {
    if (!getMetric(source, p.metric) || !Number.isFinite(p.value)) continue;
    unique.set(`${p.metric}|${p.date}|${p.dimension}`, p);
  }
  const rows = [...unique.values()].map((p) => ({ brandId, source, metric: p.metric, date: p.date, dimension: p.dimension, value: p.value }));
  for (let i = 0; i < rows.length; i += BATCH) {
    await tx
      .insert(metricPoints)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoUpdate({
        target: [metricPoints.brandId, metricPoints.source, metricPoints.metric, metricPoints.date, metricPoints.dimension],
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      });
  }
  return rows.length;
}

async function feedTrackers(
  tx: DbOrTx,
  a: { brandId: string; source: MetricSource; to: string; syncedFrom: string; now: Date; actor: Actor },
): Promise<number> {
  const rows = await tx
    .select({ tracker: trackers })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(and(eq(plans.brandId, a.brandId), ilike(trackers.source, `${a.source}:%`)));
  const observedAt = endOfDay(a.to);
  let made = 0;
  for (const { tracker: t } of rows) {
    const parsed = parseTrackerSource(t.source);
    const def = parsed && parsed.source === a.source ? getMetric(parsed.source, parsed.metric) : undefined;
    if (!parsed || !def) continue;
    const win = windowRange(a.to, t.windowDays);
    // Only judge a window we have actually synced end to end.
    if (a.syncedFrom > win.from) continue;
    const autoSource = `${parsed.source}:${parsed.metric} (auto)`;
    const existing = await tx
      .select({ id: trackerCheckins.id })
      .from(trackerCheckins)
      .where(and(eq(trackerCheckins.trackerId, t.id), eq(trackerCheckins.source, autoSource), eq(trackerCheckins.observedAt, observedAt)))
      .limit(1);
    if (existing.length > 0) continue;
    const series = await getMetricSeries({ brandId: a.brandId, source: a.source, metrics: requiredMetrics(def), from: win.from, to: win.to }, tx);
    const value = aggregateWindow(def, series);
    if (value === null) continue;
    try {
      await addCheckin({ trackerId: t.id, value, observedAt, source: autoSource, note: `Automatic: ${win.from} to ${win.to}`, actor: a.actor, now: a.now });
      made++;
    } catch (e) {
      // A bad tracker must not fail the sync that already stored good data.
      console.error(`tracker ${t.id} auto check-in failed`, e);
    }
  }
  return made;
}

export async function getMetricSeries(
  input: { brandId: string; source: MetricSource; metrics: string[]; from: string; to: string },
  tx: DbOrTx = db,
): Promise<Record<string, Series>> {
  const out: Record<string, Series> = Object.fromEntries(input.metrics.map((m) => [m, [] as Series]));
  if (input.metrics.length === 0) return out;
  const rows = await tx
    .select({ metric: metricPoints.metric, date: metricPoints.date, value: metricPoints.value })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.brandId, input.brandId),
        eq(metricPoints.source, input.source),
        inArray(metricPoints.metric, input.metrics),
        eq(metricPoints.dimension, ""),
        gte(metricPoints.date, input.from),
        lte(metricPoints.date, input.to),
      ),
    )
    .orderBy(asc(metricPoints.date));
  for (const r of rows) out[r.metric].push({ date: r.date, value: r.value });
  return out;
}

export async function getTopDimension(
  input: { brandId: string; metric: "query_clicks" | "page_clicks"; from: string; to: string; limit?: number },
  tx: DbOrTx = db,
): Promise<{ label: string; clicks: number }[]> {
  const clicks = sql<number>`sum(${metricPoints.value})`;
  const rows = await tx
    .select({ dimension: metricPoints.dimension, clicks })
    .from(metricPoints)
    .where(
      and(
        eq(metricPoints.brandId, input.brandId),
        eq(metricPoints.source, "gsc"),
        eq(metricPoints.metric, input.metric),
        gte(metricPoints.date, input.from),
        lte(metricPoints.date, input.to),
      ),
    )
    .groupBy(metricPoints.dimension)
    .orderBy(desc(clicks), asc(metricPoints.dimension))
    .limit(input.limit ?? 20);
  return rows.map((r) => ({ label: r.dimension.replace(/^(query|page):/, ""), clicks: Number(r.clicks) }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run --project integration tests/integration/metrics.test.ts`
Expected: PASS (all tests). If the advisory-lock test hangs, the connection pool (`max: 5`) is exhausted: confirm `sync` inside the holder transaction opens its own transaction on another connection and nothing else holds one.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add lib/services/metrics.ts tests/integration/metrics.test.ts
git commit -m "feat(metrics): sync service with upsert, locking, status recording, and tracker feed" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: MCP tool, brand context, agent prompts, tool count

**Files:**
- Modify: `lib/mcp/tools.ts`, `lib/services/context.ts`, `lib/prompts.ts`, `lib/prompts.test.ts`, `tests/integration/mcp-tools.test.ts`, `tests/integration/metrics.test.ts`, `scripts/verify-deployment.ts`, `docs/superpowers/deploy-runbook.md`

**Interfaces:**
- Consumes: `syncBrandMetrics`, `SyncSourceResult` (Task 6); `METRIC_SOURCES` (Task 1).
- Produces: MCP tool `sync_metrics` (`{ brand, source?, days? }` → `{ results: SyncSourceResult[] }`); `BrandContext.integrations[]` gains `lastSyncedAt: Date | null` and `lastSyncError: string | null`; `PromptKind` gains `"sync"` (labels order: onboard, audit, plan, execute, checkin, sync).

- [ ] **Step 1: Write the failing tests**

In `tests/integration/mcp-tools.test.ts`, add `"sync_metrics",` to the sorted-name list in the "exposes the full tool set" test (between `"start_tracker"` and `"update_plan_item"`; the list is sorted before comparing, so position does not matter, but keep it tidy), then add this test inside the `describe("MCP tools", ...)` block:

```ts
  it("sync_metrics reports each source and rejects bad arguments", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    const ok = await call("sync_metrics", { brand: "roof-co" }, actor);
    expect(ok.isError).toBe(false);
    expect(ok.body.results.map((r: { source: string; status: string }) => [r.source, r.status])).toEqual([
      ["ga4", "skipped"],
      ["gsc", "skipped"],
    ]);
    expect((await call("sync_metrics", { brand: "roof-co", days: 0 }, actor)).isError).toBe(true);
    expect((await call("sync_metrics", { brand: "roof-co", source: "google_ads" }, actor)).isError).toBe(true);
    const missing = await call("sync_metrics", { brand: "no-such-brand" }, actor);
    expect(missing.isError).toBe(true);
    expect(missing.body.error).toBe("not_found");
  });
```

Append to `tests/integration/metrics.test.ts` (add `import { getBrandContext } from "@/lib/services/context";` to the imports):

```ts
describe("brand context", () => {
  it("exposes sync status so an agent can see what is stale or broken", async () => {
    const { actor } = await setup();
    await sync(actor, { connectors: { ga4: failing("quota", "Google API quota exceeded while reading GA4 property 515827425. Try again later."), gsc: fakeGsc } });
    const ctx = await getBrandContext("roof-co");
    const ga4 = ctx.integrations.find((i) => i.service === "ga4")!;
    const gsc = ctx.integrations.find((i) => i.service === "gsc")!;
    expect(ga4).toMatchObject({ lastSyncedAt: null, lastSyncError: expect.stringContaining("quota") });
    expect(gsc).toMatchObject({ lastSyncError: null });
    expect(gsc.lastSyncedAt).toEqual(NOW);
  });
});
```

In `lib/prompts.test.ts`, change the last assertion and add two:

```ts
    expect(agentPrompt("execute", brand)).toContain("ga4:sessions");
    expect(agentPrompt("checkin", brand)).toContain("sync_metrics");
    expect(agentPrompt("sync", brand)).toContain('sync_metrics with brand "roofcoms-com"');
    expect(Object.keys(PROMPT_LABELS)).toEqual(["onboard", "audit", "plan", "execute", "checkin", "sync"]);
```

(replace only the existing `expect(Object.keys(PROMPT_LABELS))...` line and insert the three new lines above it, inside the same `it`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run --project unit lib/prompts.test.ts` → FAIL.
Run: `pnpm exec vitest run --project integration tests/integration/mcp-tools.test.ts tests/integration/metrics.test.ts` → FAIL (`sync_metrics` unknown; context lacks the fields).

- [ ] **Step 3: Add the MCP tool**

In `lib/mcp/tools.ts`:

1. Add imports (keep the existing alphabetical grouping): `import { METRIC_SOURCES } from "@/lib/domain/metrics";` after the `integrations` domain import, and `import { syncBrandMetrics } from "@/lib/services/metrics";` after the `integrations` service import.
2. Replace the `source` line in `trackerShape`:

```ts
  source: z
    .string()
    .describe(
      "Where the number comes from, e.g. GA4, GSC, Google Ads. Use exactly ga4:sessions, ga4:users, ga4:key_events, gsc:clicks, gsc:impressions, gsc:ctr or gsc:position and the app checks in automatically after each sync_metrics (set baseline_value to the same measure summed over the window_days before baseline_at).",
    ),
```

3. Add this tool to the `tools` array, right after the `upsert_integration` tool:

```ts
  defineTool({
    name: "sync_metrics",
    description:
      "Pull the latest Google Analytics 4 and Search Console metrics for a brand into the app (daily data for the Analytics tab). Trackers whose source is ga4:<metric> or gsc:<metric> are checked in automatically. Returns one result per source: ok, skipped (not connected or no identifier), or error with the exact reason.",
    input: {
      brand: brandArg,
      source: z.enum(METRIC_SOURCES).optional().describe("Only this source. Omit for both ga4 and gsc."),
      days: z.number().int().min(1).max(400).optional().describe("How many days back to pull. Omit for the default (90 on the first sync, otherwise a rolling 7)."),
    },
    handler: async ({ brand, source, days }, { actor }) => ({ results: await syncBrandMetrics({ brandSlug: brand, source, days, actor }) }),
  }),
```

- [ ] **Step 4: Expose sync status in the brand context**

In `lib/services/context.ts`, change the `integrations` field of `BrandContext` to:

```ts
  integrations: {
    service: string;
    status: string;
    identifiers: Record<string, string>;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  }[];
```

and the mapping in `getBrandContext` to:

```ts
    integrations: integrations.map((i) => ({
      service: i.service,
      status: i.status,
      identifiers: i.identifiers,
      lastSyncedAt: i.lastSyncedAt,
      lastSyncError: i.lastSyncError,
    })),
```

- [ ] **Step 5: Add the prompts**

In `lib/prompts.ts`:

1. `export type PromptKind = "onboard" | "audit" | "plan" | "execute" | "checkin" | "sync";`
2. In `PROMPT_LABELS` add after `checkin`: `sync: "Sync analytics",`
3. In the `execute` case, replace step 4 with:

```
4. Call update_plan_item with link_files, a short note, and status "done" plus a tracker: the KPI this item should move, direction, the real current value as baseline_value with baseline_at, the data source, and window_days for when impact should show.
   If Google Analytics or Search Console is connected for this brand, set the tracker source to exactly one of ga4:sessions, ga4:users, ga4:key_events, gsc:clicks, gsc:impressions, gsc:ctr, gsc:position so the app checks in automatically, and make baseline_value that same measure summed (or, for gsc:ctr and gsc:position, computed) over the window_days before baseline_at.
```

4. Replace the `checkin` case body with:

```
Check in on impact:
1. Call sync_metrics for this brand. Trackers whose source is ga4:<metric> or gsc:<metric> are checked in automatically.
2. For every other tracker whose verdict is pending, get the current KPI value from its source (Google Ads, the site, or another tool).
3. Call add_checkin with the value, observed_at, and source.
4. Report each verdict (positive, neutral, negative, or still measuring).
If the latest audit is more than 30 days old, recommend rerunning the audit.
```

(keep the surrounding `return \`${intro}\n\n...\`` template as in the file).

5. Add a new case before the closing brace of the `switch`:

```ts
    case "sync":
      return `${intro}

Pull the latest analytics for this brand:
1. Call sync_metrics with brand "${b.slug}" and no other arguments.
2. For any source that comes back "error" or "skipped", tell me the exact message so I can fix the connection. Do not retry more than once.
3. Call get_brand_context again and report every tracker whose source starts with ga4: or gsc: with its latest value and verdict.
Trackers with any other source still need add_checkin from you.`;
```

- [ ] **Step 6: Update the tool-count references (17 → 18)**

In `scripts/verify-deployment.ts` change the check name and comparison to 18:

```ts
    name: "MCP endpoint lists all 18 tools with a valid token",
```
```ts
        return tools.length === 18 ? null : `expected 18 tools, got ${tools.length}`;
```

In `docs/superpowers/deploy-runbook.md` (line ~132) change `all 17 tools` to `all 18 tools`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS everything, including the Agent page still compiling: run `pnpm exec tsc --noEmit` → no errors (the Agent page maps over `PROMPT_LABELS` keys, so the new prompt appears automatically).

- [ ] **Step 8: Commit**

```bash
git add lib/mcp/tools.ts lib/services/context.ts lib/prompts.ts lib/prompts.test.ts tests/integration scripts/verify-deployment.ts docs/superpowers/deploy-runbook.md
git commit -m "feat(mcp): sync_metrics tool, sync status in brand context, analytics prompts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: UI — Sync now button, Analytics sections

**Files:**
- Create: `app/actions/metrics.ts`, `components/analytics/traffic-chart.tsx`, `components/analytics/search-chart.tsx`, `components/analytics/top-table.tsx`, `components/analytics/sync-note.tsx`, `components/analytics/range-toggle.tsx`
- Modify: `components/workspace/integrations-pane.tsx`, `app/b/[slug]/analytics/page.tsx`

**Interfaces:**
- Consumes: `syncBrandMetrics`, `SyncSourceResult`, `getMetricSeries`, `getTopDimension` (Task 6); `aggregateWindow`, `getMetric`, `mergeSeries`, `pageLabel`, `addDays`, `isoDay`, `MetricSource` (Task 1); existing `requireUser`, `actorFor`, `attempt`, `listIntegrations`.
- Produces: `syncMetricsAction(input: { brandSlug: string; source: MetricSource }): Promise<Result<SyncSourceResult[]>>`; stable test ids used by Task 9: `traffic-chart`, `gsc-clicks`, `gsc-impressions`, `gsc-ctr`, `gsc-position`; a button with accessible name `Sync <service label> now`; an element with `role="alert"` showing `lastSyncError`.

This task has no new unit tests: the logic it renders is covered in Tasks 1 and 6, and the behavior is covered end to end in Task 9. Verification here is type-check and lint.

- [ ] **Step 1: Create the server action**

Create `app/actions/metrics.ts`:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action-result";
import { actorFor, requireUser } from "@/lib/auth/session";
import type { MetricSource } from "@/lib/domain/metrics";
import { syncBrandMetrics } from "@/lib/services/metrics";

export async function syncMetricsAction(input: { brandSlug: string; source: MetricSource }) {
  const user = await requireUser();
  const r = await attempt(() => syncBrandMetrics({ brandSlug: input.brandSlug, source: input.source, actor: actorFor(user) }));
  revalidatePath("/b", "layout");
  return r;
}
```

- [ ] **Step 2: Add the Sync button and status to the integration cards**

In `components/workspace/integrations-pane.tsx`:

1. Add the import after the existing `@/app/actions/integrations` import:

```tsx
import { syncMetricsAction } from "@/app/actions/metrics";
```

2. Replace the intro paragraph text (`The agent pulls data with its own connectors; record each account here so it knows which property, site, or customer ID to use.`) with:

```tsx
        Record each account here so the agent knows which property, site, or customer ID to use. For Google Analytics 4 (property_id) and
        Search Console (site_url), add the service account as a Viewer, mark the integration connected, then Sync now to pull metrics
        into the Analytics tab.
```

3. Immediately before the line `            {editing === service && (` (the start of the edit form), insert:

```tsx
            {(service === "ga4" || service === "gsc") && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2"
                  aria-label={`Sync ${SERVICE_LABELS[service]} now`}
                  disabled={pending || status !== "connected"}
                  onClick={() =>
                    start(async () => {
                      const r = await syncMetricsAction({ brandSlug, source: service as "ga4" | "gsc" });
                      if (!r.ok) return void toast.error(r.error);
                      const s = r.data[0];
                      if (s.status === "ok") toast.success(`${SERVICE_LABELS[service]} synced (${s.rows} rows)`);
                      else toast.error(s.message ?? "Sync failed");
                      await refresh();
                    })
                  }
                >
                  Sync now
                </Button>
                <span className="text-muted-foreground">{row?.lastSyncedAt ? `Synced ${new Date(row.lastSyncedAt).toLocaleString()}` : "Never synced"}</span>
              </div>
            )}
            {row?.lastSyncError && (
              <p role="alert" className="mt-1 text-xs text-band-red">
                {row.lastSyncError}
              </p>
            )}
```

4. In the identifiers `Textarea` placeholder change `site=sc-domain:example.com` to `site_url=sc-domain:example.com`:

```tsx
                  placeholder={"property_id=515827425\nsite_url=sc-domain:example.com"}
```

- [ ] **Step 3: Create the Analytics components**

Create `components/analytics/range-toggle.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";

export function RangeToggle({ slug, range }: { slug: string; range: 30 | 90 }) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Date range">
      {([30, 90] as const).map((d) => (
        <Link
          key={d}
          href={`/b/${slug}/analytics?range=${d}`}
          aria-current={range === d ? "true" : undefined}
          className={cn("rounded px-2 py-1", range === d ? "bg-secondary font-medium text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {d} days
        </Link>
      ))}
    </div>
  );
}
```

Create `components/analytics/sync-note.tsx`:

```tsx
type Props = {
  label: string;
  integration?: { status: string; lastSyncedAt: Date | null; lastSyncError: string | null };
};

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function SyncNote({ label, integration }: Props) {
  if (!integration || integration.status !== "connected") {
    return <p className="text-sm text-muted-foreground">Connect {label} on the Integrations pane to see this section.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted-foreground">
        {integration.lastSyncedAt ? `Last synced ${stamp(integration.lastSyncedAt)}` : "Never synced. Use Sync now on the Integrations pane."}
      </p>
      {integration.lastSyncError && (
        <p role="alert" className="text-band-red">
          {integration.lastSyncError}
        </p>
      )}
    </div>
  );
}
```

Create `components/analytics/traffic-chart.tsx`:

```tsx
"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 };

export function TrafficChart({ points }: { points: Record<string, string | number>[] }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No traffic recorded in this range.</p>;
  return (
    <div className="h-64" data-testid="traffic-chart">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} />
          <YAxis tick={AXIS} />
          <Tooltip contentStyle={TIP} />
          <Legend />
          <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#4F46E5" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="users" name="Users (user-days)" stroke="#0D9488" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="key_events" name="Key events" stroke="#D97706" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Create `components/analytics/search-chart.tsx`:

```tsx
"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" };
const TIP = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 };

export function SearchChart({ points }: { points: Record<string, string | number>[] }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No search data recorded in this range.</p>;
  return (
    <div className="h-64" data-testid="search-chart">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} />
          <YAxis yAxisId="clicks" tick={AXIS} />
          <YAxis yAxisId="impressions" orientation="right" tick={AXIS} />
          <Tooltip contentStyle={TIP} />
          <Legend />
          <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="#4F46E5" strokeWidth={2} dot={false} />
          <Line yAxisId="impressions" type="monotone" dataKey="impressions" name="Impressions" stroke="#0D9488" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Create `components/analytics/top-table.tsx`:

```tsx
export function TopTable({
  title,
  rows,
  labelFor = (l) => l,
}: {
  title: string;
  rows: { label: string; clicks: number }[];
  labelFor?: (label: string) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <caption className="bg-muted p-2 text-left text-xs font-medium text-muted-foreground">{title}</caption>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="max-w-0 truncate p-2" title={r.label}>
                {labelFor(r.label)}
              </td>
              <td className="p-2 text-right tabular-nums">{new Intl.NumberFormat("en-US").format(r.clicks)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Replace the Analytics page**

Replace the contents of `app/b/[slug]/analytics/page.tsx` with:

```tsx
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
```

- [ ] **Step 5: Type-check and lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no errors. If `tsc` objects to narrowing `service` inside the `onClick` closure, the `as "ga4" | "gsc"` cast in Step 2 is the intended fix; do not widen `syncMetricsAction`.

- [ ] **Step 6: Commit**

```bash
git add app components
git commit -m "feat(ui): Sync now on GA4 and Search Console cards; traffic and search sections on Analytics" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end test with a fake Google server

**Files:**
- Create: `tests/e2e/fake-google.ts`, `tests/e2e/z-metrics-sync.spec.ts`
- Modify: `tests/e2e/global-setup.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: the UI from Task 8 (test ids and accessible names listed there); MCP tool `sync_metrics` (Task 7); services `createBrand`, `upsertIntegration`; the test-only `GOOGLE_API_BASE_OVERRIDE` hook (Task 3).
- Produces: `startFakeGoogle(): Promise<Server>` on `127.0.0.1:3199`; `FORBIDDEN_PROPERTY = "403403"` (the fake answers 403 for that GA4 property).

The fake returns: GA4 100 sessions / 80 users / 5 key events per day; Search Console 20 clicks / 400 impressions / CTR 0.05 / position 8.5 per day, queries "roof repair flowood" (12 clicks/day) and "roofers near me" (8), pages `https://e2e-metrics.example/` (15) and `/services` (5).

- [ ] **Step 1: Create the fake Google server**

Create `tests/e2e/fake-google.ts`:

```ts
import { createServer, type Server } from "node:http";

export const FAKE_GOOGLE_PORT = 3199;
/** A GA4 property id the fake answers with 403, to exercise the error path. */
export const FORBIDDEN_PROPERTY = "403403";

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function startFakeGoogle(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const body = raw ? JSON.parse(raw) : {};
      const url = req.url ?? "";

      const ga4 = /^\/v1beta\/properties\/(\d+):runReport$/.exec(url);
      if (req.method === "POST" && ga4) {
        if (ga4[1] === FORBIDDEN_PROPERTY) return send(403, { error: { message: "forbidden" } });
        const range = body.dateRanges[0];
        return send(200, {
          rows: days(range.startDate, range.endDate).map((d) => ({
            dimensionValues: [{ value: d.replaceAll("-", "") }],
            metricValues: [{ value: "100" }, { value: "80" }, { value: "5" }],
          })),
        });
      }

      if (req.method === "POST" && /^\/webmasters\/v3\/sites\/.+\/searchAnalytics\/query$/.test(url)) {
        const dims: string[] = body.dimensions;
        const range = days(body.startDate, body.endDate);
        if (dims.join() === "date") {
          return send(200, { rows: range.map((d) => ({ keys: [d], clicks: 20, impressions: 400, ctr: 0.05, position: 8.5 })) });
        }
        const labels: [string, number][] =
          dims[1] === "query"
            ? [["roof repair flowood", 12], ["roofers near me", 8]]
            : [["https://e2e-metrics.example/", 15], ["https://e2e-metrics.example/services", 5]];
        return send(200, {
          rows: range.flatMap((d) => labels.map(([label, clicks]) => ({ keys: [d, label], clicks, impressions: 200, ctr: 0.05, position: 8.5 }))),
        });
      }
      send(404, { error: "unknown route" });
    });
  });
  return new Promise((resolve) => server.listen(FAKE_GOOGLE_PORT, "127.0.0.1", () => resolve(server)));
}
```

- [ ] **Step 2: Start it from global setup and point the dev server at it**

In `tests/e2e/global-setup.ts` add the import at the top:

```ts
import { startFakeGoogle } from "./fake-google";
```

and replace the last two statements of `globalSetup` (`writeFileSync(...)` and `await sql.end();`) with:

```ts
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ token }));
  await sql.end();
  const fakeGoogle = await startFakeGoogle();
  return async () => {
    await new Promise<void>((resolve) => fakeGoogle.close(() => resolve()));
  };
```

In `playwright.config.ts`, add one line to the `webServer.env` object after `NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-unused",`:

```ts
      GOOGLE_API_BASE_OVERRIDE: "http://127.0.0.1:3199",
```

- [ ] **Step 3: Write the e2e test**

Create `tests/e2e/z-metrics-sync.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { FORBIDDEN_PROPERTY } from "./fake-google";

// The leading "z" makes this run after workspace.spec.ts, which expects an empty database.
const { token } = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as { token: string };

test.beforeAll(async () => {
  const { sql } = await import("@/lib/data/db");
  const { createTestUser } = await import("../helpers/db");
  const { createBrand } = await import("@/lib/services/brands");
  const { upsertIntegration } = await import("@/lib/services/integrations");
  const actor = await createTestUser("metrics-e2e@test.local");
  await createBrand({ name: "E2E Metrics", domain: "e2e-metrics.example", actor });
  await createBrand({ name: "E2E Broken", domain: "e2e-broken.example", actor });
  const connect = (brandSlug: string, service: "ga4" | "gsc", identifiers: Record<string, string>) =>
    upsertIntegration({ brandSlug, service, status: "connected", identifiers, actor });
  await connect("e2e-metrics", "ga4", { property_id: "515827425" });
  await connect("e2e-metrics", "gsc", { site_url: "sc-domain:e2e-metrics.example" });
  await connect("e2e-broken", "ga4", { property_id: FORBIDDEN_PROPERTY });
  await connect("e2e-broken", "gsc", { site_url: "sc-domain:e2e-broken.example" });
  await sql.end();
});

test("Sync now pulls GA4 and Search Console into the Analytics tab", async ({ page }) => {
  await page.goto("/b/e2e-metrics/plan?pane=integrations");
  await expect(page.getByText("Never synced")).toHaveCount(2);

  await page.getByRole("button", { name: "Sync Google Analytics 4 now" }).click();
  await expect(page.getByText("Google Analytics 4 synced (90 rows)")).toBeVisible();
  await page.getByRole("button", { name: "Sync Google Search Console now" }).click();
  await expect(page.getByText("Google Search Console synced (720 rows)")).toBeVisible();

  await page.goto("/b/e2e-metrics/analytics");
  await expect(page.getByRole("heading", { name: "Traffic (GA4)" })).toBeVisible();
  await expect(page.getByTestId("traffic-chart")).toBeVisible();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("1,800");
  await expect(page.getByTestId("gsc-impressions")).toHaveText("36,000");
  await expect(page.getByTestId("gsc-ctr")).toHaveText("5.0%");
  await expect(page.getByTestId("gsc-position")).toHaveText("8.5");
  await expect(page.getByRole("cell", { name: "roof repair flowood" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "/services" })).toBeVisible();

  await page.getByRole("link", { name: "30 days" }).click();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("600");
});

test("a forbidden property shows its exact reason and does not block Search Console (via MCP)", async ({ page, baseURL }) => {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  const r = await client.callTool({ name: "sync_metrics", arguments: { brand: "e2e-broken" } });
  await client.close();
  const body = JSON.parse((r.content as { text: string }[])[0].text) as { results: { source: string; status: string; message?: string }[] };
  expect(body.results.map((x) => [x.source, x.status])).toEqual([["ga4", "error"], ["gsc", "ok"]]);
  expect(body.results[0].message).toContain("does not have access to GA4 property 403403");

  await page.goto("/b/e2e-broken/analytics");
  await expect(page.getByRole("alert").filter({ hasText: "does not have access" })).toBeVisible();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("1,800");
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `pnpm e2e`
Expected: PASS — the existing `workspace.spec.ts` tests and both new tests. Requires Docker/local Supabase and the test DB (see Prerequisites). If the first navigation times out, `next dev` is compiling the route; re-run once before investigating.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e playwright.config.ts
git commit -m "test(e2e): Sync now and sync_metrics against a fake Google server" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, deployment check, spec amendments, final verification

**Files:**
- Modify: `scripts/verify-deployment.ts`, `docs/superpowers/deploy-runbook.md`, `README.md`, `docs/superpowers/specs/2026-10-05-ga4-gsc-data-pulls-design.md`

**Interfaces:**
- Consumes: everything above.
- Produces: operator documentation for creating and wiring the service account; a deployment check that no public response leaks key material; a spec that matches what was built.

- [ ] **Step 1: Add the key-leak check to `scripts/verify-deployment.ts`**

Add this entry to the `checks` array, after the "MCP endpoint rejects a wrong token" check and before the `if (process.env.MCP_TOKEN)` block. Use the same `fetch` options style as the neighbouring checks (if a Vercel protection-bypass header is added there on another branch, add it here too):

```ts
  {
    name: "no public response leaks service-account key material",
    run: async () => {
      for (const path of ["/login", "/api/mcp"]) {
        const res = await fetch(`${base}${path}`, { redirect: "manual" });
        const text = await res.text();
        if (/private_key|BEGIN (RSA )?PRIVATE KEY/.test(text)) return `${path} response contains key material`;
      }
      return null;
    },
  },
```

Run: `pnpm exec tsc --noEmit` → no errors. (The script itself needs a deployed URL; it is exercised in the live check.)

- [ ] **Step 2: Update the runbook**

In `docs/superpowers/deploy-runbook.md`:

1. In the "Values you will collect" table add a row:

```markdown
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud → IAM → Service accounts → Keys → JSON (optional; only for GA4 and Search Console sync) | Vercel |
```

2. Insert this section immediately before `## Rollback and cleanup`:

```markdown
## 9. Google data pulls: GA4 + Search Console (optional)

Lets the app pull its own metrics. Skip this and everything else still works; the Analytics sections just say to connect.

1. **[HUMAN]** Google Cloud Console → pick or create a project → APIs & Services → Library: enable **Google Analytics Data API** and **Google Search Console API**.
2. **[HUMAN]** IAM & Admin → Service accounts → Create (no project roles needed) → Keys → Add key → JSON. Keep the file out of the repo and out of chat.
3. **[HUMAN]** Put the key on Vercel as **one line**: `node -e "console.log(JSON.stringify(require('./key.json')))"` prints it; paste that into `GOOGLE_SERVICE_ACCOUNT_JSON` for Production and Preview and mark it **Sensitive**. Redeploy. Delete the key file afterwards. A pretty-printed multi-line paste fails with "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON".
4. **[HUMAN]** For each brand, add the service account's email (the `client_email` in the key) as a **Viewer** on the GA4 property (Admin → Property access management) and as a user on the Search Console site (Settings → Users and permissions).
5. **[AGENT or HUMAN]** In the app, Integrations pane for the brand: set Google Analytics 4 to **Connected** with `property_id=<digits>` and Search Console to **Connected** with `site_url=sc-domain:example.com` (or a full `https://example.com/` URL). Click **Sync now** on each.
6. Expected: a toast like "Google Analytics 4 synced (90 rows)", then charts on the Analytics tab. Errors show the exact reason, for example "The service account … does not have access to GA4 property …": that means step 4 is missing for that property. The first sync backfills 90 days; later syncs re-pull the last 7.
7. **[AGENT]** `pnpm tsx scripts/verify-deployment.ts https://<url>` must still pass, including "no public response leaks service-account key material".
```

3. In the results template table, add two rows after `AI Assets import (if done)`:

```markdown
| Google sync: GA4 (if done) | | |
| Google sync: Search Console (if done) | | |
```

- [ ] **Step 3: Update the README**

In `README.md`, in the Production section step 4, append to the list of environment variables: ``, and optionally `GOOGLE_SERVICE_ACCOUNT_JSON` (one-line service-account key; enables GA4 and Search Console sync, see `docs/superpowers/deploy-runbook.md` section 9)``. Keep `Do **not** set ALLOW_AUTH_BYPASS.` as the end of the step.

- [ ] **Step 4: Amend the spec to match what was built**

In `docs/superpowers/specs/2026-10-05-ga4-gsc-data-pulls-design.md` make these edits, then change its `**Status:**` line to `Approved; amended during planning (see §13)`:

1. §4 data model, `metric_points`: change "`value` (real)" to "`value` (double precision)"; and in the dimension example change `page:<path>` to `page:<full URL>` (the UI shortens it for display).
2. §4 data model: add to the **integrations** bullet: "and `synced_from` (date, null): the earliest day synced end to end for this source".
3. §5 Sync behavior, **Range** bullet: append "If the last successful sync was more than 7 days ago the rolling window is lengthened to cover the gap (capped at 400), so no day is skipped. The first sync is the one where `synced_from` is null."
4. §5 Tracker feed: replace the last sentence of step 1 and add a coverage rule: "A tracker is only checked in when `synced_from` is on or before the window start, so a 30-day tracker never receives a check-in built from 7 days of history. `observed_at` is the last millisecond of the window end date."
5. §6 Per-brand setup: replace "`site_url` (e.g. …)" with "`site_url` (also accepted: the legacy `site` key the v1 importer writes)".
6. §8 error table: first row code is `not_configured`; the invalid-JSON message says the key must be pasted on one line.
7. §12: replace the three open items with a new section:

```markdown
## 12. Resolved during planning

- GA4 `runReport` uses metric names `sessions`, `activeUsers`, `keyEvents` and the `date` dimension (YYYYMMDD); one request per sync is enough (at most 400 rows).
- Search Console returns at most 25,000 rows per request; the connector pages with `startRow`, capped at 4 pages. "Top 100" is computed locally: the 100 queries or pages with the most total clicks over the fetched range, with all of their per-day rows.
- The e2e uses a standalone Node fake Google server on 127.0.0.1:3199, enabled in the dev server by the test-only `GOOGLE_API_BASE_OVERRIDE` variable (ignored when `NODE_ENV=production`).

## 13. Amendments made while writing the implementation plan

`value` is double precision; page dimensions keep the full URL; `integrations.synced_from` and the gap-aware rolling window were added so tracker coverage and "no days skipped" are exact even for zero-traffic sites; `not_configured` is a distinct error code.
```

- [ ] **Step 5: Final verification**

Run each and confirm:

```bash
pnpm test            # unit + integration: all pass
pnpm exec tsc --noEmit
pnpm lint
pnpm e2e             # needs Docker/local Supabase
```

Then confirm no secret material is in the diff: `git diff origin/feat/marketing-workspace-v1 --stat` shows only the files listed in this plan, and `git grep -nE "BEGIN (RSA )?PRIVATE KEY" -- . ":!docs"` finds nothing.

Expected: all green; the diff contains no key material; the only new dependency is `google-auth-library`.

- [ ] **Step 6: Commit and push**

```bash
git add scripts docs README.md
git commit -m "docs(metrics): runbook, deployment key-leak check, and spec amendments for GA4/GSC sync" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
```

Open a **draft** PR against `feat/marketing-workspace-v1` (not `main`) with a summary of the slice and the live-check status (the real Google check needs the owner's service-account key and per-brand grants, runbook section 9). End the PR description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-Review (spec coverage)

| Spec requirement | Task |
|---|---|
| §1 criteria 1: Sync now / `sync_metrics` stores metrics and shows charts | 6, 7, 8, 9 |
| §1 criteria 2: idempotent re-sync | 6 (rolling-window and de-dup tests), 2 (unique key) |
| §1 criteria 3: tracker auto check-ins, v1 verdict unchanged | 6 (tracker feed tests) |
| §1 criteria 4: per-source failure isolation, readable message | 3, 6, 8, 9 |
| §1 criteria 5: no secret leaks | 3 (auth/http tests), 6 (crash test), 10 (verify-deployment check) |
| §2 service account, manual trigger, generic table, daily, one property/site | 3, 6, 2, 1 |
| §3 architecture and units | 3, 4, 5, 6 |
| §4 data model + catalog | 2, 1 |
| §5 sync behavior (90/7/400, ends yesterday, upsert 500, lock, activity) | 1, 6 |
| §6 credentials, scopes, per-brand setup, runbook, verify check | 3, 10 |
| §7 MCP tool, `get_brand_context` fields, UI card, Analytics tab, Agent prompt | 7, 8 |
| §8 error table | 3 (mapping), 4, 5, 6 |
| §9 testing (unit, integration, e2e, live check) | 1–9; live check is a HUMAN step in the runbook |
| §10 security (read-only scopes, RLS, bearer token, identifier validation) | 2, 3, 4, 5, 7 |
| §11 tech additions | 2 |
| Spec deviations | Task 10 Step 4 records each: double precision, full-URL page dimension, `synced_from`, gap-aware window, `not_configured` |

Type and name consistency was checked across tasks: `syncBrandMetrics`, `SyncSourceResult`, `getMetricSeries`, `getTopDimension`, `syncLockKey`, `defaultSyncDays`, `aggregateWindow`, `requiredMetrics`, `parseTrackerSource`, `Connector`/`Connectors`, `ConnectorError`/`ConnectorErrorCode` are defined once and used with the same signatures everywhere. Test ids `traffic-chart`, `gsc-clicks`, `gsc-impressions`, `gsc-ctr`, `gsc-position` and the button name `Sync <label> now` are defined in Task 8 and used in Task 9.

# Hughes Marketing Workspace — GA4 + Search Console Data Pulls (Slice 1)

**Date:** 2026-10-05
**Owner:** Corey Hughes, Five Hughes LLC
**Status:** Design approved in conversation; pending written-spec review
**Builds on:** `2026-10-02-marketing-workspace-design.md` (v1)

## 1. Purpose

v1 leaves data collection to the agent: the app only records integration identifiers, and tracker check-ins arrive
because an agent reports numbers. This slice lets the **app pull its own metrics** from Google Analytics 4 and
Google Search Console, so the "measure" step of the loop (onboard → audit → plan → execute → **measure** → re-score)
works without an agent in the loop.

### Success criteria

1. For a brand with a connected GA4 property and/or GSC site, clicking **Sync now** (or calling the MCP tool
   `sync_metrics`) stores daily metrics and shows the traffic and search charts on the Analytics tab.
2. Re-running a sync never duplicates data (idempotent).
3. A tracker whose `source` is `ga4:<metric>` or `gsc:<metric>` receives an automatic check-in after each sync,
   and its verdict is recomputed by the existing v1 logic.
4. A permission, quota, or misconfiguration failure on one source is shown as a readable message on that
   integration and does not block the other source.
5. No secret is ever printed, logged, committed, or returned by a tool.

### Out of scope (later slices)

Google Ads and any other connector; scheduled/cron syncing (the sync service is built so a cron can call it later);
per-user Google OAuth; hourly or real-time data; multiple GA4 properties or GSC sites per brand; custom
metric or report builders; alerting on metric changes; changes to scoring or audit logic.

## 2. Decisions

| Decision | Choice |
|---|---|
| Google auth | One Google **service account**. The owner adds its email as a Viewer on each client's GA4 property and Search Console site. No per-user OAuth, no refresh tokens. |
| Trigger | **Manual only**: a "Sync now" button per integration card and an MCP `sync_metrics` tool. Both call one service. |
| Storage | Generic `metric_points` table (one row per brand, source, metric, date, dimension). Not per-source tables, not raw JSON. |
| Granularity | Daily. |
| Cardinality | One GA4 property and one GSC site per brand, held in the existing `integrations.identifiers`. |
| Client library | Plain Google REST APIs authenticated with `google-auth-library`. No `googleapis` mega-package. |

## 3. Architecture

```
UI "Sync now"  ─┐
                ├─►  lib/services/metrics.ts  syncBrandMetrics(brand, source?, opts)
MCP sync_metrics ┘            │
                              ├─►  lib/connectors/ga4.ts   fetchGa4Daily(creds, propertyId, range)
                              ├─►  lib/connectors/gsc.ts   fetchGscDaily / fetchGscTop(creds, siteUrl, range)
                              │        (use lib/connectors/google-auth.ts for the service-account token)
                              ├─►  metric_points upsert
                              ├─►  integrations.last_synced_at / last_sync_error
                              ├─►  tracker auto check-ins (services/trackers.addCheckin)
                              └─►  activity row (kind: "integration")
Analytics tab ◄── lib/services/metrics.ts  getMetricSeries(brand, source, metric, range)
```

### Units and boundaries

- **`lib/connectors/google-auth.ts`**: parses `GOOGLE_SERVICE_ACCOUNT_JSON`, returns an access token for a given
  scope. Depends only on `google-auth-library` and env. Never logs the key.
- **`lib/connectors/ga4.ts`, `gsc.ts`**: pure fetch + parse. Input: credentials, identifier, date range. Output:
  typed `MetricPointInput[]`. No database access. Map HTTP failures to a `ConnectorError` with a stable `code`
  (`permission_denied`, `not_found`, `quota`, `bad_identifier`, `unavailable`) and a human message.
- **`lib/domain/metrics.ts`**: the metric catalog (id, source, label, unit, direction, how to aggregate for a
  tracker value) and date-range helpers. Pure, unit-tested.
- **`lib/services/metrics.ts`**: orchestration, upsert, status recording, tracker feed, series queries.
- **MCP tool and UI**: thin callers of the service.

## 4. Data model

New migration `0002_metric_points.sql` (drizzle). RLS enabled with deny-all for anon, like every other table.

- **metric_points**: `id` (uuid), `brand_id` → brands (cascade), `source` (`ga4` | `gsc`), `metric` (text),
  `date` (date), `dimension` (text, not null, default `''`; e.g. `query:<text>` or `page:<path>`), `value` (real),
  `created_at`, `updated_at`. **Unique** on (`brand_id`, `source`, `metric`, `date`, `dimension`). Index on
  (`brand_id`, `source`, `metric`, `date`).
- **integrations** gains `last_synced_at` (timestamptz, null) and `last_sync_error` (text, null).

### Metric catalog (v1 of this slice)

| Source | Metric id | Meaning | Direction |
|---|---|---|---|
| ga4 | `sessions` | Sessions per day | up |
| ga4 | `users` | Active users per day | up |
| ga4 | `key_events` | Key events (conversions) per day | up |
| gsc | `clicks` | Clicks per day (dimension `''`) | up |
| gsc | `impressions` | Impressions per day (dimension `''`) | up |
| gsc | `ctr` | Click-through rate per day, 0–1 | up |
| gsc | `position` | Average position per day | down |
| gsc | `query_clicks` | Clicks per query per day, top 100 queries (dimension `query:<text>`) | up |
| gsc | `page_clicks` | Clicks per page per day, top 100 pages (dimension `page:<path>`) | up |

Only dimension `''` rows feed charts and trackers by default; query and page rows feed top-queries and top-pages
tables.

## 5. Sync behavior

- **Inputs:** brand slug, optional `source` (default: all connected of `ga4`, `gsc`), optional `days`.
- **Range:** first sync for a source (no `metric_points`) backfills **90 days**; later syncs re-pull a rolling
  **7 days** to absorb GSC's late-arriving data. `days` overrides, max 400. The range ends at yesterday (GSC data
  for today is incomplete).
- **Eligibility:** an integration is syncable when `status = connected` and its required identifier exists:
  `property_id` for `ga4`, `site_url` for `gsc`. Otherwise the source is skipped with a `skipped` reason, not an error.
- **Upsert:** `INSERT ... ON CONFLICT (brand_id, source, metric, date, dimension) DO UPDATE SET value`.
  Batches of 500 rows.
- **Isolation:** each source runs in its own try/catch. Result per source:
  `{source, status: "ok" | "error" | "skipped", rows, from, to, message?}`.
- **Status recording:** on success set `last_synced_at = now`, clear `last_sync_error`. On failure set
  `last_sync_error` to the `ConnectorError` message and leave `last_synced_at` unchanged. Never change
  `integrations.status`; the owner or agent still controls that.
- **Concurrency:** a Postgres advisory lock per (brand, source) makes a second concurrent sync return
  `skipped: "already running"`.
- **Activity:** one `integration` activity row per source, e.g. "Google Analytics 4: synced 90 days (1,234 rows)"
  or "Google Search Console: sync failed (permission denied)". Actor is the user or MCP token name.

### Tracker feed

After a successful sync, for each tracker on the brand with `source` matching `ga4:<metric>` or `gsc:<metric>`
where `<metric>` is in the catalog:

1. Compute the value over the tracker's most recent complete window of `window_days` ending yesterday:
   `sum` for `sessions`, `key_events`, `clicks`, and `impressions`. `users` is also summed (a sum of daily active
   users, labelled "user-days" in the UI, because unique users across a window cannot be rebuilt from daily rows).
   `ctr` is recomputed as `Σclicks / Σimpressions`, and `position` is the impressions-weighted mean. The
   aggregation rule for each metric lives in the catalog.
2. Call `addCheckin` with `source = "<source>:<metric> (auto)"` and an `observed_at` of the window end.
3. At most one auto check-in per tracker per window end date (skip if one exists), so repeat syncs do not pile up.

The v1 verdict logic is unchanged and still decides `pending` / `positive` / `neutral` / `negative`.

## 6. Credentials and setup

- **Env:** `GOOGLE_SERVICE_ACCOUNT_JSON` (the service-account key JSON, one line). Optional in `parseEnv` so
  existing deployments keep working; syncing without it returns a clear "Google service account not configured"
  message. On Vercel it is marked **Sensitive** and set for Production and Preview.
- **Scopes:** `analytics.readonly` and `webmasters.readonly`.
- **Per-brand setup (HUMAN):** add the service-account email as Viewer on the GA4 property (Admin → Property
  Access Management) and as a user on the Search Console site (Settings → Users and permissions). Then set
  `property_id` (digits only) and `site_url` (e.g. `sc-domain:example.com` or `https://example.com/`) on the
  brand's integration cards.
- **Never exposed:** the key is read server-side only. It is never returned by a tool, never included in an
  activity row or error message, and `.env*` files stay git-ignored. `scripts/verify-deployment.ts` gains a check
  that no response body contains `private_key`.
- **Runbook:** a new section in `docs/superpowers/deploy-runbook.md` covers creating the service account and the
  per-brand grants.

## 7. MCP and UI

### MCP tool `sync_metrics`

Input `{ brand: string, source?: "ga4" | "gsc", days?: number }`. Returns the per-source result list from §5.
Validated with zod like every other tool; writes activity rows. Not gated by approval (it only reads Google and
writes metrics). `get_brand_context` also returns each integration's `last_synced_at` and `last_sync_error`.

### UI

- **Integrations card (right pane):** for `ga4` and `gsc`, show last synced time, any error, and a **Sync now**
  button (disabled while running; toast with the per-source result).
- **Analytics tab:** below the v1 Health trend, two sections:
  - **Traffic (GA4):** sessions, users, key events line chart (recharts), 30/90-day toggle.
  - **Search (GSC):** clicks and impressions line chart, plus CTR and average position, and top queries and
    top pages tables for the selected range.
  - Each section shows last synced, an empty state ("Connect Google Analytics 4 on the Integrations pane"), and the
    exact `last_sync_error` when present.
- **Agent tab:** a copyable prompt "Sync metrics for <brand>" using the new tool.

## 8. Error handling

| Condition | Behavior |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` missing or invalid | Source result `error`, message "Google service account is not configured"; no stack trace. |
| 403 from Google | `permission_denied`: "The service account `<email>` does not have access to GA4 property `<id>`." (email is the public `client_email`, not a secret) |
| 404 / invalid property or site | `bad_identifier`, naming the identifier. |
| 429 / quota | `quota`, with a "try again later" message. One retry with backoff inside the connector. |
| 5xx / network | `unavailable`, one retry, then error. |
| Partial failure | Rows already upserted stay; the error is recorded; the other source still runs. |

Errors never include request bodies, tokens, or the key.

## 9. Testing

- **Unit (vitest, `unit` project):** catalog and aggregation rules (sum, weighted position, recomputed CTR),
  range helpers, GA4 and GSC response parsing against recorded fixtures, `ConnectorError` mapping, env parsing.
- **Integration (against the test DB):** upsert idempotency (sync twice, same row count), 90-day backfill then
  7-day rolling window, tracker auto check-in created once per window, verdict recomputed, per-source isolation,
  advisory-lock skip, RLS deny-all on `metric_points`.
- **E2E (Playwright):** with the connector stubbed by a local fake Google server, Sync now populates the Analytics
  tab charts and shows an error state when the stub returns 403.
- **Live check (HUMAN):** one real GA4 property and one real GSC site, recorded in
  `docs/superpowers/live-check-*.md` using the existing template.

## 10. Security

- Service-account key only in env; never in the repo, logs, activity rows, tool results, or error text.
- Read-only scopes only.
- `metric_points` has RLS enabled with deny-all for anon; all access goes through the server.
- `sync_metrics` requires the same personal bearer token as every other MCP tool.
- Identifiers entered on integration cards are validated (digits for `property_id`; `sc-domain:` or `https://` for
  `site_url`) before use in a request.

## 11. Tech additions

`google-auth-library` (service-account JWT). No other new runtime dependencies; charts use the existing
`recharts`, HTTP uses built-in `fetch`.

## 12. Open items for the implementation plan

- Confirm the exact GA4 Data API `runReport` dimension and metric names for key events in the current API version.
- Confirm GSC `searchAnalytics.query` row limits and pagination for the 100-row top lists.
- Decide the e2e fake-Google-server mechanism (a Next route under a test-only flag vs. a standalone node server).

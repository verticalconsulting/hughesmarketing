# Hughes Marketing Workspace — v1 Design

**Date:** 2026-10-02
**Owner:** Corey Hughes, Five Hughes LLC
**Status:** Approved in conversation; pending written-spec review

## 1. Purpose

An internal web app for Five Hughes LLC to manage client brands through a closed marketing loop:
**onboard → audit → plan → execute → measure → re-score**.

The app is the **system of record**, not the AI. Claude Desktop or OpenClaw do the agent work (research, audits, drafting, browser automation) and read/write the app through an **MCP server** the app exposes. The app stores brands, files, audits, plans, plan items, trackers, integrations, and activity, and computes scores.

### Success criteria for v1

1. A team member signs in, adds a brand, and sees it in the brand switcher.
2. Claude Desktop connects to the MCP endpoint with a personal token and completes onboarding, an audit, and a plan for that brand using only MCP tools plus its own browser automation.
3. The Plan tab shows the Health score, the change since the previous audit, the funnel, category bars, and plan items.
4. A completed plan item gets a tracker; after check-ins, the app shows a positive/neutral/negative verdict.
5. All 7 existing brands from the Google Drive `AI Assets` folder, with their audits, plans, deliverables, and shared skills, are imported and browsable with markdown preview.

### Out of scope for v1 (later slices)

App-side OAuth data pulls (GA4, Search Console, Google Ads), scheduled jobs, Briefs, Calendar, Workflows editor, Permissions, Email, client logins, multi-tenant/agency SaaS, billing, two-way Google Drive sync.

## 2. Decisions

| Decision | Choice |
|---|---|
| Users | Internal team only. Google sign-in restricted to an email allowlist. All signed-in users see all brands. |
| Hosting | Next.js (App Router, TypeScript) on Vercel. Supabase Postgres + Supabase Storage. |
| Agent access | Remote MCP server at `/api/mcp` (Streamable HTTP), authenticated by per-user bearer tokens. |
| Integrations | Agent pulls data with its own connectors; the app records accounts, IDs, and status per brand. |
| Scoring | Composite Health score from audit category scores, plus per-change KPI trackers with verdicts. |
| Browser automation | Done by Claude in Chrome / OpenClaw. The app provides setup instructions and copyable per-brand prompts; it does not drive a browser. |

## 3. Architecture

```
Claude Desktop / OpenClaw ──MCP (bearer token)──┐
  + Claude in Chrome (browser automation)        │
                                                 ▼
Team browser ──Google sign-in──▶ Next.js app on Vercel
                                 ├─ UI (3-pane workspace)
                                 ├─ /api/mcp  (MCP tools)
                                 ├─ Server actions (UI writes)
                                 └─ Domain services ──▶ Supabase Postgres + Storage
```

### Units and boundaries

- **`lib/domain/*`** — pure business logic with no framework imports: scoring engine, verdict computation, onboarding/plan question selection, path normalization. Fully unit-tested.
- **`lib/data/*`** — repository functions over Postgres (Drizzle ORM). The only code that touches the DB.
- **`lib/services/*`** — use cases that combine domain + data and write the activity log (e.g. `recordAudit`, `createPlanVersion`, `completePlanItem`). Both the UI server actions and the MCP tools call these; neither talks to the DB directly.
- **`app/api/mcp`** — thin MCP adapter: validates input with zod, resolves the token's user, calls a service, returns structured results.
- **`app/(workspace)/*`** — UI routes and components.
- **`scripts/import-ai-assets`** — one-time importer from a local copy of the AI Assets folder.

## 4. Data model

All tables have `id` (uuid), `created_at`, `updated_at`.

- **users** — email, name, avatar. Created on first allowlisted sign-in.
- **api_tokens** — user_id, name, token_hash (SHA-256), last_used_at, revoked_at. Token shown once on creation.
- **companies** — name. Seeded with "Five Hughes LLC".
- **brands** — company_id, name, slug, domain, stage (`onboarding` | `audited` | `planned` | `executing`), onboarding (jsonb answers), color (avatar).
- **files** — brand_id (nullable; null = shared), path (e.g. `audits/2026-09-29-123919-full-audit.md`, `skills/ads-audit/SKILL.md`), content_type, size, storage_key (Supabase Storage), current_version. Unique on (brand_id, path).
- **file_versions** — file_id, version, storage_key, author (user or agent token name), created_at. Every write creates a version; nothing is overwritten.
- **audits** — brand_id, audited_at, file_id (report), health (0–100), coverage (0–1), request_id (unique, nullable) for idempotency.
- **audit_scores** — audit_id, category, score (0–100), target (0–100, nullable), evidence (text).
- **plans** — brand_id, version, status (`active` | `archived`), objective, primary_channel, secondary_channels (text[]), monthly_budget, weekly_hours, timeline, source_audit_id, summary, request_id. Creating a version archives the previous active one.
- **plan_items** — plan_id, title, description, funnel_stage (`acquisition` | `activation` | `retention` | `referral` | `revenue`), channel, priority (int), status (`planned` | `active` | `needs_approval` | `approved` | `done` | `blocked` | `declined`), expected_kpi, needs_approval (bool), approval_note, approved_by, approved_at, linked file ids (join table `plan_item_files`).
- **trackers** — plan_item_id, kpi, unit, direction (`up` | `down` is better), baseline_value, baseline_at, source, window_days, threshold_pct (default 5), verdict (`pending` | `positive` | `neutral` | `negative`), verdict_at.
- **tracker_checkins** — tracker_id, value, observed_at, source, note.
- **integrations** — brand_id, service (`ga4` | `gsc` | `google_ads` | `github` | `facebook` | `google_business_profile` | `formspree` | `wordpress` | `wix` | `other`), status (`connected` | `not_connected` | `error`), identifiers (jsonb, e.g. `{"property_id":"515827425"}`), notes, verified_at.
- **activities** — brand_id (nullable), actor (user id or token), kind (`chat` | `workflow` | `audit` | `plan` | `approval` | `file` | `tracker` | `integration`), summary, ref_type/ref_id.
- **scoring_config** — single row: category weights (jsonb), score bands. Editable later; seeded with defaults below.

## 5. Scoring

### Categories (match existing Magister audits)

`ai_visibility`, `geo`, `seo`, `website_content`, `social`, `paid_ads`.

### Health score

`health = round( Σ(wᵢ·sᵢ) / Σ(wᵢ) )` over categories present in the audit.
Default weights: AI Visibility 20, GEO 15, SEO 20, Website & Content 20, Social 10, Paid Ads 15.
`coverage = Σ(wᵢ present) / Σ(all wᵢ)`. If coverage < 0.6, the audit is stored but its health is shown as "partial" and excluded from the trend and delta.

**Delta** = this audit's health − the previous non-partial audit's health for the same brand.
**Bands:** < 40 red, 40–69 amber, ≥ 70 green.

### Tracker verdicts

- Change % = `(latest − baseline) / |baseline| × 100`; if baseline = 0, use absolute change and treat any change ≥ 1 unit as beyond threshold.
- Signed by direction: for `down`-is-better KPIs the sign flips.
- Verdict stays `pending` until `baseline_at + window_days` has passed and at least one check-in exists after that date.
- Then: signed change ≥ +threshold → `positive`; ≤ −threshold → `negative`; otherwise `neutral`.

## 6. MCP server

Endpoint `POST /api/mcp` (Streamable HTTP, stateless). Header `Authorization: Bearer <token>`. Every tool validates with zod, returns JSON, and writes an activity row for writes.

| Tool | Purpose |
|---|---|
| `list_brands` | Brands with stage, domain, latest health |
| `get_brand_context` | Brand, onboarding answers, active plan + items, latest audit + scores, open trackers, integrations |
| `get_onboarding_questions` | Questions whose answers are missing for a brand |
| `save_onboarding` | Merge answers; advances nothing by itself |
| `list_files` / `read_file` / `write_file` | Brand or shared files by path; `write_file` takes optional `expected_version` and fails on mismatch |
| `read_skill` | Shortcut for `skills/<name>/SKILL.md` plus its reference file list |
| `record_audit` | Category scores + evidence + report path + `request_id`; computes health; sets stage `audited` |
| `get_plan_questions` | Plan questions not answered by onboarding or latest audit |
| `create_plan_version` | Plan + items + `request_id`; archives prior active plan; sets stage `planned` |
| `get_next_plan_item` | Highest-priority item in `planned` or `approved` |
| `update_plan_item` | Status, notes, linked file paths; `done` requires a tracker to exist or be created in the same call; sets stage `executing` |
| `start_tracker` / `add_checkin` | Create tracker; add check-in and recompute verdict |
| `upsert_integration` | Record service status and identifiers |
| `log_activity` | Free-form activity entry (e.g. chat summaries) |

**Approval rule:** `update_plan_item` cannot move an item with `needs_approval = true` to `active` or `done` unless it is `approved`. Approval happens only in the UI.

### Onboarding questions (v1 set)

Business and offer, primary audience, service locations, primary goal (leads, sales, signups, donations), current marketing channels, monthly budget, weekly hours, top competitors, brand voice notes, approval rules, website platform.

### Plan questions

Primary goal, primary channel and secondary channels, monthly budget, timeline horizon, risk tolerance, and any constraints. Questions already answered by onboarding are skipped.

## 7. UI

Three-pane workspace modeled on the reference screenshot, with more color.

**Top bar:** company switcher → brand switcher (colored domain avatar) → Health pill (band color, ▲/▼ delta) → stage badge. Center tabs: Agent, Analytics, Plan, Briefs, Calendar. Right: Browser Automation and MCP buttons (dialogs with setup steps, token creation, and copyable prompts).

**Left sidebar:** search; Pinned; activity history grouped Today / Previous 7 Days / Previous 14 Days with type-colored icons; Get-started checklist (onboarding steps for the current brand); Notifications (pending approvals count); profile menu.

**Plan tab (default):**
- Header: status, version, updated date, objective; buttons View audit, Rerun audit, Rebuild plan, Edit with agent (copy prompt).
- Health card: large score, delta, sparkline.
- Primary channel progress bar: completed / active / blocked.
- Growth funnel: five stage cards (Acquisition blue, Activation teal, Retention violet, Referral amber, Revenue green) with item counts.
- "Where you stand": per-category bars, current vs target.
- Plan items list: status chips, Approve / Decline for `needs_approval` items, tracker verdict badge (▲ green positive, ● gray neutral, ▼ red negative).

**Analytics tab:** Health trend line, category trend lines, trackers table (KPI, baseline, latest, change %, verdict).
**Agent tab:** connection status and stage-appropriate copyable prompts.
**Briefs / Calendar:** "Coming next" placeholders.

**Right pane (resizable, collapsible):**
- **Assets:** file tree (brand folders + shared `workspace/` and `skills/`), upload, markdown preview (GFM, front matter shown as a header table, syntax-highlighted code, Mermaid), raw view, download, version history.
- **Integrations:** cards per service with status and editable identifiers.
- **Skills:** searchable list of shared skills; opening one previews its `SKILL.md`.
- **Workflows, Permissions, Email:** placeholders.

**Palette:** indigo `#4F46E5` primary accent; background `#FAFAF9`; white cards; funnel and score-band colors as above; full dark mode via CSS variables. Responsive down to tablet; phone shows one pane at a time.

## 8. Importer

`pnpm import:ai-assets <path-to-AI-Assets>`; idempotent (upsert by brand slug + path).

- Each top-level folder except `Hughes Files`, `_Duplicates-to-delete`, and `_Personal-Automations` becomes a brand. Slug from folder name; domain from folder name when it looks like a domain (`Mercyhouseatc.com-vehicledonation` → domain `vehicledonationms.com` via a small override map).
- `Hughes Files/skills/**` → shared files under `skills/`; `Hughes Files/workspace/**` → shared `workspace/`; `Hughes Files/workflow-templates/**` → shared `workflow-templates/`.
- All brand files keep their relative paths.
- Each `audits/*-audit.md` with `## <Category>` sections followed by `**Readiness:** N/100` creates an audit with those category scores; `audited_at` from the filename date.
- `PLAN.md` creates an active plan (version, objective, budget, horizon from the header lines). Plan items are not parsed in v1; the plan body is linked as its file.
- `INTEGRATIONS.md` connected services are recorded as integrations when present.
- Stage: `planned` if a plan exists, else `audited` if an audit exists, else `onboarding`.

## 9. Security

- Google OAuth via Supabase Auth; sign-in rejected unless email is in `ALLOWED_EMAILS`.
- MCP tokens: random 32 bytes, stored hashed, revocable in the profile menu.
- Supabase service-role key used server-side only; Row Level Security enabled with deny-all for anon.
- Files are served through the app (signed, short-lived URLs), never public buckets.
- Importer skips nothing silently: it prints a report of imported, skipped, and failed paths. It never imports files from `_Personal-Automations`.

## 10. Error handling

- Validation errors return the field and reason; nothing is written.
- `write_file` version conflicts return the current version so the agent can re-read and merge.
- `request_id` makes `record_audit` and `create_plan_version` safe to retry.
- Unknown brand slug or path → not-found error listing close matches.
- UI server actions surface failures as toasts; optimistic updates roll back on error.

## 11. Testing

- **Unit (Vitest):** scoring (weights, coverage, partial audits, delta), verdicts (direction, zero baseline, window not elapsed), question selection, importer parsing of real audit and plan samples.
- **Integration (Vitest + local Supabase):** each MCP tool and service against a test database, including the approval rule and idempotency.
- **E2E (Playwright):** sign in (test auth bypass in test env only) → add brand → seed audit via MCP → see Health and delta → approve an item → tracker verdict appears.
- **Live check before declaring v1 done:** connect real Claude Desktop to a preview deployment and run onboarding → audit → plan on a test brand.

## 12. Tech stack

Next.js 15 App Router, TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM, Supabase (Postgres, Auth, Storage), `@modelcontextprotocol/sdk` (Streamable HTTP transport), zod, react-markdown + remark-gfm + rehype-highlight + mermaid, Recharts, Vitest, Playwright, pnpm.

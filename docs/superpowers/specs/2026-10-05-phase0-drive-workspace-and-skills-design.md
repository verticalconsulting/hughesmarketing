# Phase 0 — Drive Restructure, Live Drive Workspace, Skills Tab

**Date:** 2026-10-05
**Owner:** Corey Hughes, Five Hughes LLC
**Status:** Approved 2026-10-05. Review answers: topic folders under `resources/` (yes); keep `data/` (yes); 10-minute poll plus manual Sync for Phase 0 (yes).
**Builds on:** `2026-10-02-marketing-workspace-design.md` (v1). This reverses two v1 decisions: "two-way Google Drive sync" is no longer out of scope, and files are no longer app-owned only.

## 1. Purpose

Make the Google Drive `AI Assets` folder the working file store behind the app. A team member opens a client, sees that client's real Drive folder in the Assets pane, and can view and edit the files from the UI. The shared skills in `Hughes Files/skills/` appear in the Skills tab, grouped and toggleable as in the Magister screenshots. First, the Drive folders are tidied to a consistent layout so the app and the agents see the same paths.

### Success criteria

1. Every client folder follows one documented layout; no loose topic folders, no `(1)`/`(2)` duplicates, nothing deleted.
2. Switching client in the top bar changes the Assets tree to that client's Drive folder. Onboarding a new client creates the standard folder set in Drive and opens it.
3. From the UI a user can preview, edit (text), upload, create, rename, move, download, and open-in-Drive, with conflict detection and a copyable path bar.
4. A change made in Drive appears in the UI after a refresh/sync; a change made in the UI appears in Drive.
5. The Skills tab lists every skill in `Hughes Files/skills/`, grouped by category, searchable, with a per-client on/off toggle and a skill preview.

### Out of scope here

Share links (Phase 1), workflows runner, Drive push-notification webhooks, permanent delete, real-time collaborative editing, two-way merge of concurrent edits (conflicts are detected and surfaced, not merged).

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Client root | Keep the per-client root (`<ClientDomain>/`). Magister's `workspace/` equals the client root. |
| Assets pane | Follows the active client. Onboarding scaffolds the folder set and opens it. |
| Data tabs (later) | GA4 and GSC are OAuth-connected integrations. |

## 3. Target Drive layout (per client)

Magister's agent paths (`workspace/resources/...`) map 1:1 onto ours with `workspace/` removed.

```
<ClientDomain>/
  BRAND.md  PLAN.md  PROJECT.md  INTEGRATIONS.md  WORKFLOWS.md  MEMORY.md   system-managed exports; read-only in the UI
  audits/                    dated *-full-audit.md; system-managed; read-only in the UI
  plans/                     older plan versions
  memory/                    YYYY-MM-DD.md checkpoints, MEMORY.md, USER.md
  data/                      CSV/XLSX/JSON exports (Magister calls this uploads/; we keep data/)
  workflows/<name>/SKILL.md  client workflow forks
  ads-audit/<date>-<scope>/  skill-defined output paths, unchanged
  ads-optimize/<date>-<scope>/
  content-drafts/            drafts awaiting review
  seo-page-map/              keyword-to-page maps
  deliverables/              proposals, briefs, agreements (kept as-is)
  archive/                   superseded versions
  resources/
    audits/                  named audit snapshots
    ai-answer-foundation/  ai-visibility/  geo-technical-fixes/  mobile-lead-path/
    paid-search/  seo/  local-service-pages-<date>/
    workflow-results/<workflow-slug>/<date>/step-N-<name>.md
```

Rules: dated folders carry the date suffix; `workflow-results` nests by workflow then date; topic folders live under `resources/`.

### Move map (derived from the current tree)

Only `Myelitegutters.com` is materially off-layout; the other six already match except for duplicates and `workflow-results` nesting.

| From | To |
|---|---|
| `Myelitegutters.com/{ai-answer-foundation,ai-visibility,geo-technical-fixes,mobile-lead-path,paid-search,seo}/` | `.../resources/<same>/` |
| `local-service-pages/README.md` | `resources/local-service-pages-2026-10-03/README.md` |
| `local-service-pages/brandon-*.md`, `madison-*.md` | `content-drafts/` |
| `local-service-pages/keyword-to-page-map-2026-10-03.md` | `seo-page-map/` |
| `<client>/workflow-results/<run-id>-<workflow>.md` (all clients) | `resources/workflow-results/<workflow-slug>/<date>/` (date from file `Prepared:` line or modified time; slug from filename) |
| `<client>/workflow-results/` other content | `resources/workflow-results/` |
| Files with ` (1)`, ` (2)`, ` (3)` suffixes | If byte-identical to a plain-named file (same folder first, then anywhere in the client) or to a lower-numbered copy: `_Duplicates-to-delete/<client>-<name>-copy<N><ext>` (the existing `organize-inbox` convention). If different from the same-folder original: left in place and listed for your decision. A lone suffixed file gets an optional rename that strips the suffix, applied only on request. |

Things this does not do: delete anything, rewrite file contents, or touch `Hughes Files/`, `_Personal-Automations/`, `.claude/`.

### Procedure

1. **Dry run (read-only):** script prints every from→to move, name collisions, duplicate classification, and markdown files that mention an old path (stale references are listed, never auto-edited).
2. **You review the report.**
3. **Execute** with a JSON manifest of every move and a generated undo script. Moves are same-Drive renames, no copies.
4. Update Drive `README.md`, `CLAUDE.md`, and the `organize-inbox` skill to the new layout.

## 4. Live Drive connection

### Approach

The app talks to the Google Drive API. Drive is the source of truth for file content; the app's `files`/`file_versions` tables become an index plus cache so the tree loads fast and history survives.

Rejected: (a) keep an app-owned store and re-import (not "connected"); (b) a local desktop sync agent (Vercel cannot reach `C:\Users\...\Google Drive Streaming`; the existing `pnpm import:ai-assets` stays as an offline bootstrap).

### Authorization

One workspace-level Drive connection, created by the owner in Settings, not per user. Team members use it through the app; their own sign-in stays Supabase Google sign-in with the email allowlist.

- Scope: full `drive`, because existing files were not created by the app (`drive.file` would not see them).
- Credentials: OAuth refresh token, encrypted at rest with AES-256-GCM using a server-only key; never sent to the browser or MCP.
- **Open technical risks to confirm in a one-hour spike before building** (flagged because they decide the auth design):
  - Refresh-token lifetime. The owner account is a personal Gmail address, so the consent screen is "External". Apps left in "Testing" are understood to expire refresh tokens after 7 days; apps set to "In production" but unverified are understood not to, at the cost of an "unverified app" warning and a 100-user cap, which is fine for an internal team. Confirm before relying on it.
  - A service account would avoid tokens entirely for reads, but files it creates in a personal My Drive are understood to fail on storage quota. If the spike confirms that, OAuth-as-owner is the design.

### Data model changes

- `drive_connections`: id, account_email, root_folder_id (the `AI Assets` folder), encrypted_refresh_token, created_at, revoked_at.
- `brands.drive_folder_id` (nullable until bound). The shared pseudo-brand for `Hughes Files` binds to its own folder id.
- `files`: add `drive_file_id`, `drive_md5`, `drive_modified_at`, `drive_head_revision_id`, `drive_mime`. Unique on `drive_file_id` where not null.
- Existing `file_versions` keep recording each app-made write.

### Behavior

- **Bind:** brand → folder id, picked from the root folder's children. Onboarding a new brand creates the standard folder set (section 3) via the API, then binds.
- **Tree:** lazy; one folder level per request, served from the index, refreshed in the background.
- **Sync:** Drive `changes.list` with a stored page token, run when a tree is opened, on a manual Sync button, and by a Vercel cron every 10 minutes. No push webhooks in Phase 0.
- **Read:** metadata from the index; content fetched from Drive and cached in Storage keyed by md5. Large or binary files stream on demand and are not cached.
- **Write:** UI save sends the expected `drive_head_revision_id`. If Drive has moved on, the save fails with the current content so the user can re-open and merge. Success updates Drive, the index row, and adds a `file_versions` row.
- **Delete:** moves to Drive trash only, after a confirm dialog. No permanent delete anywhere.
- **Read-only paths in the UI:** `audits/**`, `INTEGRATIONS.md`, `WORKFLOWS.md`, `Hughes Files/workspace/**` (per the Drive `CLAUDE.md`). Editing them requires an explicit "Edit anyway" action that is logged.
- Ignore `desktop.ini`, `Thumbs.db`, dot-folders, `_Personal-Automations`, `_Duplicates-to-delete`.
- MCP `list_files`/`read_file`/`write_file` call the same service, so agents and the UI see one store.

## 5. Assets pane (UI)

- Header "Brand Files" with the client name; tree shows the section 3 layout, folders collapsed except `resources/` last-opened state.
- Path bar under the tree: selected file path (relative to the client root) with a copy button, matching the Magister screenshots.
- Actions: Preview (markdown, JSON, CSV table, image, PDF, sandboxed HTML with scripts disabled), Edit text, Upload, New file, New folder, Rename, Move, Download, Open in Drive, Version history.
- Brand switcher change re-roots the tree and keeps a per-brand expanded-folder memory in localStorage (wrapped in try/catch).
- Empty/unbound state: "Connect this client to a Drive folder" with a folder picker.

## 6. Skills tab

- Source: `Hughes Files/skills/<slug>/SKILL.md`, read through the Drive index. Parse frontmatter `name`, `description`, `metadata.version`, `user-invocable`.
- The frontmatter has no category, so categories come from a map in `lib/domain/skill-categories.ts`: explicit slug → category for the 46 skills, a prefix fallback (`ads-*` → Ads, `magister-*` → looked up individually), default "Other". Category order follows the screenshots: SEO, Ads, Copywriting & Content, Email & Outreach, CRO, Strategy & Growth, Sales & Revenue, Analytics, Integrations, Agent Behavior, Search & Research, Content & Design, Communication, Automation & Tools, Operations & Productivity, Other.
- Card: name, MANAGED badge (all skills from `Hughes Files`), two-line description, on/off toggle, "Make Workflow" button.
- Header "N skills installed" and a search box.
- Toggle state: `brand_skills(brand_id, skill_slug, enabled)`, default enabled, per client.
- Opening a card previews `SKILL.md` and its `references/` file list (exists in v1).
- "Make Workflow" is rendered disabled with a "Phase 4" tooltip until workflows exist.
- Only skills present in Drive are shown. The screenshots show 100+ managed skills; Drive holds 46, and we do not invent the rest.
- MCP gains `list_skills` (slug, category, enabled for brand); `read_skill` refuses a skill disabled for that brand.

## 7. Security

- Drive file content is untrusted. HTML previews render in a sandboxed iframe without scripts; markdown goes through the existing sanitizer.
- All paths pass `normalizePath`; Drive ids are never accepted from the client without checking they sit under the brand's bound folder.
- Refresh token never leaves the server; rotation/revoke from Settings.
- Every write logs an activity row with actor and file path.

## 8. Testing

- Unit: category map completeness (every Drive skill has a category or lands in Other), move-map generator (collisions, duplicate classification, workflow-results date/slug parsing), conflict detection.
- Integration: Drive client behind an interface with a fake implementation; sync, bind, write-conflict, read-only-path guard.
- Restructure script: runs against a copy of the tree in a temp directory in tests; the undo script round-trips to an identical tree.
- E2E: switch client → tree changes; edit a markdown file → Drive fake shows it; conflict shows the re-open message.

## 9. Delivery order (each its own plan)

1. **Restructure script + dry-run report** (independent; first, can start immediately; execution waits for your review of the report).
2. **Drive spike** (token lifetime, service-account quota), then Drive client, data model, sync, bind/scaffold.
3. **Assets pane** on the new service.
4. **Skills tab.**

## 10. Questions for review

1. Topic folders under `resources/` (matches Magister) as in section 3: confirm, or keep them at the client root?
2. Keep `data/` rather than renaming it to Magister's `uploads/`: confirm.
3. Is a 10-minute poll plus manual Sync acceptable for Phase 0, with push notifications later?

# Live check — 2026-10-04

Deployed URL: not deployed yet   Commit: e7b1a99   Done by: agent (Claude Code), steps 1.3 and 2 complete; waiting on owner for steps 3-4

| Step | Result (pass/fail) | Notes or exact error |
|---|---|---|
| Bucket created | pass | `Created private bucket "files".` |
| Migrations applied | pass | `migrations applied successfully!` over the session pooler (port 5432). `check-db.ts`: PASS one company seeded, PASS one scoring_config row seeded, PASS row-level security on every public table, `Database is ready.` |
| verify-deployment.ts | PASS (on re-run) | Re-run with `VERCEL_AUTOMATION_BYPASS_SECRET` (script now sends `x-vercel-protection-bypass`): all 4 checks PASS, "All checks passed." First run, without the header, FAILED as follows: |
| (first run, superseded) | FAIL | https://hughesmarketing-4ze2ae2wd-fivehughesllc.vercel.app — FAIL login page is public and offers Google sign-in: `expected 200, got 302`. FAIL workspace requires sign-in: `expected redirect to /login, got 302 https://vercel.com/sso-api?url=...` (Vercel Deployment Protection is on). PASS MCP rejects no token / wrong token (not meaningful while the protection redirect is in front of the app). |
| Allowlisted sign-in | not run | HUMAN step. |
| Non-allowlisted sign-in refused | not run | HUMAN step. |
| MCP tools listed with token | not run | Needs `MCP_TOKEN` and a deployed URL. |
| Onboard prompt | not run | HUMAN step 8. |
| Audit prompt | not run | HUMAN step 8. |
| Plan prompt | not run | HUMAN step 8. |
| Approve + work item | not run | HUMAN step 8. |
| AI Assets import (if done) | not run | Not attempted; needs owner confirmation (step 7). |

## What failed and what I did about it

Nothing failed. Earlier attempts to run step 1.3 were blocked because the Supabase variables were not in the agent
shell; the owner restarted the session with them exported. Pre-flight (set/unset only, values never read or printed):
all seven Supabase/allowlist variables SET; `ALLOW_AUTH_BYPASS` and `AUTH_BYPASS_EMAIL` unset, as required.

Note: the owner's credentials were echoed into the chat transcript earlier in the session (a PowerShell `$env:` paste
run through the Bash prefix). Recommend rotating the database password (Project Settings → Database) and the
service-role key (Project Settings → API) once the deploy works, then updating the Vercel variables.

## Follow-ups

- Step 3 (HUMAN): Google OAuth client, enable the provider in Supabase, URL configuration.
- Step 4 (HUMAN/AGENT): import the repo in Vercel; env vars need a Vercel login or `VERCEL_TOKEN` for the agent to set them.
- Steps 5 (sign-in check), 6.1, 7 and 8 need the owner.

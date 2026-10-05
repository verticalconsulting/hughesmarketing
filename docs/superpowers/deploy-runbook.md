# Deployment runbook: Supabase + Vercel + live Claude Desktop check

For an agent (Claude Code or dispatch) acting for the owner of this repo. Steps marked **[HUMAN]** need
the owner's own login or a consent screen: stop there, say exactly what to do, and wait. Steps marked
**[AGENT]** you can run yourself.

Repo: `https://github.com/verticalconsulting/hughesmarketing` · branch to deploy: `feat/marketing-workspace-v1`
Design: `docs/superpowers/specs/2026-10-02-marketing-workspace-design.md`

## Hard rules

1. **Never print, log, commit, or paste a secret** (database password, service-role key, OAuth client secret,
   MCP token). Pass secrets through environment variables or stdin. Never write them to a tracked file.
2. **Never set `ALLOW_AUTH_BYPASS` or `AUTH_BYPASS_EMAIL` on Vercel**, in any environment. It disables sign-in.
   `scripts/verify-deployment.ts` fails if it is active.
3. **Ask before anything that costs money or is hard to undo**: paid Supabase/Vercel plans, domains, deleting a
   project, resetting a database, force-pushing.
4. **Do not push to `main`** and do not force-push. Work on `feat/marketing-workspace-v1`.
5. If a command is denied by permissions, do not look for a way around it. Stop and report what you needed.
6. Record what you did and what failed (exact error text, no secrets) in
   `docs/superpowers/live-check-2026-10.md` using the template at the bottom.

## Values you will collect (keep them out of the repo)

| Name | Where it comes from | Used by |
|---|---|---|
| `SUPABASE_PROJECT_REF` | Supabase dashboard → Project Settings → General | CLI |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | Vercel, scripts |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` key | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key | Vercel, scripts |
| `DATABASE_URL` (runtime) | Connect → **Transaction pooler** URI (port 6543) | Vercel |
| `MIGRATE_DATABASE_URL` | Connect → **Session pooler** URI (port 5432) or Direct | one-time migrations |
| `ALLOWED_EMAILS` | Owner supplies, comma-separated Google emails | Vercel |

The database password is the one set when the Supabase project was created. If the owner has lost it, they
reset it in Project Settings → Database. That is **[HUMAN]** and breaks nothing else.

## 1. Supabase project

1. **[HUMAN]** Create a Supabase project (Free plan is fine to start). Choose a region near the owner.
   Save the database password in a password manager. Do not send it in chat.
2. **[HUMAN]** Give the agent the project URL, anon key, and service-role key through a secure channel
   (environment variables in the agent's shell, not chat), and the two connection URIs.
3. **[AGENT]** Create the private storage bucket (idempotent; fails loudly if the bucket exists and is public):

   ```bash
   NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
   SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
   pnpm tsx scripts/create-bucket.ts files
   ```

   Expected: `Created private bucket "files".` or `Bucket "files" already exists and is private.`

## 2. Database migrations

Run migrations over the **session pooler or direct** connection, not the transaction pooler (port 6543).
The transaction pooler is for the running app only.

```bash
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm db:migrate
```

Expected: `migrations applied successfully`. The second migration enables row-level security on every table and
seeds the "Five Hughes LLC" company and default scoring weights. Check:

```bash
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm tsx scripts/check-db.ts
```

Expected: three `PASS` lines (one company, one scoring row, row-level security on every table) and
`Database is ready.` If migrations or the check fail, stop and report the error. Do not drop tables.

## 3. Google sign-in

1. **[HUMAN]** Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → **Web application**.
   Authorized redirect URI: the callback URL shown in Supabase → Authentication → Providers → Google
   (looks like `https://<project-ref>.supabase.co/auth/v1/callback`). Copy the client ID and secret.
2. **[HUMAN]** Supabase → Authentication → Providers → Google: enable it and paste the client ID and secret.
3. **[HUMAN]** Supabase → Authentication → URL Configuration: set **Site URL** to the Vercel URL (step 4),
   and add `https://<vercel-url>/auth/callback` to **Redirect URLs**. Revisit this after step 4 gives the real URL.

Only emails in `ALLOWED_EMAILS` get in, even though anyone with a Google account can reach Google's sign-in.

## 4. Vercel project

1. **[HUMAN]** Vercel → Add New Project → import the GitHub repo → branch `feat/marketing-workspace-v1`.
   Framework preset: Next.js. Do not deploy yet if it asks.
2. **[AGENT or HUMAN]** Set environment variables for **Production and Preview**. Use the dashboard, or the CLI
   (`pnpm dlx vercel@latest env add NAME` reads the value from stdin; check `vercel env add --help` for the
   preview-branch syntax):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the **transaction pooler** URI (port 6543) |
   | `NEXT_PUBLIC_SUPABASE_URL` | project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key (mark **Sensitive**) |
   | `SUPABASE_STORAGE_BUCKET` | `files` |
   | `ALLOWED_EMAILS` | comma-separated emails |
   | `BLOB_DRIVER` | `supabase` |

   **Not set:** `ALLOW_AUTH_BYPASS`, `AUTH_BYPASS_EMAIL`. Confirm with `vercel env ls`.
3. **[HUMAN]** Trigger the deployment (push to the branch or click Deploy). Note the preview URL.
4. If the URL returns Vercel's own login (401) instead of the app, **Deployment Protection** is on. The owner
   can turn it off for previews (Project Settings → Deployment Protection) or supply a bypass token.
5. Go back to step 3.3 and set the real URL in Supabase.

## 5. Verify the deployment

```bash
pnpm tsx scripts/verify-deployment.ts https://<preview-url>
```

Expected, all `PASS`: login page public; workspace redirects to `/login` (bypass is off); `/api/mcp` returns 401
with no token and with a wrong token. Any `FAIL` stops the runbook. Report it verbatim.

**[HUMAN]** Sign in with an allowlisted Google account. Expected: the "Add your first brand" page.
Then sign in with an account that is *not* allowlisted. Expected: "That Google account isn't on the Five
Hughes team list." and no access.

## 6. Connect Claude Desktop

1. **[HUMAN]** In the app click **MCP**, name the token "Claude Desktop", and click Create token. The token is
   shown once. Copy the generated config into Claude Desktop (Settings → Developer → Edit Config) and restart it.
   Requires Node.js on that machine.
2. **[AGENT]** If given the token as an environment variable, check the authenticated path:

   ```bash
   MCP_TOKEN="$MCP_TOKEN" pnpm tsx scripts/verify-deployment.ts https://<preview-url>
   ```

   Expected: an extra `PASS  MCP endpoint lists all 17 tools with a valid token`.

## 7. Import the existing AI Assets (optional; ask the owner first)

This writes real client data to the production database and storage. Confirm, then run from the repo with the
production variables in the environment:

```bash
DATABASE_URL="$DATABASE_URL" NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" SUPABASE_STORAGE_BUCKET=files BLOB_DRIVER=supabase \
IMPORT_AS_EMAIL="<owner's allowlisted email>" \
pnpm tsx scripts/import-ai-assets.ts "C:/Users/ogDevOps/Google Drive Streaming/My Drive/AI Assets"
```

Expected (matches the local dry run): 7 brands, 237 files written, 6 audits, 4 plans, 7 integrations, no
`FAILED` lines, and `_Personal-Automations` skipped. Re-running is safe (idempotent).

## 8. Live check with Claude Desktop (**[HUMAN]** at the keyboard)

Use a throwaway brand so nothing real is touched. In the app: Add brand "Live Check" with a real test domain,
open the **Agent** tab, and paste these prompts into Claude Desktop one at a time:

1. **Onboard the brand.** Expect: onboarding answers saved; `BRAND.md` appears under Assets.
2. **Run an audit.** Expect: an `audits/…-full-audit.md` file; the Health score appears in the top bar.
3. **Build the plan.** Expect: the Plan tab shows the funnel and items; outward-facing items show "Needs approval".
4. In the app, **Approve** one item, then paste **Work the next plan item**. Expect: the item moves to Done and a
   tracker shows "measuring until …".

Record the outcome. For every failure, copy the exact error text.

## Rollback and cleanup

- Bad deploy: Vercel → Deployments → promote the previous deployment. Nothing in the database needs reverting.
- Revoke a leaked MCP token: app → MCP → Revoke.
- Rotate a leaked Supabase key: Project Settings → API. Then update the Vercel variable and redeploy.
- Delete the "Live Check" brand data only with the owner's explicit say-so.

## Results template: copy to `docs/superpowers/live-check-2026-10.md`

```markdown
# Live check — <date>

Deployed URL: <url>   Commit: <short sha>   Done by: <agent or person>

| Step | Result (pass/fail) | Notes or exact error |
|---|---|---|
| Bucket created | | |
| Migrations applied | | |
| verify-deployment.ts | | |
| Allowlisted sign-in | | |
| Non-allowlisted sign-in refused | | |
| MCP tools listed with token | | |
| Onboard prompt | | |
| Audit prompt | | |
| Plan prompt | | |
| Approve + work item | | |
| AI Assets import (if done) | | |

## What failed and what I did about it

## Follow-ups
```

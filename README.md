# Hughes Marketing Workspace

Internal workspace for Five Hughes LLC. Brands, audits, plans, trackers, and files live here; Claude Desktop or OpenClaw do the agent work through the MCP endpoint at `/api/mcp`.

Design: `docs/superpowers/specs/2026-10-02-marketing-workspace-design.md`

## Local development

1. Start Docker Desktop, then `pnpm dlx supabase start`.
2. `cp .env.example .env.local` and fill the anon and service-role keys printed by Supabase. Set `ALLOWED_EMAILS`. For local work set `ALLOW_AUTH_BYPASS=true` and `AUTH_BYPASS_EMAIL` to your email (never on Vercel; it is ignored there anyway).
3. `pnpm db:migrate`
4. `pnpm dev` → http://localhost:3000
5. Optional: `pnpm import:ai-assets "C:/Users/<you>/Google Drive Streaming/My Drive/AI Assets"`

## Tests

```bash
pnpm tsx scripts/create-test-db.ts && pnpm db:migrate:test   # once
pnpm test        # unit + integration
pnpm e2e         # Playwright (starts its own dev server on :3100)
```

## Production (Vercel + Supabase)

1. Create a Supabase project. Storage → new **private** bucket `files`.
2. Authentication → Providers → Google: create an OAuth client in Google Cloud (Web application), add the Supabase callback URL it shows, paste the client ID/secret. Authentication → URL Configuration: Site URL = your Vercel URL; add `https://<your-domain>/auth/callback` to Redirect URLs.
3. Run migrations against production: set `DATABASE_URL` to the Supabase **transaction pooler** URI (port 6543) in `.env.local` temporarily, then `pnpm db:migrate`.
4. Vercel → New Project from this repo. Environment variables: `DATABASE_URL` (pooler URI), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET=files`, `ALLOWED_EMAILS`, `BLOB_DRIVER=supabase`. Do **not** set `ALLOW_AUTH_BYPASS`.
5. Import existing work: point `.env.local` at production and run `pnpm import:ai-assets "<path to AI Assets>"`.

## Connecting an agent

Open the app → **MCP** → create a token → paste the generated config into Claude Desktop (Settings → Developer → Edit Config) and restart. For OpenClaw, add a Streamable HTTP MCP server with the endpoint URL and `Authorization: Bearer <token>`. The **Agent** tab has copyable prompts for each stage.

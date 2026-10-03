# Hughes Marketing Workspace v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal Next.js web app where the Five Hughes team manages client brands, and Claude Desktop / OpenClaw drive onboarding → audit → plan → execute → measure through a token-authenticated MCP server, with a 0–100 Health score and per-change KPI trackers proving impact.

**Architecture:** One Next.js 15 App Router app on Vercel. Pure business logic lives in `lib/domain` (no framework imports). All DB access goes through `lib/services` (Drizzle over Supabase Postgres; files in Supabase Storage behind a `BlobStore` interface). Both UI server actions and MCP tools call the same services. The MCP endpoint is `/api/mcp` via `mcp-handler`, authenticated with per-user bearer tokens.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM + `postgres`, Supabase (Postgres, Auth with Google, Storage), `mcp-handler` + `@modelcontextprotocol/sdk`, zod v3, react-markdown + remark-gfm + rehype-highlight + mermaid + yaml, Recharts, Vitest, Playwright, pnpm, tsx.

**Spec:** `docs/superpowers/specs/2026-10-02-marketing-workspace-design.md`

## Global Constraints

- Users: internal team only; Google sign-in restricted to `ALLOWED_EMAILS`; every signed-in user sees all brands.
- Scoring categories exactly: `ai_visibility`, `geo`, `seo`, `website_content`, `social`, `paid_ads`.
- Default weights: AI Visibility 20, GEO 15, SEO 20, Website & Content 20, Social 10, Paid Ads 15.
- `health = round(Σ(wᵢ·sᵢ)/Σ(wᵢ))` over present categories; `coverage = Σ(wᵢ present)/Σ(all wᵢ)`; coverage < 0.6 ⇒ partial (stored, excluded from trend and delta).
- Score bands: < 40 red, 40–69 amber, ≥ 70 green.
- Tracker threshold default 5 (%); verdict stays `pending` until `baseline_at + window_days` has passed and at least one check-in is on/after that date.
- Brand stages, in order: `onboarding` → `audited` → `planned` → `executing`; stages only move forward.
- Plan item statuses: `planned | active | needs_approval | approved | done | blocked | declined`. Agents (MCP) may only set `planned | active | done | blocked`. Approve/decline happens only in the UI.
- Every file write creates a new version; nothing is overwritten. `write_file` with `expected_version` fails on mismatch and returns the current version.
- `record_audit` and `create_plan_version` are idempotent by `request_id`.
- MCP tokens: 32 random bytes, stored as SHA-256 hash, shown once, revocable.
- Importer never imports `_Personal-Automations`, `_Duplicates-to-delete`, dot-files/dot-folders, or `desktop.ini`.
- Palette: primary `#4F46E5`, background `#FAFAF9`, white cards; funnel colors Acquisition blue, Activation teal, Retention violet, Referral amber, Revenue green; full dark mode.
- zod must be v3 (`zod@^3.25`) — the MCP SDK requires it.
- Node 24, pnpm 10. All commands below run from `D:\sources\hughes-marketing` in Git Bash.

## Review Focus

1. An agent retries `record_audit` / `create_plan_version` after a network timeout → the second call returns the first result with `duplicate: true` and creates nothing new. (Tests in Task 8 and Task 9.)
2. An agent passes a Windows-style or escaping path (`audits\\x.md`, `./a//b.md`, `../secrets.md`) → backslashes and slashes are normalized; any `..` segment is rejected with a validation error. (Tests in Task 2 and Task 7.)
3. A partial audit (only 1–2 categories) is recorded between full ones → the brand's displayed Health and delta still come from the full audits, not the partial. (Tests in Task 2 and Task 8.)
4. An agent uses a slightly wrong brand slug (`superthrift`) → not-found error lists close matches such as `superthriftdeals-org`. (Test in Task 6.)
5. A tracker whose baseline is 0 (e.g. 0 leads) gets a check-in of 3 → verdict uses absolute change and returns `positive` once the window has elapsed, without dividing by zero. (Test in Task 3.)

---

## File Structure

```
app/
  layout.tsx                         root layout, fonts, Toaster
  globals.css                        Tailwind v4 + palette tokens (light/dark)
  page.tsx                           redirect to first brand or empty state
  login/page.tsx                     Google sign-in
  auth/callback/route.ts             OAuth code exchange + allowlist
  actions/{brands,plans,files,integrations,tokens,auth}.ts   server actions
  api/[transport]/route.ts           MCP endpoint (/api/mcp)
  b/[slug]/layout.tsx                3-pane workspace shell
  b/[slug]/page.tsx                  redirect → plan
  b/[slug]/{plan,analytics,agent,briefs,calendar}/page.tsx
components/
  ui/*                               shadcn (generated)
  workspace/{top-bar,brand-switcher,add-brand-dialog,tab-nav,health-pill,stage-badge,
             sidebar,get-started,mcp-dialog,browser-dialog,copy-button,right-pane,
             assets-pane,file-tree,integrations-pane,skills-pane,placeholder}.tsx
  plan/{plan-header,health-card,channel-progress,funnel,where-you-stand,plan-items}.tsx
  analytics/{health-trend,category-trend,trackers-table}.tsx
  markdown/{markdown-view,mermaid}.tsx
lib/
  env.ts
  auth/{bypass,session,supabase-server}.ts
  domain/{scoring,verdict,questions,paths,text,content-type,funnel,integrations,
          front-matter,tree,dates,checklist}.ts (+ *.test.ts beside each)
  data/{schema,db}.ts
  storage/blob.ts
  services/{errors,actor,activity,users,brands,files,audits,plans,trackers,
            integrations,context,tokens}.ts
  mcp/{tools,register}.ts
  import/{parse-audit,parse-plan,parse-integrations,run-import}.ts (+ tests)
  prompts.ts
scripts/import-ai-assets.ts
middleware.ts
drizzle/                             generated SQL migrations
tests/
  helpers/{db,setup-integration}.ts
  integration/*.test.ts
  fixtures/ai-assets/**              small importer fixture
  e2e/{global-setup,workspace.spec}.ts
drizzle.config.ts  vitest.config.ts  playwright.config.ts  .env.example  .env.test
```

---

### Task 1: Scaffold the app and test tooling

**Files:**
- Create: Next.js app at repo root, `vitest.config.ts`, `.env.example`, `.env.test`, `lib/env.ts`, `lib/env.test.ts`
- Modify: `package.json` scripts, `.gitignore`

**Interfaces:**
- Produces: `getEnv(): Env` from `lib/env.ts` where `Env = { DATABASE_URL: string; NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; SUPABASE_STORAGE_BUCKET: string; ALLOWED_EMAILS: string[]; BLOB_DRIVER: "supabase" | "memory"; ALLOW_AUTH_BYPASS: boolean; AUTH_BYPASS_EMAIL?: string }`. Vitest projects `unit` and `integration`.

- [ ] **Step 1: Scaffold Next.js into a temp folder and move it up** (the repo already has `docs/`, which create-next-app refuses to overwrite)

```bash
cd /d/sources/hughes-marketing
pnpm create next-app@15 app-tmp --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --no-turbopack
ls -a app-tmp   # must NOT contain .git (create-next-app skips git init inside an existing repo)
shopt -s dotglob && mv app-tmp/* . && rmdir app-tmp && shopt -u dotglob
git log --oneline
```
Expected: `package.json`, `app/`, `next.config.ts`, `postcss.config.mjs` at repo root, and `git log` still shows the spec commit `1f8ca3c`. If `app-tmp` contained a `.git` folder, delete `app-tmp/.git` before the `mv`.

- [ ] **Step 2: Install dependencies**

```bash
pnpm add drizzle-orm postgres @supabase/ssr @supabase/supabase-js mcp-handler @modelcontextprotocol/sdk zod@^3.25 react-markdown remark-gfm rehype-highlight highlight.js mermaid yaml recharts lucide-react
pnpm add -D drizzle-kit vitest vite-tsconfig-paths @playwright/test tsx dotenv cross-env @types/node
pnpm exec playwright install chromium
```
Then run `pnpm view mcp-handler peerDependencies`; if it pins a specific `@modelcontextprotocol/sdk` version, install exactly that version (`pnpm add @modelcontextprotocol/sdk@<version>`).

- [ ] **Step 3: Initialize shadcn/ui and add components**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button card dialog dropdown-menu input label badge tabs scroll-area separator tooltip sonner textarea select progress resizable collapsible
```

- [ ] **Step 4: Write the failing env test** — `lib/env.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("parses allowlist, defaults, and booleans", () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://x",
      ALLOWED_EMAILS: " A@x.com, b@y.com ,",
      ALLOW_AUTH_BYPASS: "true",
    });
    expect(env.ALLOWED_EMAILS).toEqual(["a@x.com", "b@y.com"]);
    expect(env.BLOB_DRIVER).toBe("supabase");
    expect(env.SUPABASE_STORAGE_BUCKET).toBe("files");
    expect(env.ALLOW_AUTH_BYPASS).toBe(true);
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 5: Add Vitest config** — `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { loadEnv } from "vite";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    env: loadEnv("test", process.cwd(), ""),
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["lib/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          setupFiles: ["tests/helpers/setup-integration.ts"],
        },
      },
    ],
  },
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm vitest run --project unit lib/env.test.ts`
Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 7: Implement** — `lib/env.ts`

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("files"),
  ALLOWED_EMAILS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)),
  BLOB_DRIVER: z.enum(["supabase", "memory"]).default("supabase"),
  ALLOW_AUTH_BYPASS: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  AUTH_BYPASS_EMAIL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return result.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run --project unit lib/env.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Add env files, scripts, gitignore**

`.env.example`:
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=files
ALLOWED_EMAILS=you@example.com
BLOB_DRIVER=supabase
# Local development only — never set on Vercel:
ALLOW_AUTH_BYPASS=false
AUTH_BYPASS_EMAIL=
```

`.env.test`:
```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/hughes_test
SUPABASE_STORAGE_BUCKET=files
ALLOWED_EMAILS=e2e@test.local
BLOB_DRIVER=memory
ALLOW_AUTH_BYPASS=true
AUTH_BYPASS_EMAIL=e2e@test.local
```

Add to `package.json` `"scripts"` (keep the generated `dev`, `build`, `start`, `lint`):
```json
"test": "vitest run",
"test:unit": "vitest run --project unit",
"test:int": "vitest run --project integration",
"e2e": "playwright test",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:migrate:test": "cross-env ENV_FILE=.env.test drizzle-kit migrate",
"import:ai-assets": "tsx --env-file=.env.local scripts/import-ai-assets.ts"
```

Append to `.gitignore`:
```
.env.local
.env*.local
/test-results
/playwright-report
supabase/.temp
```

- [ ] **Step 10: Verify build and commit**

Run: `pnpm build`
Expected: build succeeds.

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest, Playwright, shadcn, env parsing"
```

---

### Task 2: Domain — scoring, paths, text helpers

**Files:**
- Create: `lib/domain/scoring.ts`, `lib/domain/paths.ts`, `lib/domain/text.ts`, `lib/domain/content-type.ts`, `lib/domain/funnel.ts`, `lib/domain/integrations.ts`
- Test: `lib/domain/scoring.test.ts`, `lib/domain/paths.test.ts`, `lib/domain/text.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES`, `type Category`, `CATEGORY_LABELS: Record<Category,string>`, `type Weights`, `DEFAULT_WEIGHTS`, `MIN_COVERAGE = 0.6`, `type CategoryScores = Partial<Record<Category, number>>`
  - `computeHealth(scores: CategoryScores, weights?: Weights): { health: number | null; coverage: number; partial: boolean }` — throws `RangeError` for scores outside 0–100 or non-finite
  - `isPartial(coverage: number): boolean`
  - `summarizeHealth(auditsNewestFirst: { health: number | null; coverage: number }[]): { health: number | null; delta: number | null }`
  - `type Band = "red" | "amber" | "green"`, `band(score: number): Band`
  - `normalizePath(p: string): string`, `class PathError extends Error`
  - `slugify(s: string): string`, `normalizeDomain(s: string): string`, `closeMatches(needle: string, haystack: string[], max?: number): string[]`, `colorForSlug(slug: string): string`
  - `guessContentType(path: string): string`, `isTextContentType(ct: string): boolean`
  - `FUNNEL_STAGES`, `type FunnelStage`, `FUNNEL_META: Record<FunnelStage, { label: string; hint: string; color: string }>`
  - `SERVICES`, `type Service`, `SERVICE_LABELS: Record<Service, string>`

- [ ] **Step 1: Write the failing scoring tests** — `lib/domain/scoring.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { band, computeHealth, DEFAULT_WEIGHTS, summarizeHealth } from "./scoring";

describe("computeHealth", () => {
  it("computes the weighted average over all six categories", () => {
    // SuperThrift 2026-09-29: 20, 86, 49, 41, 0, 75
    const r = computeHealth({ ai_visibility: 20, geo: 86, seo: 49, website_content: 41, social: 0, paid_ads: 75 });
    // (20*20 + 86*15 + 49*20 + 41*20 + 0*10 + 75*15) / 100 = 46.15
    expect(r).toEqual({ health: 46, coverage: 1, partial: false });
  });

  it("renormalizes weights when categories are missing", () => {
    const r = computeHealth({ ai_visibility: 50, seo: 70, website_content: 90, geo: 60 });
    // weights 20+20+20+15 = 75 → (1000+1400+1800+900)/75 = 68
    expect(r.health).toBe(68);
    expect(r.coverage).toBeCloseTo(0.75);
    expect(r.partial).toBe(false);
  });

  it("marks low coverage as partial but still computes a number", () => {
    const r = computeHealth({ social: 10, paid_ads: 90 });
    expect(r.coverage).toBeCloseTo(0.25);
    expect(r.partial).toBe(true);
    expect(r.health).toBe(58); // (100 + 1350) / 25
  });

  it("returns null health when nothing is scored", () => {
    expect(computeHealth({})).toEqual({ health: null, coverage: 0, partial: true });
  });

  it("rejects out-of-range scores", () => {
    expect(() => computeHealth({ seo: 101 })).toThrow(RangeError);
    expect(() => computeHealth({ seo: -1 })).toThrow(RangeError);
    expect(() => computeHealth({ seo: Number.NaN })).toThrow(RangeError);
  });

  it("uses custom weights", () => {
    const r = computeHealth({ seo: 100, geo: 0 }, { ...DEFAULT_WEIGHTS, seo: 1, geo: 1 });
    expect(r.health).toBe(50);
  });
});

describe("summarizeHealth", () => {
  it("uses the latest full audit and the previous full audit for delta", () => {
    expect(summarizeHealth([{ health: 53, coverage: 1 }, { health: 51, coverage: 1 }])).toEqual({ health: 53, delta: 2 });
  });

  it("skips partial audits for both health and delta", () => {
    const r = summarizeHealth([
      { health: 10, coverage: 0.2 },
      { health: 60, coverage: 1 },
      { health: 30, coverage: 0.3 },
      { health: 55, coverage: 0.9 },
    ]);
    expect(r).toEqual({ health: 60, delta: 5 });
  });

  it("returns null delta with a single full audit and nulls with none", () => {
    expect(summarizeHealth([{ health: 40, coverage: 1 }])).toEqual({ health: 40, delta: null });
    expect(summarizeHealth([])).toEqual({ health: null, delta: null });
  });
});

describe("band", () => {
  it("maps score bands", () => {
    expect(band(39)).toBe("red");
    expect(band(40)).toBe("amber");
    expect(band(69)).toBe("amber");
    expect(band(70)).toBe("green");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/domain/scoring.test.ts`
Expected: FAIL — cannot resolve `./scoring`.

- [ ] **Step 3: Implement** — `lib/domain/scoring.ts`

```ts
export const CATEGORIES = ["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ai_visibility: "AI Visibility",
  geo: "GEO",
  seo: "SEO",
  website_content: "Website & Content",
  social: "Social Media",
  paid_ads: "Paid Ads",
};

export type Weights = Record<Category, number>;
export const DEFAULT_WEIGHTS: Weights = {
  ai_visibility: 20,
  geo: 15,
  seo: 20,
  website_content: 20,
  social: 10,
  paid_ads: 15,
};

export const MIN_COVERAGE = 0.6;
export type CategoryScores = Partial<Record<Category, number>>;

export function isPartial(coverage: number): boolean {
  return coverage < MIN_COVERAGE;
}

export function computeHealth(
  scores: CategoryScores,
  weights: Weights = DEFAULT_WEIGHTS,
): { health: number | null; coverage: number; partial: boolean } {
  const total = CATEGORIES.reduce((sum, c) => sum + weights[c], 0);
  let weighted = 0;
  let present = 0;
  for (const c of CATEGORIES) {
    const s = scores[c];
    if (s === undefined) continue;
    if (!Number.isFinite(s) || s < 0 || s > 100) {
      throw new RangeError(`Score for ${c} must be between 0 and 100 (got ${s})`);
    }
    weighted += weights[c] * s;
    present += weights[c];
  }
  const coverage = total === 0 ? 0 : present / total;
  if (present === 0) return { health: null, coverage: 0, partial: true };
  return { health: Math.round(weighted / present), coverage, partial: isPartial(coverage) };
}

export function summarizeHealth(
  auditsNewestFirst: { health: number | null; coverage: number }[],
): { health: number | null; delta: number | null } {
  const full = auditsNewestFirst.filter((a) => a.health !== null && !isPartial(a.coverage));
  const latest = full[0]?.health ?? null;
  const previous = full[1]?.health ?? null;
  return { health: latest, delta: latest !== null && previous !== null ? latest - previous : null };
}

export type Band = "red" | "amber" | "green";
export function band(score: number): Band {
  if (score < 40) return "red";
  if (score < 70) return "amber";
  return "green";
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit lib/domain/scoring.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Write the failing path and text tests**

`lib/domain/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { normalizePath, PathError } from "./paths";

describe("normalizePath", () => {
  it("normalizes separators and redundant segments", () => {
    expect(normalizePath("audits\\2026-09-29-full-audit.md")).toBe("audits/2026-09-29-full-audit.md");
    expect(normalizePath("./deliverables//brief.md")).toBe("deliverables/brief.md");
    expect(normalizePath("/skills/ads/SKILL.md ")).toBe("skills/ads/SKILL.md");
    expect(normalizePath("a/./b.md")).toBe("a/b.md");
  });

  it("rejects traversal and empty paths", () => {
    expect(() => normalizePath("../secrets.md")).toThrow(PathError);
    expect(() => normalizePath("audits/../../x.md")).toThrow(PathError);
    expect(() => normalizePath("   ")).toThrow(PathError);
    expect(() => normalizePath("folder/")).toThrow(PathError);
  });
});
```

`lib/domain/text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { closeMatches, colorForSlug, normalizeDomain, slugify } from "./text";

describe("text helpers", () => {
  it("slugifies names and folder names", () => {
    expect(slugify("Superthriftdeals.org")).toBe("superthriftdeals-org");
    expect(slugify("Mercy House — Vehicle Donation!")).toBe("mercy-house-vehicle-donation");
    expect(slugify("  ")).toBe("");
  });

  it("normalizes domains", () => {
    expect(normalizeDomain("https://www.MidStateWelding.com/about/")).toBe("www.midstatewelding.com");
    expect(normalizeDomain("superthriftdeals.org")).toBe("superthriftdeals.org");
  });

  it("finds close slug matches", () => {
    const all = ["superthriftdeals-org", "roofcoms-com", "myelitegutters-com"];
    expect(closeMatches("superthrift", all)).toEqual(["superthriftdeals-org"]);
    expect(closeMatches("roofcom-com", all)).toContain("roofcoms-com");
    expect(closeMatches("zzz", all)).toEqual([]);
  });

  it("assigns a stable color per slug", () => {
    expect(colorForSlug("a")).toBe(colorForSlug("a"));
    expect(colorForSlug("a")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm vitest run --project unit lib/domain/paths.test.ts lib/domain/text.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 7: Implement paths, text, content-type, funnel, integrations**

`lib/domain/paths.ts`:
```ts
export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export function normalizePath(p: string): string {
  const trimmed = p.trim().replace(/\\/g, "/");
  if (trimmed.endsWith("/")) throw new PathError(`Path must name a file, not a folder: "${p}"`);
  const parts: string[] = [];
  for (const seg of trimmed.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new PathError(`Path may not contain "..": "${p}"`);
    parts.push(seg);
  }
  if (parts.length === 0) throw new PathError("Path is empty");
  return parts.join("/");
}
```

`lib/domain/text.ts`:
```ts
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeDomain(s: string): string {
  const withoutProto = s.trim().toLowerCase().replace(/^[a-z]+:\/\//, "");
  return withoutProto.split(/[/?#]/)[0];
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function closeMatches(needle: string, haystack: string[], max = 3): string[] {
  const n = needle.toLowerCase();
  return haystack
    .map((h) => ({ h, d: h.includes(n) || n.includes(h) ? 0 : levenshtein(n, h) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.h);
}

const AVATAR_COLORS = ["#4f46e5", "#0ea5e9", "#14b8a6", "#8b5cf6", "#f59e0b", "#22c55e", "#ec4899", "#ef4444"];
export function colorForSlug(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
```

`lib/domain/content-type.ts`:
```ts
const TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  jsonl: "application/x-ndjson",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
};

export function guessContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export function isTextContentType(ct: string): boolean {
  return ct.startsWith("text/") || ct === "application/json" || ct === "application/x-ndjson";
}
```

`lib/domain/funnel.ts`:
```ts
export const FUNNEL_STAGES = ["acquisition", "activation", "retention", "referral", "revenue"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_META: Record<FunnelStage, { label: string; hint: string; color: string }> = {
  acquisition: { label: "Acquisition", hint: "Get found", color: "var(--funnel-acquisition)" },
  activation: { label: "Activation", hint: "First value", color: "var(--funnel-activation)" },
  retention: { label: "Retention", hint: "Keep them", color: "var(--funnel-retention)" },
  referral: { label: "Referral", hint: "Word of mouth", color: "var(--funnel-referral)" },
  revenue: { label: "Revenue", hint: "Monetize", color: "var(--funnel-revenue)" },
};
```

`lib/domain/integrations.ts`:
```ts
export const SERVICES = [
  "ga4",
  "gsc",
  "google_ads",
  "github",
  "facebook",
  "google_business_profile",
  "formspree",
  "wordpress",
  "wix",
  "other",
] as const;
export type Service = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<Service, string> = {
  ga4: "Google Analytics 4",
  gsc: "Google Search Console",
  google_ads: "Google Ads",
  github: "GitHub",
  facebook: "Facebook",
  google_business_profile: "Google Business Profile",
  formspree: "Formspree",
  wordpress: "WordPress",
  wix: "Wix",
  other: "Other",
};
```

- [ ] **Step 8: Run to verify pass**

Run: `pnpm test:unit`
Expected: PASS (all unit tests).

- [ ] **Step 9: Commit**

```bash
git add lib/domain
git commit -m "feat(domain): health scoring, path normalization, text and catalog helpers"
```

---

### Task 3: Domain — tracker verdicts

**Files:**
- Create: `lib/domain/verdict.ts`
- Test: `lib/domain/verdict.test.ts`

**Interfaces:**
- Produces: `type Direction = "up" | "down"`, `type Verdict = "pending" | "positive" | "neutral" | "negative"`, `DEFAULT_THRESHOLD_PCT = 5`,
  `computeVerdict(t: { baselineValue: number; baselineAt: Date; direction: Direction; windowDays: number; thresholdPct: number }, checkins: { value: number; observedAt: Date }[], now: Date): { verdict: Verdict; latest: number | null; changePct: number | null; changeAbs: number | null; windowEndsAt: Date }`

- [ ] **Step 1: Write the failing tests** — `lib/domain/verdict.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeVerdict } from "./verdict";

const day = 24 * 60 * 60 * 1000;
const baselineAt = new Date("2026-09-01T00:00:00Z");
const base = { baselineValue: 100, baselineAt, direction: "up" as const, windowDays: 30, thresholdPct: 5 };
const after = (days: number) => new Date(baselineAt.getTime() + days * day);

describe("computeVerdict", () => {
  it("is pending with no check-ins", () => {
    const r = computeVerdict(base, [], after(60));
    expect(r.verdict).toBe("pending");
    expect(r.latest).toBeNull();
    expect(r.windowEndsAt).toEqual(after(30));
  });

  it("is pending while the window is open, but reports change", () => {
    const r = computeVerdict(base, [{ value: 130, observedAt: after(10) }], after(10));
    expect(r.verdict).toBe("pending");
    expect(r.changePct).toBe(30);
  });

  it("is pending after the window if no check-in falls after it", () => {
    const r = computeVerdict(base, [{ value: 130, observedAt: after(10) }], after(45));
    expect(r.verdict).toBe("pending");
  });

  it("is positive when the change meets the threshold after the window", () => {
    const r = computeVerdict(base, [{ value: 105, observedAt: after(31) }], after(31));
    expect(r).toMatchObject({ verdict: "positive", latest: 105, changePct: 5, changeAbs: 5 });
  });

  it("is neutral inside the threshold and negative below it", () => {
    expect(computeVerdict(base, [{ value: 103, observedAt: after(30) }], after(30)).verdict).toBe("neutral");
    expect(computeVerdict(base, [{ value: 90, observedAt: after(30) }], after(30)).verdict).toBe("negative");
  });

  it("uses the most recent check-in", () => {
    const r = computeVerdict(
      base,
      [
        { value: 80, observedAt: after(35) },
        { value: 120, observedAt: after(40) },
        { value: 50, observedAt: after(5) },
      ],
      after(41),
    );
    expect(r.latest).toBe(120);
    expect(r.verdict).toBe("positive");
  });

  it("flips the sign when lower is better", () => {
    const cpa = { ...base, direction: "down" as const };
    expect(computeVerdict(cpa, [{ value: 80, observedAt: after(31) }], after(31)).verdict).toBe("positive");
    expect(computeVerdict(cpa, [{ value: 120, observedAt: after(31) }], after(31)).verdict).toBe("negative");
  });

  it("uses absolute change when the baseline is zero", () => {
    const zero = { ...base, baselineValue: 0 };
    const r = computeVerdict(zero, [{ value: 3, observedAt: after(31) }], after(31));
    expect(r).toMatchObject({ verdict: "positive", changePct: null, changeAbs: 3 });
    expect(computeVerdict(zero, [{ value: 0.5, observedAt: after(31) }], after(31)).verdict).toBe("neutral");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/domain/verdict.test.ts`
Expected: FAIL — cannot resolve `./verdict`.

- [ ] **Step 3: Implement** — `lib/domain/verdict.ts`

```ts
export type Direction = "up" | "down";
export type Verdict = "pending" | "positive" | "neutral" | "negative";
export const DEFAULT_THRESHOLD_PCT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeVerdict(
  t: { baselineValue: number; baselineAt: Date; direction: Direction; windowDays: number; thresholdPct: number },
  checkins: { value: number; observedAt: Date }[],
  now: Date,
): { verdict: Verdict; latest: number | null; changePct: number | null; changeAbs: number | null; windowEndsAt: Date } {
  const windowEndsAt = new Date(t.baselineAt.getTime() + t.windowDays * DAY_MS);
  if (checkins.length === 0) {
    return { verdict: "pending", latest: null, changePct: null, changeAbs: null, windowEndsAt };
  }
  const sorted = [...checkins].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  const latestCheckin = sorted[0];
  const latest = latestCheckin.value;
  const changeAbs = latest - t.baselineValue;
  const changePct = t.baselineValue === 0 ? null : (changeAbs / Math.abs(t.baselineValue)) * 100;
  const sign = t.direction === "up" ? 1 : -1;

  const windowElapsed = now.getTime() >= windowEndsAt.getTime();
  const hasLateCheckin = latestCheckin.observedAt.getTime() >= windowEndsAt.getTime();
  if (!windowElapsed || !hasLateCheckin) {
    return { verdict: "pending", latest, changePct, changeAbs, windowEndsAt };
  }

  let verdict: Verdict;
  if (changePct === null) {
    const signed = sign * changeAbs;
    verdict = signed >= 1 ? "positive" : signed <= -1 ? "negative" : "neutral";
  } else {
    const signed = sign * changePct;
    verdict = signed >= t.thresholdPct ? "positive" : signed <= -t.thresholdPct ? "negative" : "neutral";
  }
  return { verdict, latest, changePct, changeAbs, windowEndsAt };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit lib/domain/verdict.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/verdict.ts lib/domain/verdict.test.ts
git commit -m "feat(domain): tracker verdict computation"
```

---

### Task 4: Domain — questions, front matter, file tree, recency, checklist

**Files:**
- Create: `lib/domain/questions.ts`, `lib/domain/front-matter.ts`, `lib/domain/tree.ts`, `lib/domain/dates.ts`, `lib/domain/checklist.ts`
- Test: `lib/domain/questions.test.ts`, `lib/domain/front-matter.test.ts`, `lib/domain/tree.test.ts`, `lib/domain/dates.test.ts`, `lib/domain/checklist.test.ts`

**Interfaces:**
- Produces:
  - `interface Question { key: string; prompt: string; kind: "text" | "number" | "choice" | "list"; options?: string[] }`
  - `ONBOARDING_QUESTIONS: Question[]`, `PLAN_QUESTIONS: Question[]`
  - `isAnswered(v: unknown): boolean`
  - `missingOnboardingQuestions(answers: Record<string, unknown>): Question[]`
  - `missingPlanQuestions(answers: Record<string, unknown>): Question[]` (answers = onboarding answers merged with plan answers)
  - `splitFrontMatter(src: string): { data: Record<string, unknown> | null; body: string }`
  - `interface TreeNode { name: string; path: string; children?: TreeNode[] }`, `buildTree(paths: string[]): TreeNode[]` (folders first, then files, alphabetical)
  - `groupByRecency<T extends { createdAt: Date }>(items: T[], now: Date): { today: T[]; last7: T[]; last14: T[]; older: T[] }`
  - `gettingStarted(s: { onboardingMissing: number; auditCount: number; hasPlan: boolean; doneItems: number; decidedVerdicts: number }): { key: string; label: string; done: boolean }[]`

- [ ] **Step 1: Write the failing tests**

`lib/domain/questions.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isAnswered, missingOnboardingQuestions, missingPlanQuestions, ONBOARDING_QUESTIONS } from "./questions";

describe("questions", () => {
  it("treats empty values as unanswered", () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered("  ")).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(["x"])).toBe(true);
  });

  it("returns all onboarding questions for a new brand and none when complete", () => {
    expect(missingOnboardingQuestions({})).toHaveLength(ONBOARDING_QUESTIONS.length);
    const all = Object.fromEntries(ONBOARDING_QUESTIONS.map((q) => [q.key, q.kind === "list" ? ["x"] : "x"]));
    expect(missingOnboardingQuestions(all)).toEqual([]);
  });

  it("skips plan questions already answered during onboarding", () => {
    const keys = missingPlanQuestions({ primary_goal: "leads", monthly_budget: 500 }).map((q) => q.key);
    expect(keys).not.toContain("primary_goal");
    expect(keys).not.toContain("monthly_budget");
    expect(keys).toContain("primary_channel");
    expect(keys).toContain("timeline_horizon");
  });
});
```

`lib/domain/front-matter.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { splitFrontMatter } from "./front-matter";

describe("splitFrontMatter", () => {
  it("parses YAML front matter including flow mappings", () => {
    const src = '---\nname: ads-monitor\nmetadata: { "openclaw": { "emoji": "📡" } }\n---\n\n# Body';
    const r = splitFrontMatter(src);
    expect(r.data).toEqual({ name: "ads-monitor", metadata: { openclaw: { emoji: "📡" } } });
    expect(r.body.trim()).toBe("# Body");
  });

  it("handles CRLF and missing front matter", () => {
    expect(splitFrontMatter("---\r\nname: x\r\n---\r\nhi").data).toEqual({ name: "x" });
    expect(splitFrontMatter("# Just text")).toEqual({ data: null, body: "# Just text" });
  });

  it("returns the original text when YAML is invalid", () => {
    const src = "---\nname: [unclosed\n---\nbody";
    expect(splitFrontMatter(src)).toEqual({ data: null, body: src });
  });
});
```

`lib/domain/tree.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildTree } from "./tree";

describe("buildTree", () => {
  it("nests paths with folders before files", () => {
    const tree = buildTree(["PLAN.md", "audits/b.md", "audits/a.md", "BRAND.md", "workflows/x/SKILL.md"]);
    expect(tree.map((n) => n.name)).toEqual(["audits", "workflows", "BRAND.md", "PLAN.md"]);
    expect(tree[0].children?.map((n) => n.path)).toEqual(["audits/a.md", "audits/b.md"]);
    expect(tree[1].children?.[0]).toMatchObject({ name: "x", path: "workflows/x" });
    expect(tree[1].children?.[0].children?.[0]).toEqual({ name: "SKILL.md", path: "workflows/x/SKILL.md" });
  });
});
```

`lib/domain/dates.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupByRecency } from "./dates";

describe("groupByRecency", () => {
  it("buckets by age", () => {
    const now = new Date("2026-10-02T15:00:00Z");
    const at = (iso: string) => ({ createdAt: new Date(iso) });
    const g = groupByRecency(
      [at("2026-10-02T01:00:00Z"), at("2026-09-28T12:00:00Z"), at("2026-09-20T12:00:00Z"), at("2026-08-01T00:00:00Z")],
      now,
    );
    expect([g.today.length, g.last7.length, g.last14.length, g.older.length]).toEqual([1, 1, 1, 1]);
  });
});
```

`lib/domain/checklist.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { gettingStarted } from "./checklist";

describe("gettingStarted", () => {
  it("marks steps done from brand state", () => {
    const steps = gettingStarted({ onboardingMissing: 0, auditCount: 1, hasPlan: false, doneItems: 0, decidedVerdicts: 0 });
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["brand", true],
      ["onboarding", true],
      ["audit", true],
      ["plan", false],
      ["execute", false],
      ["measure", false],
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/domain`
Expected: FAIL — the five new modules are not found.

- [ ] **Step 3: Implement**

`lib/domain/questions.ts`:
```ts
export interface Question {
  key: string;
  prompt: string;
  kind: "text" | "number" | "choice" | "list";
  options?: string[];
}

export const ONBOARDING_QUESTIONS: Question[] = [
  { key: "business_offer", prompt: "What does the business sell or offer, in one or two sentences?", kind: "text" },
  { key: "primary_audience", prompt: "Who is the primary audience or ideal customer?", kind: "text" },
  { key: "service_locations", prompt: "Which cities, regions, or areas does it serve?", kind: "list" },
  { key: "primary_goal", prompt: "What is the primary goal?", kind: "choice", options: ["leads", "sales", "signups", "donations"] },
  { key: "current_channels", prompt: "Which marketing channels are active today?", kind: "list" },
  { key: "monthly_budget", prompt: "What is the monthly marketing budget in USD (0 if none)?", kind: "number" },
  { key: "weekly_hours", prompt: "How many hours per week can the team spend?", kind: "number" },
  { key: "competitors", prompt: "Who are the top competitors (names or URLs)?", kind: "list" },
  { key: "brand_voice", prompt: "How should the brand sound? Anything to avoid?", kind: "text" },
  { key: "approval_rules", prompt: "What needs approval before going live (publishing, ad spend, site changes)?", kind: "text" },
  { key: "website_platform", prompt: "What platform runs the website (WordPress, Wix, Next.js, etc.)?", kind: "text" },
];

export const PLAN_QUESTIONS: Question[] = [
  { key: "primary_goal", prompt: "What is the primary goal for this plan?", kind: "choice", options: ["leads", "sales", "signups", "donations"] },
  { key: "primary_channel", prompt: "Which channel should be the primary focus?", kind: "choice", options: ["AI visibility", "SEO", "GEO", "Paid ads", "Social", "Website & content", "Email"] },
  { key: "secondary_channels", prompt: "Which secondary channels should support it?", kind: "list" },
  { key: "monthly_budget", prompt: "What monthly budget (USD) can the plan use?", kind: "number" },
  { key: "timeline_horizon", prompt: "What timeline should the plan cover?", kind: "choice", options: ["90_day", "6_month", "12_month", "ongoing"] },
  { key: "risk_tolerance", prompt: "How much risk is acceptable for experiments?", kind: "choice", options: ["low", "medium", "high"] },
  { key: "constraints", prompt: "Any constraints (seasonality, legal, staffing, brand rules)?", kind: "text" },
];

export function isAnswered(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function missingOnboardingQuestions(answers: Record<string, unknown>): Question[] {
  return ONBOARDING_QUESTIONS.filter((q) => !isAnswered(answers[q.key]));
}

export function missingPlanQuestions(answers: Record<string, unknown>): Question[] {
  return PLAN_QUESTIONS.filter((q) => !isAnswered(answers[q.key]));
}
```

`lib/domain/front-matter.ts`:
```ts
import { parse } from "yaml";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontMatter(src: string): { data: Record<string, unknown> | null; body: string } {
  const m = FM.exec(src);
  if (!m) return { data: null, body: src };
  try {
    const data = parse(m[1]);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { data: null, body: src };
    return { data: data as Record<string, unknown>, body: src.slice(m[0].length) };
  } catch {
    return { data: null, body: src };
  }
}
```

`lib/domain/tree.ts`:
```ts
export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      node.children ??= [];
      let child = node.children.find((c) => c.name === part && (isFile ? !c.children : !!c.children));
      if (!child) {
        child = isFile ? { name: part, path: childPath } : { name: part, path: childPath, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => (a.children ? 0 : 1) - (b.children ? 0 : 1) || a.name.localeCompare(b.name))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children ?? []);
}
```

`lib/domain/dates.ts`:
```ts
const DAY = 24 * 60 * 60 * 1000;

export function groupByRecency<T extends { createdAt: Date }>(items: T[], now: Date) {
  // UTC day boundaries keep results identical on Vercel and on dev machines.
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const groups = { today: [] as T[], last7: [] as T[], last14: [] as T[], older: [] as T[] };
  for (const item of items) {
    const t = item.createdAt.getTime();
    if (t >= startOfToday.getTime()) groups.today.push(item);
    else if (t >= startOfToday.getTime() - 7 * DAY) groups.last7.push(item);
    else if (t >= startOfToday.getTime() - 14 * DAY) groups.last14.push(item);
    else groups.older.push(item);
  }
  return groups;
}
```

`lib/domain/checklist.ts`:
```ts
export function gettingStarted(s: {
  onboardingMissing: number;
  auditCount: number;
  hasPlan: boolean;
  doneItems: number;
  decidedVerdicts: number;
}) {
  return [
    { key: "brand", label: "Add the brand", done: true },
    { key: "onboarding", label: "Answer onboarding questions", done: s.onboardingMissing === 0 },
    { key: "audit", label: "Run the first audit", done: s.auditCount > 0 },
    { key: "plan", label: "Build the marketing plan", done: s.hasPlan },
    { key: "execute", label: "Complete a plan item", done: s.doneItems > 0 },
    { key: "measure", label: "Get a tracker verdict", done: s.decidedVerdicts > 0 },
  ];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/domain
git commit -m "feat(domain): questions, front matter, file tree, recency, checklist"
```

### Task 5: Database schema, migrations, local Supabase, test DB

**Files:**
- Create: `lib/data/schema.ts`, `lib/data/db.ts`, `drizzle.config.ts`, `drizzle/*` (generated), `supabase/config.toml` (generated, then edited), `scripts/create-test-db.ts`, `tests/helpers/db.ts`, `tests/helpers/setup-integration.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `users, apiTokens, companies, brands, files, fileVersions, audits, auditScores, plans, planItems, planItemFiles, trackers, trackerCheckins, integrations, activities, scoringConfig`; enums `stageEnum, funnelEnum, itemStatusEnum, planStatusEnum, directionEnum, verdictEnum, integrationStatusEnum, activityKindEnum`; `db`, `sql`, `type Db`, `type Tx`, `type DbOrTx` from `lib/data/db.ts`; test helpers `resetDb(): Promise<void>` and `createTestUser(email?: string): Promise<Actor>` (the `Actor` type is created in Task 6 — in this task `createTestUser` returns `{ kind: "user"; userId: string; label: string }` inline; Task 6 switches it to the imported type).

- [ ] **Step 1: Start local Supabase**

Docker Desktop must be running.
```bash
pnpm dlx supabase init
```
Append to `supabase/config.toml`:
```toml
[storage.buckets.files]
public = false
file_size_limit = "50MiB"
```
```bash
pnpm dlx supabase start
```
Expected: prints `API URL: http://127.0.0.1:54321`, `DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `anon key`, `service_role key`. Copy `.env.example` to `.env.local` and fill `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from that output; set `ALLOWED_EMAILS` to your Google email; for local dev set `ALLOW_AUTH_BYPASS=true` and `AUTH_BYPASS_EMAIL` to the same email.

- [ ] **Step 2: Write the schema** — `lib/data/schema.ts`

```ts
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const stageEnum = pgEnum("brand_stage", ["onboarding", "audited", "planned", "executing"]);
export const funnelEnum = pgEnum("funnel_stage", ["acquisition", "activation", "retention", "referral", "revenue"]);
export const itemStatusEnum = pgEnum("plan_item_status", [
  "planned",
  "active",
  "needs_approval",
  "approved",
  "done",
  "blocked",
  "declined",
]);
export const planStatusEnum = pgEnum("plan_status", ["active", "archived"]);
export const directionEnum = pgEnum("kpi_direction", ["up", "down"]);
export const verdictEnum = pgEnum("verdict", ["pending", "positive", "neutral", "negative"]);
export const integrationStatusEnum = pgEnum("integration_status", ["connected", "not_connected", "error"]);
export const activityKindEnum = pgEnum("activity_kind", [
  "brand",
  "chat",
  "workflow",
  "audit",
  "plan",
  "approval",
  "file",
  "tracker",
  "integration",
]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const apiTokens = pgTable("api_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps,
});

export const brands = pgTable("brands", {
  id: id(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  domain: text("domain"),
  stage: stageEnum("stage").notNull().default("onboarding"),
  onboarding: jsonb("onboarding").$type<Record<string, unknown>>().notNull().default({}),
  color: text("color").notNull(),
  ...timestamps,
});

export const files = pgTable(
  "files",
  {
    id: id(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    currentVersion: integer("current_version").notNull(),
    ...timestamps,
  },
  (t) => [unique("files_brand_path").on(t.brandId, t.path).nullsNotDistinct()],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: id(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    size: integer("size").notNull(),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("file_versions_file_version").on(t.fileId, t.version)],
);

export const audits = pgTable("audits", {
  id: id(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  auditedAt: timestamp("audited_at", { withTimezone: true }).notNull(),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  health: integer("health"),
  coverage: real("coverage").notNull(),
  requestId: text("request_id").unique(),
  ...timestamps,
});

export const auditScores = pgTable("audit_scores", {
  id: id(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => audits.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  score: integer("score").notNull(),
  target: integer("target"),
  evidence: text("evidence"),
});

export const plans = pgTable("plans", {
  id: id(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: planStatusEnum("status").notNull().default("active"),
  objective: text("objective").notNull(),
  primaryChannel: text("primary_channel"),
  secondaryChannels: text("secondary_channels").array().notNull().default([]),
  monthlyBudget: real("monthly_budget"),
  weeklyHours: real("weekly_hours"),
  timeline: text("timeline"),
  summary: text("summary"),
  sourceAuditId: uuid("source_audit_id").references(() => audits.id, { onDelete: "set null" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  requestId: text("request_id").unique(),
  ...timestamps,
});

export const planItems = pgTable("plan_items", {
  id: id(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  funnelStage: funnelEnum("funnel_stage").notNull(),
  channel: text("channel"),
  priority: integer("priority").notNull().default(100),
  status: itemStatusEnum("status").notNull(),
  expectedKpi: text("expected_kpi"),
  needsApproval: boolean("needs_approval").notNull().default(false),
  approvalNote: text("approval_note"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  ...timestamps,
});

export const planItemFiles = pgTable(
  "plan_item_files",
  {
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planItemId, t.fileId] })],
);

export const trackers = pgTable("trackers", {
  id: id(),
  planItemId: uuid("plan_item_id")
    .notNull()
    .unique()
    .references(() => planItems.id, { onDelete: "cascade" }),
  kpi: text("kpi").notNull(),
  unit: text("unit"),
  direction: directionEnum("direction").notNull(),
  baselineValue: real("baseline_value").notNull(),
  baselineAt: timestamp("baseline_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  windowDays: integer("window_days").notNull(),
  thresholdPct: real("threshold_pct").notNull().default(5),
  verdict: verdictEnum("verdict").notNull().default("pending"),
  verdictAt: timestamp("verdict_at", { withTimezone: true }),
  changePct: real("change_pct"),
  ...timestamps,
});

export const trackerCheckins = pgTable("tracker_checkins", {
  id: id(),
  trackerId: uuid("tracker_id")
    .notNull()
    .references(() => trackers.id, { onDelete: "cascade" }),
  value: real("value").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    status: integrationStatusEnum("status").notNull(),
    identifiers: jsonb("identifiers").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("integrations_brand_service").on(t.brandId, t.service)],
);

export const activities = pgTable("activities", {
  id: id(),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  actorKind: text("actor_kind").notNull(),
  actorLabel: text("actor_label").notNull(),
  kind: activityKindEnum("kind").notNull(),
  summary: text("summary").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scoringConfig = pgTable("scoring_config", {
  id: id(),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  ...timestamps,
});
```

- [ ] **Step 3: Write the DB client** — `lib/data/db.ts`

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __hmSql?: ReturnType<typeof postgres> };

// prepare:false is required for Supabase's transaction-mode pooler.
export const sql =
  globalForDb.__hmSql ?? postgres(process.env.DATABASE_URL ?? "", { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.__hmSql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
```

- [ ] **Step 4: Write drizzle config, generate migrations, add RLS + seed migration**

`drizzle.config.ts`:
```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: process.env.ENV_FILE ?? ".env.local" });

export default defineConfig({
  schema: "./lib/data/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

```bash
pnpm db:generate
pnpm drizzle-kit generate --custom --name=rls_and_seed
```
Replace the body of the generated `drizzle/0001_rls_and_seed.sql` with:
```sql
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_item_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trackers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracker_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scoring_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "companies" ("name") SELECT 'Five Hughes LLC' WHERE NOT EXISTS (SELECT 1 FROM "companies");--> statement-breakpoint
INSERT INTO "scoring_config" ("weights") SELECT '{"ai_visibility":20,"geo":15,"seo":20,"website_content":20,"social":10,"paid_ads":15}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM "scoring_config");
```
RLS with no policies denies the Supabase `anon`/`authenticated` API roles; the app connects as `postgres` through `DATABASE_URL`, which bypasses RLS.

- [ ] **Step 5: Create and migrate the test database** — `scripts/create-test-db.ts`

```ts
import postgres from "postgres";

const target = new URL(process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/hughes_test");
const dbName = target.pathname.slice(1);
const admin = new URL(target);
admin.pathname = "/postgres";

const sql = postgres(admin.toString(), { max: 1 });
const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
if (rows.length === 0) {
  await sql.unsafe(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database ${dbName}`);
} else {
  console.log(`Database ${dbName} already exists`);
}
await sql.end();
```
```bash
pnpm tsx scripts/create-test-db.ts
pnpm db:migrate
pnpm db:migrate:test
```
Expected: `Created database hughes_test`; both migrate commands report migrations applied.

- [ ] **Step 6: Write test helpers**

`tests/helpers/db.ts`:
```ts
import { db, sql } from "@/lib/data/db";
import { users } from "@/lib/data/schema";

export async function resetDb(): Promise<void> {
  await sql`TRUNCATE activities, tracker_checkins, trackers, plan_item_files, plan_items, plans,
    audit_scores, audits, file_versions, files, integrations, brands, api_tokens, users,
    companies, scoring_config RESTART IDENTITY CASCADE`;
  await sql`INSERT INTO companies (name) VALUES ('Five Hughes LLC')`;
  await sql`INSERT INTO scoring_config (weights) VALUES (${sql.json({
    ai_visibility: 20,
    geo: 15,
    seo: 20,
    website_content: 20,
    social: 10,
    paid_ads: 15,
  })})`;
}

export async function createTestUser(email = "tester@test.local") {
  const [u] = await db.insert(users).values({ email, name: "Tester" }).returning();
  return { kind: "user" as const, userId: u.id, label: email };
}
```

`tests/helpers/setup-integration.ts`:
```ts
import { afterAll, beforeEach } from "vitest";
import { sql } from "@/lib/data/db";
import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await sql.end();
});
```

- [ ] **Step 7: Write the failing schema test** — `tests/integration/schema.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { db } from "@/lib/data/db";
import { brands, companies, files } from "@/lib/data/schema";

describe("schema", () => {
  it("enforces one shared file per path even though brand_id is null", async () => {
    await db.insert(files).values({ brandId: null, path: "skills/a/SKILL.md", contentType: "text/markdown", size: 1, currentVersion: 1 });
    await expect(
      db.insert(files).values({ brandId: null, path: "skills/a/SKILL.md", contentType: "text/markdown", size: 1, currentVersion: 1 }),
    ).rejects.toThrow();
  });

  it("allows the same path under different brands", async () => {
    const [company] = await db.select().from(companies);
    const [a, b] = await db
      .insert(brands)
      .values([
        { companyId: company.id, name: "A", slug: "a", color: "#000000" },
        { companyId: company.id, name: "B", slug: "b", color: "#000000" },
      ])
      .returning();
    await db.insert(files).values([
      { brandId: a.id, path: "BRAND.md", contentType: "text/markdown", size: 1, currentVersion: 1 },
      { brandId: b.id, path: "BRAND.md", contentType: "text/markdown", size: 1, currentVersion: 1 },
    ]);
    expect(await db.select().from(files)).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Run integration tests**

Run: `pnpm test:int`
Expected: PASS (2 tests). If the first test does not reject, the generated migration is missing `NULLS NOT DISTINCT` — check `drizzle/0000_*.sql` and upgrade `drizzle-orm`/`drizzle-kit` until it appears.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(data): Drizzle schema, migrations with RLS and seed, test DB helpers"
```

---

### Task 6: Core services — errors, actor, activity, users, brands

**Files:**
- Create: `lib/services/errors.ts`, `lib/services/actor.ts`, `lib/services/activity.ts`, `lib/services/users.ts`, `lib/services/brands.ts`
- Modify: `tests/helpers/db.ts` (type `createTestUser` as `Promise<Actor>`)
- Test: `tests/integration/brands.test.ts`

**Interfaces:**
- Consumes: `slugify`, `normalizeDomain`, `closeMatches`, `colorForSlug` (Task 2); `missingOnboardingQuestions` (Task 4); `summarizeHealth` (Task 2); schema (Task 5).
- Produces:
  - `class DomainError extends Error { code: string; details: Record<string, unknown> }`; `NotFoundError(message, suggestions?)`; `ConflictError(message, details?)`; `ValidationError(message, field?)`; `ApprovalError(message)`
  - `type Actor = { kind: "user" | "token"; userId: string; label: string }`
  - `type ActivityKind` (enum values); `logActivity(input: { brandId?: string | null; actor: Actor; kind: ActivityKind; summary: string; refType?: string; refId?: string }, tx?: DbOrTx): Promise<void>`; `listActivity(opts: { brandId?: string | null; limit?: number }): Promise<ActivityRow[]>` where `ActivityRow = typeof activities.$inferSelect`
  - `isAllowedEmail(email: string): boolean`; `upsertUserByEmail(input: { email: string; name?: string | null; avatarUrl?: string | null }): Promise<SessionUser>` where `SessionUser = { id: string; email: string; name: string | null; avatarUrl: string | null }`
  - `type Stage`, `STAGE_ORDER`; `type Brand = typeof brands.$inferSelect`; `type BrandSummary = { id; name; slug; domain: string | null; stage: Stage; color: string; health: number | null; delta: number | null; latestAuditAt: Date | null }`
  - `createBrand(input: { name: string; slug?: string; domain?: string | null; actor: Actor }): Promise<Brand>`; `getBrandBySlug(slug: string): Promise<Brand>`; `ensureBrand(input: { name: string; slug: string; domain?: string | null; actor: Actor }): Promise<Brand>`; `listBrands(): Promise<BrandSummary[]>`; `saveOnboarding(slug: string, answers: Record<string, unknown>, actor: Actor): Promise<{ brand: Brand; missing: string[] }>`; `advanceStage(brandId: string, target: Stage, tx?: DbOrTx): Promise<void>`

- [ ] **Step 1: Write the failing tests** — `tests/integration/brands.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { advanceStage, createBrand, getBrandBySlug, listBrands, saveOnboarding } from "@/lib/services/brands";
import { listActivity } from "@/lib/services/activity";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";

describe("brands service", () => {
  it("creates a brand with slug, normalized domain, color, and an activity entry", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "SuperThrift", domain: "https://superthriftdeals.org/", actor });
    expect(b).toMatchObject({ slug: "superthrift", domain: "superthriftdeals.org", stage: "onboarding" });
    expect(b.color).toMatch(/^#/);
    const acts = await listActivity({ brandId: b.id });
    expect(acts[0]).toMatchObject({ kind: "brand", summary: "Added brand SuperThrift" });
  });

  it("rejects empty names and duplicate slugs", async () => {
    const actor = await createTestUser();
    await expect(createBrand({ name: "  ", actor })).rejects.toBeInstanceOf(ValidationError);
    await createBrand({ name: "Roof Co", actor });
    await expect(createBrand({ name: "roof co", actor })).rejects.toBeInstanceOf(ConflictError);
  });

  it("suggests close slugs when a brand is not found", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "SuperThrift", slug: "superthriftdeals-org", actor });
    const err = await getBrandBySlug("superthrift").catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.details.suggestions).toEqual(["superthriftdeals-org"]);
  });

  it("merges onboarding answers and reports what is still missing", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Elite Gutters", actor });
    await saveOnboarding("elite-gutters", { primary_goal: "leads" }, actor);
    const r = await saveOnboarding("elite-gutters", { monthly_budget: 500 }, actor);
    expect(r.brand.onboarding).toEqual({ primary_goal: "leads", monthly_budget: 500 });
    expect(r.missing).not.toContain("primary_goal");
    expect(r.missing).toContain("business_offer");
  });

  it("only advances stages forward", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Mid-State Welding", actor });
    await advanceStage(b.id, "planned");
    await advanceStage(b.id, "audited");
    expect((await getBrandBySlug("mid-state-welding")).stage).toBe("planned");
  });

  it("lists brands with null health before any audit", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    expect(await listBrands()).toEqual([
      expect.objectContaining({ slug: "roof-co", health: null, delta: null, latestAuditAt: null }),
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/brands.test.ts`
Expected: FAIL — services not found.

- [ ] **Step 3: Implement errors and actor**

`lib/services/errors.ts`:
```ts
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, suggestions: string[] = []) {
    super("not_found", message, { suggestions });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super("conflict", message, details);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, field?: string) {
    super("validation", message, field ? { field } : {});
  }
}

export class ApprovalError extends DomainError {
  constructor(message: string) {
    super("approval_required", message);
  }
}
```

`lib/services/actor.ts`:
```ts
export type Actor = { kind: "user" | "token"; userId: string; label: string };
```

- [ ] **Step 4: Implement activity and users**

`lib/services/activity.ts`:
```ts
import { desc, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { activities, activityKindEnum } from "@/lib/data/schema";
import type { Actor } from "./actor";

export type ActivityKind = (typeof activityKindEnum.enumValues)[number];
export type ActivityRow = typeof activities.$inferSelect;

export async function logActivity(
  input: { brandId?: string | null; actor: Actor; kind: ActivityKind; summary: string; refType?: string; refId?: string },
  tx: DbOrTx = db,
): Promise<void> {
  await tx.insert(activities).values({
    brandId: input.brandId ?? null,
    actorKind: input.actor.kind,
    actorLabel: input.actor.label,
    kind: input.kind,
    summary: input.summary,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
  });
}

export async function listActivity(opts: { brandId?: string | null; limit?: number }): Promise<ActivityRow[]> {
  const where =
    opts.brandId === undefined ? undefined : opts.brandId === null ? isNull(activities.brandId) : eq(activities.brandId, opts.brandId);
  return db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(opts.limit ?? 100);
}
```

`lib/services/users.ts`:
```ts
import { getEnv } from "@/lib/env";
import { db } from "@/lib/data/db";
import { users } from "@/lib/data/schema";

export type SessionUser = { id: string; email: string; name: string | null; avatarUrl: string | null };

export function isAllowedEmail(email: string): boolean {
  return getEnv().ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export async function upsertUserByEmail(input: {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const [u] = await db
    .insert(users)
    .values({ email, name: input.name ?? null, avatarUrl: input.avatarUrl ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: input.name ?? null, avatarUrl: input.avatarUrl ?? null },
    })
    .returning();
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl };
}
```

- [ ] **Step 5: Implement brands** — `lib/services/brands.ts`

```ts
import { desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { audits, brands, companies } from "@/lib/data/schema";
import { missingOnboardingQuestions } from "@/lib/domain/questions";
import { summarizeHealth } from "@/lib/domain/scoring";
import { closeMatches, colorForSlug, normalizeDomain, slugify } from "@/lib/domain/text";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export const STAGE_ORDER = ["onboarding", "audited", "planned", "executing"] as const;
export type Stage = (typeof STAGE_ORDER)[number];
export type Brand = typeof brands.$inferSelect;
export type BrandSummary = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  stage: Stage;
  color: string;
  health: number | null;
  delta: number | null;
  latestAuditAt: Date | null;
};

export async function createBrand(input: { name: string; slug?: string; domain?: string | null; actor: Actor }): Promise<Brand> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Brand name is required", "name");
  const slug = slugify(input.slug ?? name);
  if (!slug) throw new ValidationError("Brand name must contain letters or numbers", "name");
  const [company] = await db.select().from(companies).limit(1);
  if (!company) throw new NotFoundError("No company is configured; run the database migrations");
  const existing = await db.query.brands.findFirst({ where: eq(brands.slug, slug) });
  if (existing) throw new ConflictError(`Brand "${slug}" already exists`, { slug });
  const [brand] = await db
    .insert(brands)
    .values({
      companyId: company.id,
      name,
      slug,
      domain: input.domain ? normalizeDomain(input.domain) : null,
      color: colorForSlug(slug),
    })
    .returning();
  await logActivity({ brandId: brand.id, actor: input.actor, kind: "brand", summary: `Added brand ${name}`, refType: "brand", refId: brand.id });
  return brand;
}

export async function getBrandBySlug(slug: string): Promise<Brand> {
  const brand = await db.query.brands.findFirst({ where: eq(brands.slug, slug) });
  if (brand) return brand;
  const all = await db.select({ slug: brands.slug }).from(brands);
  throw new NotFoundError(`Brand "${slug}" not found`, closeMatches(slug, all.map((b) => b.slug)));
}

export async function ensureBrand(input: { name: string; slug: string; domain?: string | null; actor: Actor }): Promise<Brand> {
  const existing = await db.query.brands.findFirst({ where: eq(brands.slug, slugify(input.slug)) });
  return existing ?? createBrand(input);
}

export async function listBrands(): Promise<BrandSummary[]> {
  const rows = await db.select().from(brands).orderBy(brands.name);
  return Promise.all(
    rows.map(async (b) => {
      const list = await db
        .select({ health: audits.health, coverage: audits.coverage, auditedAt: audits.auditedAt })
        .from(audits)
        .where(eq(audits.brandId, b.id))
        .orderBy(desc(audits.auditedAt));
      const { health, delta } = summarizeHealth(list);
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        domain: b.domain,
        stage: b.stage,
        color: b.color,
        health,
        delta,
        latestAuditAt: list[0]?.auditedAt ?? null,
      };
    }),
  );
}

export async function saveOnboarding(
  slug: string,
  answers: Record<string, unknown>,
  actor: Actor,
): Promise<{ brand: Brand; missing: string[] }> {
  const brand = await getBrandBySlug(slug);
  const merged = { ...brand.onboarding, ...answers };
  const [updated] = await db.update(brands).set({ onboarding: merged }).where(eq(brands.id, brand.id)).returning();
  await logActivity({
    brandId: brand.id,
    actor,
    kind: "brand",
    summary: `Saved onboarding answers: ${Object.keys(answers).join(", ")}`,
  });
  return { brand: updated, missing: missingOnboardingQuestions(merged).map((q) => q.key) };
}

export async function advanceStage(brandId: string, target: Stage, tx: DbOrTx = db): Promise<void> {
  const [b] = await tx.select({ stage: brands.stage }).from(brands).where(eq(brands.id, brandId));
  if (!b) throw new NotFoundError(`Brand ${brandId} not found`);
  if (STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(b.stage)) {
    await tx.update(brands).set({ stage: target }).where(eq(brands.id, brandId));
  }
}
```

- [ ] **Step 6: Type the test helper** — in `tests/helpers/db.ts` add `import type { Actor } from "@/lib/services/actor";` and change the signature to `export async function createTestUser(email = "tester@test.local"): Promise<Actor>`.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm vitest run --project integration tests/integration/brands.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add lib/services tests
git commit -m "feat(services): errors, activity log, users, brands with stage progression"
```

---

### Task 7: Blob storage and the files service

**Files:**
- Create: `lib/storage/blob.ts`, `lib/services/files.ts`
- Modify: `tests/helpers/setup-integration.ts` (reset memory blob store)
- Test: `tests/integration/files.test.ts`

**Interfaces:**
- Consumes: `normalizePath`, `PathError` (Task 2); `guessContentType`, `isTextContentType` (Task 2); `logActivity`, errors, `Actor` (Task 6).
- Produces:
  - `interface BlobStore { put(key: string, data: Uint8Array, contentType: string): Promise<void>; get(key: string): Promise<Uint8Array>; signedUrl(key: string, seconds: number): Promise<string> }`; `getBlobStore(): BlobStore`; `resetMemoryBlobStore(): void`
  - `type FileInfo = { path: string; version: number; size: number; contentType: string; updatedAt: Date }`
  - `writeFile(input: { brandId: string | null; path: string; content: string | Uint8Array; contentType?: string; expectedVersion?: number; actor: Actor; quiet?: boolean }): Promise<{ fileId: string; path: string; version: number; unchanged: boolean }>` — identical content to the current version returns `unchanged: true` without creating a version
  - `readFile(input: { brandId: string | null; path: string; version?: number }): Promise<{ fileId: string; path: string; version: number; contentType: string; size: number; bytes: Uint8Array; text: string | null }>`
  - `listFiles(input: { brandId: string | null; prefix?: string }): Promise<FileInfo[]>`
  - `listVersions(input: { brandId: string | null; path: string }): Promise<{ version: number; author: string; size: number; createdAt: Date }[]>`
  - `fileDownloadUrl(input: { brandId: string | null; path: string; version?: number }): Promise<string>`
  - `findFileId(brandId: string | null, path: string, tx?: DbOrTx): Promise<string>` (throws `NotFoundError`)

- [ ] **Step 1: Write the failing tests** — `tests/integration/files.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { listFiles, listVersions, readFile, writeFile } from "@/lib/services/files";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/services/errors";

describe("files service", () => {
  it("writes, reads, and versions a brand file", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const v1 = await writeFile({ brandId: b.id, path: "BRAND.md", content: "# v1", actor });
    const v2 = await writeFile({ brandId: b.id, path: "BRAND.md", content: "# v2", actor });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect((await readFile({ brandId: b.id, path: "BRAND.md" })).text).toBe("# v2");
    expect((await readFile({ brandId: b.id, path: "BRAND.md", version: 1 })).text).toBe("# v1");
    expect((await listVersions({ brandId: b.id, path: "BRAND.md" })).map((v) => v.version)).toEqual([2, 1]);
  });

  it("skips identical content without creating a version", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "skills/a/SKILL.md", content: "same", actor });
    const again = await writeFile({ brandId: null, path: "skills/a/SKILL.md", content: "same", actor });
    expect(again).toMatchObject({ version: 1, unchanged: true });
  });

  it("rejects a stale expected_version and reports the current version", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "a", actor });
    await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "b", actor });
    const err = await writeFile({ brandId: null, path: "workspace/AGENTS.md", content: "c", expectedVersion: 1, actor }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.details.currentVersion).toBe(2);
  });

  it("normalizes Windows paths and rejects traversal", async () => {
    const actor = await createTestUser();
    const r = await writeFile({ brandId: null, path: "skills\\b\\SKILL.md", content: "x", actor });
    expect(r.path).toBe("skills/b/SKILL.md");
    await expect(writeFile({ brandId: null, path: "../x.md", content: "x", actor })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps brand and shared scopes separate and lists by prefix", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await writeFile({ brandId: b.id, path: "audits/2026-09-08-full-audit.md", content: "a", actor });
    await writeFile({ brandId: b.id, path: "PLAN.md", content: "p", actor });
    await writeFile({ brandId: null, path: "PLAN.md", content: "shared", actor });
    expect((await listFiles({ brandId: b.id, prefix: "audits/" })).map((f) => f.path)).toEqual(["audits/2026-09-08-full-audit.md"]);
    expect((await readFile({ brandId: null, path: "PLAN.md" })).text).toBe("shared");
  });

  it("returns binary files without text and suggests paths when missing", async () => {
    const actor = await createTestUser();
    await writeFile({ brandId: null, path: "data/x.xlsx", content: new Uint8Array([1, 2, 3]), actor });
    const f = await readFile({ brandId: null, path: "data/x.xlsx" });
    expect(f.text).toBeNull();
    expect(Array.from(f.bytes)).toEqual([1, 2, 3]);
    const err = await readFile({ brandId: null, path: "data/y.xlsx" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.details.suggestions).toContain("data/x.xlsx");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/files.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the blob store** — `lib/storage/blob.ts`

```ts
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, seconds: number): Promise<string>;
}

const memory = new Map<string, { data: Uint8Array; contentType: string }>();

class MemoryBlobStore implements BlobStore {
  async put(key: string, data: Uint8Array, contentType: string) {
    memory.set(key, { data: new Uint8Array(data), contentType });
  }
  async get(key: string) {
    const v = memory.get(key);
    if (!v) throw new Error(`Blob not found: ${key}`);
    return v.data;
  }
  async signedUrl(key: string) {
    return `memory://${encodeURIComponent(key)}`;
  }
}

class SupabaseBlobStore implements BlobStore {
  private client = createClient(getEnv().NEXT_PUBLIC_SUPABASE_URL ?? "", getEnv().SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false },
  });
  private bucket = getEnv().SUPABASE_STORAGE_BUCKET;

  async put(key: string, data: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Storage download failed for ${key}: ${error?.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  async signedUrl(key: string, seconds: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, seconds);
    if (error || !data) throw new Error(`Signed URL failed for ${key}: ${error?.message}`);
    return data.signedUrl;
  }
}

let store: BlobStore | undefined;
export function getBlobStore(): BlobStore {
  store ??= getEnv().BLOB_DRIVER === "memory" ? new MemoryBlobStore() : new SupabaseBlobStore();
  return store;
}

export function resetMemoryBlobStore(): void {
  memory.clear();
}
```

- [ ] **Step 4: Implement the files service** — `lib/services/files.ts`

```ts
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { files, fileVersions } from "@/lib/data/schema";
import { guessContentType, isTextContentType } from "@/lib/domain/content-type";
import { normalizePath, PathError } from "@/lib/domain/paths";
import { closeMatches } from "@/lib/domain/text";
import { getBlobStore } from "@/lib/storage/blob";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export type FileInfo = { path: string; version: number; size: number; contentType: string; updatedAt: Date };

const scope = (brandId: string | null) => (brandId ? eq(files.brandId, brandId) : isNull(files.brandId));

function safePath(p: string): string {
  try {
    return normalizePath(p);
  } catch (e) {
    if (e instanceof PathError) throw new ValidationError(e.message, "path");
    throw e;
  }
}

function storageKey(brandId: string | null, path: string, version: number): string {
  return `${brandId ?? "shared"}/v${version}/${path}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function notFound(brandId: string | null, path: string): Promise<never> {
  const all = await db.select({ path: files.path }).from(files).where(scope(brandId));
  throw new NotFoundError(`File "${path}" not found`, closeMatches(path, all.map((f) => f.path)));
}

export async function findFileId(brandId: string | null, path: string, tx: DbOrTx = db): Promise<string> {
  const p = safePath(path);
  const [f] = await tx.select({ id: files.id }).from(files).where(and(scope(brandId), eq(files.path, p)));
  if (!f) return notFound(brandId, p);
  return f.id;
}

export async function writeFile(input: {
  brandId: string | null;
  path: string;
  content: string | Uint8Array;
  contentType?: string;
  expectedVersion?: number;
  actor: Actor;
  quiet?: boolean;
}): Promise<{ fileId: string; path: string; version: number; unchanged: boolean }> {
  const path = safePath(input.path);
  const bytes = typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
  const contentType = input.contentType ?? guessContentType(path);
  const blob = getBlobStore();

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(files).where(and(scope(input.brandId), eq(files.path, path))).for("update");
    const current = existing?.currentVersion ?? 0;
    if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
      throw new ConflictError(`Version mismatch for ${path}: expected ${input.expectedVersion}, current is ${current}`, {
        path,
        currentVersion: current,
      });
    }
    if (existing) {
      const [cur] = await tx
        .select({ storageKey: fileVersions.storageKey })
        .from(fileVersions)
        .where(and(eq(fileVersions.fileId, existing.id), eq(fileVersions.version, current)));
      if (cur && sameBytes(await blob.get(cur.storageKey), bytes)) {
        return { fileId: existing.id, path, version: current, unchanged: true };
      }
    }

    const version = current + 1;
    const key = storageKey(input.brandId, path, version);
    await blob.put(key, bytes, contentType);

    let fileId: string;
    if (existing) {
      await tx.update(files).set({ currentVersion: version, size: bytes.length, contentType }).where(eq(files.id, existing.id));
      fileId = existing.id;
    } else {
      const [created] = await tx
        .insert(files)
        .values({ brandId: input.brandId, path, contentType, size: bytes.length, currentVersion: version })
        .returning({ id: files.id });
      fileId = created.id;
    }
    await tx.insert(fileVersions).values({ fileId, version, storageKey: key, size: bytes.length, author: input.actor.label });
    if (!input.quiet) {
      await logActivity(
        { brandId: input.brandId, actor: input.actor, kind: "file", summary: `Wrote ${path} (v${version})`, refType: "file", refId: fileId },
        tx,
      );
    }
    return { fileId, path, version, unchanged: false };
  });
}

export async function readFile(input: { brandId: string | null; path: string; version?: number }) {
  const path = safePath(input.path);
  const [f] = await db.select().from(files).where(and(scope(input.brandId), eq(files.path, path)));
  if (!f) return notFound(input.brandId, path);
  const version = input.version ?? f.currentVersion;
  const [v] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, f.id), eq(fileVersions.version, version)));
  if (!v) throw new NotFoundError(`Version ${version} of "${path}" not found`);
  const bytes = await getBlobStore().get(v.storageKey);
  return {
    fileId: f.id,
    path,
    version,
    contentType: f.contentType,
    size: v.size,
    bytes,
    text: isTextContentType(f.contentType) ? new TextDecoder().decode(bytes) : null,
  };
}

export async function listFiles(input: { brandId: string | null; prefix?: string }): Promise<FileInfo[]> {
  const prefix = input.prefix ? input.prefix.replace(/\\/g, "/").replace(/^\/+/, "") : "";
  const rows = await db
    .select()
    .from(files)
    .where(prefix ? and(scope(input.brandId), like(files.path, `${prefix.replace(/[%_]/g, "\\$&")}%`)) : scope(input.brandId))
    .orderBy(files.path);
  return rows.map((r) => ({ path: r.path, version: r.currentVersion, size: r.size, contentType: r.contentType, updatedAt: r.updatedAt }));
}

export async function listVersions(input: { brandId: string | null; path: string }) {
  const fileId = await findFileId(input.brandId, input.path);
  return db
    .select({ version: fileVersions.version, author: fileVersions.author, size: fileVersions.size, createdAt: fileVersions.createdAt })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.version));
}

export async function fileDownloadUrl(input: { brandId: string | null; path: string; version?: number }): Promise<string> {
  const fileId = await findFileId(input.brandId, input.path);
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  const version = input.version ?? f.currentVersion;
  const [v] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.version, version)));
  if (!v) throw new NotFoundError(`Version ${version} of "${input.path}" not found`);
  return getBlobStore().signedUrl(v.storageKey, 300);
}
```

- [ ] **Step 5: Reset the memory store between tests** — `tests/helpers/setup-integration.ts`

```ts
import { afterAll, beforeEach } from "vitest";
import { sql } from "@/lib/data/db";
import { resetMemoryBlobStore } from "@/lib/storage/blob";
import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
  resetMemoryBlobStore();
});

afterAll(async () => {
  await sql.end();
});
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm test:int`
Expected: PASS (all integration tests so far).

- [ ] **Step 7: Commit**

```bash
git add lib/storage lib/services/files.ts tests
git commit -m "feat(files): versioned file storage with optimistic concurrency and blob abstraction"
```

### Task 8: Audits service

**Files:**
- Create: `lib/services/audits.ts`
- Test: `tests/integration/audits.test.ts`

**Interfaces:**
- Consumes: `computeHealth`, `summarizeHealth`, `isPartial`, `CATEGORIES`, `DEFAULT_WEIGHTS`, `Category`, `Weights` (Task 2); `getBrandBySlug`, `advanceStage` (Task 6); `findFileId` (Task 7).
- Produces:
  - `type AuditScoreInput = { category: Category; score: number; target?: number | null; evidence?: string | null }`
  - `type RecordAuditResult = { auditId: string; health: number | null; coverage: number; partial: boolean; delta: number | null; duplicate: boolean }`
  - `recordAudit(input: { brandSlug: string; auditedAt?: Date; reportPath?: string; scores: AuditScoreInput[]; requestId?: string; actor: Actor }): Promise<RecordAuditResult>`
  - `type AuditWithScores = { id: string; auditedAt: Date; health: number | null; coverage: number; partial: boolean; reportPath: string | null; scores: { category: string; score: number; target: number | null; evidence: string | null }[] }`
  - `listAudits(brandId: string): Promise<AuditWithScores[]>` (newest first)
  - `getWeights(): Promise<Weights>`

- [ ] **Step 1: Write the failing tests** — `tests/integration/audits.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { listAudits, recordAudit } from "@/lib/services/audits";
import { createBrand, getBrandBySlug, listBrands } from "@/lib/services/brands";
import { writeFile } from "@/lib/services/files";
import { NotFoundError, ValidationError } from "@/lib/services/errors";

const full = (n: number) =>
  (["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"] as const).map((category) => ({ category, score: n }));

describe("audits service", () => {
  it("records an audit, computes health, links the report, and advances the stage", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await writeFile({ brandId: b.id, path: "audits/2026-09-08-full-audit.md", content: "# Audit", actor });
    const r = await recordAudit({
      brandSlug: "roof-co",
      auditedAt: new Date("2026-09-08T00:00:00Z"),
      reportPath: "audits/2026-09-08-full-audit.md",
      scores: [{ category: "seo", score: 50, target: 80, evidence: "Ranks for 2 of 10" }, ...full(50).slice(0, 5).filter((s) => s.category !== "seo")],
      actor,
    });
    expect(r).toMatchObject({ health: 50, partial: false, delta: null, duplicate: false });
    expect((await getBrandBySlug("roof-co")).stage).toBe("audited");
    const [a] = await listAudits(b.id);
    expect(a.reportPath).toBe("audits/2026-09-08-full-audit.md");
    expect(a.scores.find((s) => s.category === "seo")).toMatchObject({ score: 50, target: 80, evidence: "Ranks for 2 of 10" });
  });

  it("computes delta against the previous full audit and ignores partial ones", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await recordAudit({ brandSlug: "roof-co", auditedAt: new Date("2026-09-01"), scores: full(40), actor });
    const partial = await recordAudit({
      brandSlug: "roof-co",
      auditedAt: new Date("2026-09-10"),
      scores: [{ category: "social", score: 5 }],
      actor,
    });
    expect(partial).toMatchObject({ partial: true, delta: null });
    const second = await recordAudit({ brandSlug: "roof-co", auditedAt: new Date("2026-09-20"), scores: full(55), actor });
    expect(second.delta).toBe(15);
    const [summary] = await listBrands();
    expect(summary).toMatchObject({ health: 55, delta: 15 });
  });

  it("is idempotent by request id", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const first = await recordAudit({ brandSlug: "roof-co", scores: full(60), requestId: "req-1", actor });
    const retry = await recordAudit({ brandSlug: "roof-co", scores: full(10), requestId: "req-1", actor });
    expect(retry).toMatchObject({ auditId: first.auditId, health: 60, duplicate: true });
    expect(await listAudits(b.id)).toHaveLength(1);
  });

  it("validates input", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await expect(recordAudit({ brandSlug: "roof-co", scores: [], actor })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 120 }], actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 1 }, { category: "seo", score: 2 }], actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordAudit({ brandSlug: "roof-co", reportPath: "audits/missing.md", scores: full(1), actor }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/audits.test.ts`
Expected: FAIL — `@/lib/services/audits` not found.

- [ ] **Step 3: Implement** — `lib/services/audits.ts`

```ts
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { audits, auditScores, files, scoringConfig } from "@/lib/data/schema";
import {
  CATEGORIES,
  computeHealth,
  DEFAULT_WEIGHTS,
  isPartial,
  summarizeHealth,
  type Category,
  type CategoryScores,
  type Weights,
} from "@/lib/domain/scoring";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { advanceStage, getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";
import { findFileId } from "./files";

export type AuditScoreInput = { category: Category; score: number; target?: number | null; evidence?: string | null };
export type RecordAuditResult = {
  auditId: string;
  health: number | null;
  coverage: number;
  partial: boolean;
  delta: number | null;
  duplicate: boolean;
};
export type AuditWithScores = {
  id: string;
  auditedAt: Date;
  health: number | null;
  coverage: number;
  partial: boolean;
  reportPath: string | null;
  scores: { category: string; score: number; target: number | null; evidence: string | null }[];
};

export async function getWeights(): Promise<Weights> {
  const [row] = await db.select().from(scoringConfig).limit(1);
  if (!row) return DEFAULT_WEIGHTS;
  return { ...DEFAULT_WEIGHTS, ...(row.weights as Partial<Weights>) };
}

async function deltaFor(brandId: string, auditId: string): Promise<number | null> {
  const list = await db
    .select({ id: audits.id, health: audits.health, coverage: audits.coverage })
    .from(audits)
    .where(eq(audits.brandId, brandId))
    .orderBy(desc(audits.auditedAt), desc(audits.createdAt));
  const idx = list.findIndex((a) => a.id === auditId);
  if (idx < 0 || isPartial(list[idx].coverage)) return null;
  return summarizeHealth(list.slice(idx)).delta;
}

export async function recordAudit(input: {
  brandSlug: string;
  auditedAt?: Date;
  reportPath?: string;
  scores: AuditScoreInput[];
  requestId?: string;
  actor: Actor;
}): Promise<RecordAuditResult> {
  const brand = await getBrandBySlug(input.brandSlug);

  if (input.requestId) {
    const [prior] = await db.select().from(audits).where(eq(audits.requestId, input.requestId));
    if (prior) {
      return {
        auditId: prior.id,
        health: prior.health,
        coverage: prior.coverage,
        partial: isPartial(prior.coverage),
        delta: await deltaFor(prior.brandId, prior.id),
        duplicate: true,
      };
    }
  }

  if (input.scores.length === 0) throw new ValidationError("At least one category score is required", "scores");
  const map: CategoryScores = {};
  for (const s of input.scores) {
    if (!CATEGORIES.includes(s.category)) throw new ValidationError(`Unknown category "${s.category}"`, "scores");
    if (map[s.category] !== undefined) throw new ValidationError(`Duplicate category "${s.category}"`, "scores");
    map[s.category] = s.score;
  }

  let result;
  try {
    result = computeHealth(map, await getWeights());
  } catch (e) {
    if (e instanceof RangeError) throw new ValidationError(e.message, "scores");
    throw e;
  }

  const fileId = input.reportPath ? await findFileId(brand.id, input.reportPath) : null;

  const auditId = await db.transaction(async (tx) => {
    const [audit] = await tx
      .insert(audits)
      .values({
        brandId: brand.id,
        auditedAt: input.auditedAt ?? new Date(),
        fileId,
        health: result.health,
        coverage: result.coverage,
        requestId: input.requestId ?? null,
      })
      .returning({ id: audits.id });
    await tx.insert(auditScores).values(
      input.scores.map((s) => ({
        auditId: audit.id,
        category: s.category,
        score: Math.round(s.score),
        target: s.target ?? null,
        evidence: s.evidence ?? null,
      })),
    );
    await advanceStage(brand.id, "audited", tx);
    await logActivity(
      {
        brandId: brand.id,
        actor: input.actor,
        kind: "audit",
        summary: `Audit recorded: health ${result.health ?? "n/a"}${result.partial ? " (partial)" : ""}`,
        refType: "audit",
        refId: audit.id,
      },
      tx,
    );
    return audit.id;
  });

  return { auditId, ...result, delta: await deltaFor(brand.id, auditId), duplicate: false };
}

export async function listAudits(brandId: string): Promise<AuditWithScores[]> {
  const rows = await db
    .select({
      id: audits.id,
      auditedAt: audits.auditedAt,
      health: audits.health,
      coverage: audits.coverage,
      reportPath: files.path,
    })
    .from(audits)
    .leftJoin(files, eq(files.id, audits.fileId))
    .where(eq(audits.brandId, brandId))
    .orderBy(desc(audits.auditedAt), desc(audits.createdAt));
  if (rows.length === 0) return [];
  const scores = await db
    .select()
    .from(auditScores)
    .where(inArray(auditScores.auditId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    ...r,
    partial: isPartial(r.coverage),
    scores: scores
      .filter((s) => s.auditId === r.id)
      .map((s) => ({ category: s.category, score: s.score, target: s.target, evidence: s.evidence })),
  }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project integration tests/integration/audits.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/audits.ts tests/integration/audits.test.ts
git commit -m "feat(audits): record audits with health, coverage, delta, idempotency"
```

---

### Task 9: Plans service with the approval rule

**Files:**
- Create: `lib/services/plans.ts`
- Test: `tests/integration/plans.test.ts`

**Interfaces:**
- Consumes: `FunnelStage` (Task 2); `Direction`, `DEFAULT_THRESHOLD_PCT` (Task 3); `getBrandBySlug`, `advanceStage` (Task 6); `findFileId` (Task 7). This task creates `lib/services/trackers.ts` with only `StartTrackerFields` and `startTracker` (Step 3), because completing an item creates its tracker; Task 10 adds `addCheckin` and `listTrackers` to the same file.
- Produces:
  - `type ItemStatus = (typeof itemStatusEnum.enumValues)[number]`; `AGENT_STATUSES = ["planned", "active", "done", "blocked"] as const`
  - `type PlanInput = { objective: string; primaryChannel?: string | null; secondaryChannels?: string[]; monthlyBudget?: number | null; weeklyHours?: number | null; timeline?: string | null; summary?: string | null; sourceAuditId?: string | null; planFilePath?: string | null }`
  - `type PlanItemInput = { title: string; description?: string | null; funnelStage: FunnelStage; channel?: string | null; priority?: number; expectedKpi?: string | null; needsApproval?: boolean }`
  - `createPlanVersion(input: { brandSlug: string; plan: PlanInput; items: PlanItemInput[]; requestId?: string; actor: Actor }): Promise<{ planId: string; version: number; itemIds: string[]; duplicate: boolean }>`
  - `type PlanItemView = typeof planItems.$inferSelect & { tracker: typeof trackers.$inferSelect | null; files: string[] }`; `type PlanView = typeof plans.$inferSelect & { items: PlanItemView[]; planFilePath: string | null }`
  - `getActivePlan(brandId: string): Promise<PlanView | null>`
  - `getNextPlanItem(brandSlug: string): Promise<PlanItemView | null>`
  - `updatePlanItem(input: { itemId: string; status?: (typeof AGENT_STATUSES)[number]; note?: string; linkFiles?: string[]; tracker?: StartTrackerFields; actor: Actor }): Promise<PlanItemView>`
  - `decidePlanItem(input: { itemId: string; decision: "approve" | "decline"; note?: string; actor: Actor }): Promise<PlanItemView>`
  - `countPendingApprovals(brandId?: string): Promise<number>`
  - From `lib/services/trackers.ts` (this task): `type StartTrackerFields = { kpi: string; unit?: string | null; direction: Direction; baselineValue: number; baselineAt: Date; source: string; windowDays: number; thresholdPct?: number }`; `startTracker(input: StartTrackerFields & { planItemId: string; actor: Actor }, tx?: DbOrTx): Promise<typeof trackers.$inferSelect>`

- [ ] **Step 1: Write the failing tests** — `tests/integration/plans.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand, getBrandBySlug } from "@/lib/services/brands";
import { writeFile } from "@/lib/services/files";
import {
  countPendingApprovals,
  createPlanVersion,
  decidePlanItem,
  getActivePlan,
  getNextPlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import { ApprovalError, ConflictError, ValidationError } from "@/lib/services/errors";

const tracker = {
  kpi: "Organic clicks",
  direction: "up" as const,
  baselineValue: 10,
  baselineAt: new Date("2026-09-20"),
  source: "GSC",
  windowDays: 28,
};

async function setup() {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  const plan = await createPlanVersion({
    brandSlug: "roof-co",
    plan: { objective: "Generate roofing leads", primaryChannel: "SEO", monthlyBudget: 1000, timeline: "90_day" },
    items: [
      { title: "Publish Flowood page", funnelStage: "acquisition", priority: 2 },
      { title: "Launch $500 search test", funnelStage: "acquisition", priority: 1, needsApproval: true },
    ],
    actor,
  });
  return { actor, brand, plan };
}

describe("plans service", () => {
  it("creates a versioned plan, archives the previous one, and advances the stage", async () => {
    const { actor, brand, plan } = await setup();
    expect(plan.version).toBe(1);
    const v2 = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "v2" }, items: [], actor });
    expect(v2.version).toBe(2);
    const active = await getActivePlan(brand.id);
    expect(active?.objective).toBe("v2");
    expect((await getBrandBySlug("roof-co")).stage).toBe("planned");
  });

  it("starts approval items in needs_approval and is idempotent by request id", async () => {
    const { actor, brand } = await setup();
    const items = (await getActivePlan(brand.id))!.items;
    expect(items.map((i) => [i.title, i.status])).toEqual([
      ["Launch $500 search test", "needs_approval"],
      ["Publish Flowood page", "planned"],
    ]);
    const a = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "x" }, items: [], requestId: "p1", actor });
    const b = await createPlanVersion({ brandSlug: "roof-co", plan: { objective: "y" }, items: [], requestId: "p1", actor });
    expect(b).toMatchObject({ planId: a.planId, duplicate: true });
  });

  it("returns the next actionable item by priority, skipping items awaiting approval", async () => {
    await setup();
    expect((await getNextPlanItem("roof-co"))?.title).toBe("Publish Flowood page");
  });

  it("blocks agents from activating or completing unapproved items", async () => {
    const { actor, brand } = await setup();
    const gated = (await getActivePlan(brand.id))!.items[0];
    await expect(updatePlanItem({ itemId: gated.id, status: "active", actor })).rejects.toBeInstanceOf(ApprovalError);
    expect(await countPendingApprovals()).toBe(1);
    await decidePlanItem({ itemId: gated.id, decision: "approve", actor });
    expect(await countPendingApprovals()).toBe(0);
    expect((await getNextPlanItem("roof-co"))?.title).toBe("Launch $500 search test");
    const active = await updatePlanItem({ itemId: gated.id, status: "active", actor });
    expect(active.status).toBe("active");
    expect((await getBrandBySlug("roof-co")).stage).toBe("executing");
  });

  it("rejects agent-set approval statuses", async () => {
    const { actor, brand } = await setup();
    const item = (await getActivePlan(brand.id))!.items[1];
    await expect(
      // @ts-expect-error agents cannot approve
      updatePlanItem({ itemId: item.id, status: "approved", actor }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires a tracker to complete an item and links files", async () => {
    const { actor, brand } = await setup();
    const item = (await getActivePlan(brand.id))!.items[1];
    await writeFile({ brandId: brand.id, path: "deliverables/flowood.md", content: "draft", actor });
    await expect(updatePlanItem({ itemId: item.id, status: "done", actor })).rejects.toBeInstanceOf(ValidationError);
    const done = await updatePlanItem({
      itemId: item.id,
      status: "done",
      note: "Published",
      linkFiles: ["deliverables/flowood.md"],
      tracker,
      actor,
    });
    expect(done).toMatchObject({ status: "done", notes: "Published", files: ["deliverables/flowood.md"] });
    expect(done.tracker).toMatchObject({ kpi: "Organic clicks", verdict: "pending" });
    await expect(updatePlanItem({ itemId: item.id, tracker, actor })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only decides items that are awaiting approval", async () => {
    const { actor, brand } = await setup();
    const plain = (await getActivePlan(brand.id))!.items[1];
    await expect(decidePlanItem({ itemId: plain.id, decision: "approve", actor })).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/plans.test.ts`
Expected: FAIL — `@/lib/services/plans` not found.

- [ ] **Step 3: Create the tracker-start part of** `lib/services/trackers.ts`

```ts
import { db, type DbOrTx } from "@/lib/data/db";
import { trackers } from "@/lib/data/schema";
import { DEFAULT_THRESHOLD_PCT, type Direction } from "@/lib/domain/verdict";
import type { Actor } from "./actor";
import { ConflictError, ValidationError } from "./errors";

export type StartTrackerFields = {
  kpi: string;
  unit?: string | null;
  direction: Direction;
  baselineValue: number;
  baselineAt: Date;
  source: string;
  windowDays: number;
  thresholdPct?: number;
};

export async function startTracker(
  input: StartTrackerFields & { planItemId: string; actor: Actor },
  tx: DbOrTx = db,
): Promise<typeof trackers.$inferSelect> {
  if (!input.kpi.trim()) throw new ValidationError("KPI name is required", "kpi");
  if (!Number.isFinite(input.baselineValue)) throw new ValidationError("Baseline must be a number", "baselineValue");
  if (!Number.isInteger(input.windowDays) || input.windowDays < 1) throw new ValidationError("windowDays must be a whole number ≥ 1", "windowDays");
  const threshold = input.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
  if (!(threshold > 0)) throw new ValidationError("thresholdPct must be greater than 0", "thresholdPct");
  const existing = await tx.query.trackers.findFirst({ where: (t, { eq }) => eq(t.planItemId, input.planItemId) });
  if (existing) throw new ConflictError("This plan item already has a tracker", { trackerId: existing.id });
  const [row] = await tx
    .insert(trackers)
    .values({
      planItemId: input.planItemId,
      kpi: input.kpi.trim(),
      unit: input.unit ?? null,
      direction: input.direction,
      baselineValue: input.baselineValue,
      baselineAt: input.baselineAt,
      source: input.source,
      windowDays: input.windowDays,
      thresholdPct: threshold,
    })
    .returning();
  return row;
}
```

- [ ] **Step 4: Implement** — `lib/services/plans.ts`

```ts
import { and, asc, count, desc, eq, inArray, max } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { files, itemStatusEnum, planItemFiles, planItems, plans, trackers } from "@/lib/data/schema";
import type { FunnelStage } from "@/lib/domain/funnel";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { advanceStage, getBrandBySlug } from "./brands";
import { ApprovalError, NotFoundError, ValidationError } from "./errors";
import { findFileId } from "./files";
import { startTracker, type StartTrackerFields } from "./trackers";

export type ItemStatus = (typeof itemStatusEnum.enumValues)[number];
export const AGENT_STATUSES = ["planned", "active", "done", "blocked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export type PlanInput = {
  objective: string;
  primaryChannel?: string | null;
  secondaryChannels?: string[];
  monthlyBudget?: number | null;
  weeklyHours?: number | null;
  timeline?: string | null;
  summary?: string | null;
  sourceAuditId?: string | null;
  planFilePath?: string | null;
};
export type PlanItemInput = {
  title: string;
  description?: string | null;
  funnelStage: FunnelStage;
  channel?: string | null;
  priority?: number;
  expectedKpi?: string | null;
  needsApproval?: boolean;
};
export type PlanItemView = typeof planItems.$inferSelect & { tracker: typeof trackers.$inferSelect | null; files: string[] };
export type PlanView = typeof plans.$inferSelect & { items: PlanItemView[]; planFilePath: string | null };

async function hydrateItems(rows: (typeof planItems.$inferSelect)[]): Promise<PlanItemView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const trackerRows = await db.select().from(trackers).where(inArray(trackers.planItemId, ids));
  const fileRows = await db
    .select({ planItemId: planItemFiles.planItemId, path: files.path })
    .from(planItemFiles)
    .innerJoin(files, eq(files.id, planItemFiles.fileId))
    .where(inArray(planItemFiles.planItemId, ids));
  return rows.map((r) => ({
    ...r,
    tracker: trackerRows.find((t) => t.planItemId === r.id) ?? null,
    files: fileRows.filter((f) => f.planItemId === r.id).map((f) => f.path).sort(),
  }));
}

async function getItem(itemId: string): Promise<{ item: typeof planItems.$inferSelect; brandId: string }> {
  const [row] = await db
    .select({ item: planItems, brandId: plans.brandId })
    .from(planItems)
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(planItems.id, itemId));
  if (!row) throw new NotFoundError(`Plan item ${itemId} not found`);
  return row;
}

async function viewItem(itemId: string): Promise<PlanItemView> {
  const [row] = await db.select().from(planItems).where(eq(planItems.id, itemId));
  return (await hydrateItems([row]))[0];
}

export async function createPlanVersion(input: {
  brandSlug: string;
  plan: PlanInput;
  items: PlanItemInput[];
  requestId?: string;
  actor: Actor;
}): Promise<{ planId: string; version: number; itemIds: string[]; duplicate: boolean }> {
  const brand = await getBrandBySlug(input.brandSlug);
  if (input.requestId) {
    const [prior] = await db.select().from(plans).where(eq(plans.requestId, input.requestId));
    if (prior) {
      const items = await db.select({ id: planItems.id }).from(planItems).where(eq(planItems.planId, prior.id));
      return { planId: prior.id, version: prior.version, itemIds: items.map((i) => i.id), duplicate: true };
    }
  }
  if (!input.plan.objective?.trim()) throw new ValidationError("Plan objective is required", "objective");
  for (const item of input.items) {
    if (!item.title?.trim()) throw new ValidationError("Every plan item needs a title", "items");
  }
  const fileId = input.plan.planFilePath ? await findFileId(brand.id, input.plan.planFilePath) : null;

  return db.transaction(async (tx) => {
    const [{ v }] = await tx.select({ v: max(plans.version) }).from(plans).where(eq(plans.brandId, brand.id));
    const version = (v ?? 0) + 1;
    await tx
      .update(plans)
      .set({ status: "archived" })
      .where(and(eq(plans.brandId, brand.id), eq(plans.status, "active")));
    const [plan] = await tx
      .insert(plans)
      .values({
        brandId: brand.id,
        version,
        status: "active",
        objective: input.plan.objective.trim(),
        primaryChannel: input.plan.primaryChannel ?? null,
        secondaryChannels: input.plan.secondaryChannels ?? [],
        monthlyBudget: input.plan.monthlyBudget ?? null,
        weeklyHours: input.plan.weeklyHours ?? null,
        timeline: input.plan.timeline ?? null,
        summary: input.plan.summary ?? null,
        sourceAuditId: input.plan.sourceAuditId ?? null,
        fileId,
        requestId: input.requestId ?? null,
      })
      .returning({ id: plans.id });
    const itemIds: string[] = [];
    if (input.items.length > 0) {
      const inserted = await tx
        .insert(planItems)
        .values(
          input.items.map((i) => ({
            planId: plan.id,
            title: i.title.trim(),
            description: i.description ?? null,
            funnelStage: i.funnelStage,
            channel: i.channel ?? null,
            priority: i.priority ?? 100,
            expectedKpi: i.expectedKpi ?? null,
            needsApproval: i.needsApproval ?? false,
            status: (i.needsApproval ? "needs_approval" : "planned") as ItemStatus,
          })),
        )
        .returning({ id: planItems.id });
      itemIds.push(...inserted.map((r) => r.id));
    }
    await advanceStage(brand.id, "planned", tx);
    await logActivity(
      { brandId: brand.id, actor: input.actor, kind: "plan", summary: `Plan v${version} created with ${input.items.length} items`, refType: "plan", refId: plan.id },
      tx,
    );
    return { planId: plan.id, version, itemIds, duplicate: false };
  });
}

export async function getActivePlan(brandId: string): Promise<PlanView | null> {
  const [plan] = await db
    .select({ plan: plans, planFilePath: files.path })
    .from(plans)
    .leftJoin(files, eq(files.id, plans.fileId))
    .where(and(eq(plans.brandId, brandId), eq(plans.status, "active")))
    .orderBy(desc(plans.version))
    .limit(1);
  if (!plan) return null;
  const rows = await db
    .select()
    .from(planItems)
    .where(eq(planItems.planId, plan.plan.id))
    .orderBy(asc(planItems.priority), asc(planItems.createdAt));
  return { ...plan.plan, planFilePath: plan.planFilePath, items: await hydrateItems(rows) };
}

export async function getNextPlanItem(brandSlug: string): Promise<PlanItemView | null> {
  const brand = await getBrandBySlug(brandSlug);
  const plan = await getActivePlan(brand.id);
  return plan?.items.find((i) => i.status === "planned" || i.status === "approved") ?? null;
}

export async function updatePlanItem(input: {
  itemId: string;
  status?: AgentStatus;
  note?: string;
  linkFiles?: string[];
  tracker?: StartTrackerFields;
  actor: Actor;
}): Promise<PlanItemView> {
  const { item, brandId } = await getItem(input.itemId);
  if (input.status && !(AGENT_STATUSES as readonly string[]).includes(input.status)) {
    throw new ValidationError(`Status "${input.status}" can only be set in the app (agents may use ${AGENT_STATUSES.join(", ")})`, "status");
  }
  if ((input.status === "active" || input.status === "done") && item.needsApproval && !item.approvedAt) {
    throw new ApprovalError(`"${item.title}" needs approval in the app before it can be started or completed`);
  }
  const fileIds = await Promise.all((input.linkFiles ?? []).map((p) => findFileId(brandId, p)));

  await db.transaction(async (tx) => {
    const existingTracker = await tx.query.trackers.findFirst({ where: (t, { eq: e }) => e(t.planItemId, item.id) });
    if (input.tracker) {
      await startTracker({ ...input.tracker, planItemId: item.id, actor: input.actor }, tx);
    } else if (input.status === "done" && !existingTracker) {
      throw new ValidationError(
        "Completing an item requires a tracker: pass `tracker` with kpi, direction, baselineValue, baselineAt, source, windowDays",
        "tracker",
      );
    }
    const notes = input.note ? (item.notes ? `${item.notes}\n\n${input.note}` : input.note) : item.notes;
    await tx
      .update(planItems)
      .set({ status: input.status ?? item.status, notes })
      .where(eq(planItems.id, item.id));
    if (fileIds.length > 0) {
      await tx
        .insert(planItemFiles)
        .values(fileIds.map((fileId) => ({ planItemId: item.id, fileId })))
        .onConflictDoNothing();
    }
    if (input.status === "active" || input.status === "done") await advanceStage(brandId, "executing", tx);
    await logActivity(
      {
        brandId,
        actor: input.actor,
        kind: input.tracker ? "tracker" : "plan",
        summary: `Updated "${item.title}"${input.status ? ` → ${input.status}` : ""}${input.tracker ? ` (tracking ${input.tracker.kpi})` : ""}`,
        refType: "plan_item",
        refId: item.id,
      },
      tx,
    );
  });
  return viewItem(item.id);
}

export async function decidePlanItem(input: {
  itemId: string;
  decision: "approve" | "decline";
  note?: string;
  actor: Actor;
}): Promise<PlanItemView> {
  const { item, brandId } = await getItem(input.itemId);
  if (item.status !== "needs_approval") {
    throw new ValidationError(`"${item.title}" is not awaiting approval (status: ${item.status})`, "status");
  }
  const approve = input.decision === "approve";
  await db
    .update(planItems)
    .set({
      status: approve ? "approved" : "declined",
      approvalNote: input.note ?? null,
      approvedBy: approve ? input.actor.userId : null,
      approvedAt: approve ? new Date() : null,
    })
    .where(eq(planItems.id, item.id));
  await logActivity({
    brandId,
    actor: input.actor,
    kind: "approval",
    summary: `${approve ? "Approved" : "Declined"} "${item.title}"`,
    refType: "plan_item",
    refId: item.id,
  });
  return viewItem(item.id);
}

export async function countPendingApprovals(brandId?: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(planItems)
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(
      and(
        eq(planItems.status, "needs_approval"),
        eq(plans.status, "active"),
        brandId ? eq(plans.brandId, brandId) : undefined,
      ),
    );
  return Number(row.n);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run --project integration tests/integration/plans.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/services/plans.ts lib/services/trackers.ts tests/integration/plans.test.ts
git commit -m "feat(plans): versioned plans, approval gate, tracker-required completion"
```

---

### Task 10: Tracker check-ins, verdicts, and integrations

**Files:**
- Modify: `lib/services/trackers.ts` (add `addCheckin`, `listTrackers`)
- Create: `lib/services/integrations.ts`
- Test: `tests/integration/trackers.test.ts`, `tests/integration/integrations.test.ts`

**Interfaces:**
- Consumes: `computeVerdict` (Task 3); `SERVICES`, `Service` (Task 2); `createPlanVersion`, `updatePlanItem` (Task 9); `getBrandBySlug` (Task 6).
- Produces:
  - `addCheckin(input: { trackerId: string; value: number; observedAt: Date; source: string; note?: string | null; actor: Actor; now?: Date }): Promise<{ verdict: Verdict; changePct: number | null; changeAbs: number | null; latest: number | null }>`
  - `type TrackerSummary = { id: string; planItemId: string; itemTitle: string; kpi: string; unit: string | null; direction: Direction; baselineValue: number; baselineAt: Date; windowDays: number; latest: number | null; changePct: number | null; changeAbs: number | null; verdict: Verdict; windowEndsAt: Date; checkins: { value: number; observedAt: Date }[] }`
  - `listTrackers(brandId: string, now?: Date): Promise<TrackerSummary[]>` (verdict recomputed at read time)
  - `upsertIntegration(input: { brandSlug: string; service: Service; status: "connected" | "not_connected" | "error"; identifiers?: Record<string, string>; notes?: string | null; actor: Actor }): Promise<typeof integrations.$inferSelect>`
  - `listIntegrations(brandId: string): Promise<(typeof integrations.$inferSelect)[]>`

- [ ] **Step 1: Write the failing tests**

`tests/integration/trackers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { createPlanVersion, getActivePlan, updatePlanItem } from "@/lib/services/plans";
import { addCheckin, listTrackers } from "@/lib/services/trackers";
import { NotFoundError, ValidationError } from "@/lib/services/errors";

async function trackedItem(baselineValue = 10) {
  const actor = await createTestUser();
  const brand = await createBrand({ name: "Roof Co", actor });
  await createPlanVersion({
    brandSlug: "roof-co",
    plan: { objective: "Leads" },
    items: [{ title: "Publish Flowood page", funnelStage: "acquisition" }],
    actor,
  });
  const item = (await getActivePlan(brand.id))!.items[0];
  const done = await updatePlanItem({
    itemId: item.id,
    status: "done",
    tracker: { kpi: "Leads", direction: "up", baselineValue, baselineAt: new Date("2026-09-01T00:00:00Z"), source: "GA4", windowDays: 30 },
    actor,
  });
  return { actor, brand, trackerId: done.tracker!.id };
}

describe("trackers", () => {
  it("stays pending inside the window and turns positive after it", async () => {
    const { actor, brand, trackerId } = await trackedItem();
    const early = await addCheckin({ trackerId, value: 14, observedAt: new Date("2026-09-15"), source: "GA4", actor, now: new Date("2026-09-15") });
    expect(early).toMatchObject({ verdict: "pending", changePct: 40 });
    const late = await addCheckin({ trackerId, value: 15, observedAt: new Date("2026-10-02"), source: "GA4", actor, now: new Date("2026-10-02") });
    expect(late).toMatchObject({ verdict: "positive", changePct: 50, latest: 15 });
    const [summary] = await listTrackers(brand.id, new Date("2026-10-02"));
    expect(summary).toMatchObject({ itemTitle: "Publish Flowood page", verdict: "positive", latest: 15 });
    expect(summary.checkins).toHaveLength(2);
  });

  it("handles a zero baseline with absolute change", async () => {
    const { actor, trackerId } = await trackedItem(0);
    const r = await addCheckin({ trackerId, value: 3, observedAt: new Date("2026-10-05"), source: "GA4", actor, now: new Date("2026-10-05") });
    expect(r).toMatchObject({ verdict: "positive", changePct: null, changeAbs: 3 });
  });

  it("validates check-ins", async () => {
    const { actor, trackerId } = await trackedItem();
    await expect(
      addCheckin({ trackerId, value: Number.NaN, observedAt: new Date(), source: "GA4", actor }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addCheckin({ trackerId: "00000000-0000-0000-0000-000000000000", value: 1, observedAt: new Date(), source: "GA4", actor }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

`tests/integration/integrations.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

describe("integrations", () => {
  it("upserts one record per brand and service", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "SuperThrift", actor });
    await upsertIntegration({ brandSlug: "superthrift", service: "ga4", status: "not_connected", actor });
    await upsertIntegration({ brandSlug: "superthrift", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const list = await listIntegrations(b.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ service: "ga4", status: "connected", identifiers: { property_id: "515827425" } });
    expect(list[0].verifiedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/trackers.test.ts tests/integration/integrations.test.ts`
Expected: FAIL — `addCheckin`, `listTrackers`, and `@/lib/services/integrations` not found.

- [ ] **Step 3: Add check-ins and summaries to** `lib/services/trackers.ts`

Replace the import block at the top of the file with:
```ts
import { asc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { planItems, plans, trackerCheckins, trackers } from "@/lib/data/schema";
import { computeVerdict, DEFAULT_THRESHOLD_PCT, type Direction, type Verdict } from "@/lib/domain/verdict";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
```
Append:
```ts
export type TrackerSummary = {
  id: string;
  planItemId: string;
  itemTitle: string;
  kpi: string;
  unit: string | null;
  direction: Direction;
  baselineValue: number;
  baselineAt: Date;
  windowDays: number;
  latest: number | null;
  changePct: number | null;
  changeAbs: number | null;
  verdict: Verdict;
  windowEndsAt: Date;
  checkins: { value: number; observedAt: Date }[];
};

export async function addCheckin(input: {
  trackerId: string;
  value: number;
  observedAt: Date;
  source: string;
  note?: string | null;
  actor: Actor;
  now?: Date;
}): Promise<{ verdict: Verdict; changePct: number | null; changeAbs: number | null; latest: number | null }> {
  if (!Number.isFinite(input.value)) throw new ValidationError("Check-in value must be a number", "value");
  if (Number.isNaN(input.observedAt.getTime())) throw new ValidationError("observedAt must be a valid date", "observedAt");
  const [row] = await db
    .select({ tracker: trackers, brandId: plans.brandId })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(trackers.id, input.trackerId));
  if (!row) throw new NotFoundError(`Tracker ${input.trackerId} not found`);
  const t = row.tracker;

  await db.insert(trackerCheckins).values({
    trackerId: t.id,
    value: input.value,
    observedAt: input.observedAt,
    source: input.source,
    note: input.note ?? null,
  });
  const checkins = await db.select().from(trackerCheckins).where(eq(trackerCheckins.trackerId, t.id));
  const r = computeVerdict(t, checkins, input.now ?? new Date());
  await db
    .update(trackers)
    .set({
      verdict: r.verdict,
      changePct: r.changePct,
      verdictAt: r.verdict !== "pending" && t.verdict === "pending" ? new Date() : t.verdictAt,
    })
    .where(eq(trackers.id, t.id));
  await logActivity({
    brandId: row.brandId,
    actor: input.actor,
    kind: "tracker",
    summary: `Check-in ${t.kpi}: ${input.value} (${r.verdict})`,
    refType: "tracker",
    refId: t.id,
  });
  return { verdict: r.verdict, changePct: r.changePct, changeAbs: r.changeAbs, latest: r.latest };
}

export async function listTrackers(brandId: string, now: Date = new Date()): Promise<TrackerSummary[]> {
  const rows = await db
    .select({ tracker: trackers, itemTitle: planItems.title })
    .from(trackers)
    .innerJoin(planItems, eq(planItems.id, trackers.planItemId))
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(eq(plans.brandId, brandId))
    .orderBy(asc(trackers.baselineAt));
  if (rows.length === 0) return [];
  const checkins = await db
    .select()
    .from(trackerCheckins)
    .where(inArray(trackerCheckins.trackerId, rows.map((r) => r.tracker.id)))
    .orderBy(asc(trackerCheckins.observedAt));
  return rows.map(({ tracker: t, itemTitle }) => {
    const own = checkins.filter((c) => c.trackerId === t.id).map((c) => ({ value: c.value, observedAt: c.observedAt }));
    const r = computeVerdict(t, own, now);
    return {
      id: t.id,
      planItemId: t.planItemId,
      itemTitle,
      kpi: t.kpi,
      unit: t.unit,
      direction: t.direction,
      baselineValue: t.baselineValue,
      baselineAt: t.baselineAt,
      windowDays: t.windowDays,
      latest: r.latest,
      changePct: r.changePct,
      changeAbs: r.changeAbs,
      verdict: r.verdict,
      windowEndsAt: r.windowEndsAt,
      checkins: own,
    };
  });
}
```

- [ ] **Step 4: Implement** — `lib/services/integrations.ts`

```ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { integrations } from "@/lib/data/schema";
import { SERVICE_LABELS, SERVICES, type Service } from "@/lib/domain/integrations";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";

export async function upsertIntegration(input: {
  brandSlug: string;
  service: Service;
  status: "connected" | "not_connected" | "error";
  identifiers?: Record<string, string>;
  notes?: string | null;
  actor: Actor;
}) {
  if (!SERVICES.includes(input.service)) throw new ValidationError(`Unknown service "${input.service}"`, "service");
  const brand = await getBrandBySlug(input.brandSlug);
  const values = {
    brandId: brand.id,
    service: input.service,
    status: input.status,
    identifiers: input.identifiers ?? {},
    notes: input.notes ?? null,
    verifiedAt: new Date(),
  };
  const [row] = await db
    .insert(integrations)
    .values(values)
    .onConflictDoUpdate({
      target: [integrations.brandId, integrations.service],
      set: { status: values.status, identifiers: values.identifiers, notes: values.notes, verifiedAt: values.verifiedAt },
    })
    .returning();
  await logActivity({
    brandId: brand.id,
    actor: input.actor,
    kind: "integration",
    summary: `${SERVICE_LABELS[input.service]}: ${input.status.replace("_", " ")}`,
    refType: "integration",
    refId: row.id,
  });
  return row;
}

export async function listIntegrations(brandId: string) {
  return db.select().from(integrations).where(eq(integrations.brandId, brandId)).orderBy(integrations.service);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:int`
Expected: PASS (all integration tests).

- [ ] **Step 6: Commit**

```bash
git add lib/services tests/integration
git commit -m "feat(trackers,integrations): check-ins with verdicts, integration records"
```

---

### Task 11: Brand context and API tokens

**Files:**
- Create: `lib/services/context.ts`, `lib/services/tokens.ts`
- Test: `tests/integration/context.test.ts`, `tests/integration/tokens.test.ts`

**Interfaces:**
- Consumes: Tasks 6–10 services; `missingOnboardingQuestions`, `missingPlanQuestions` (Task 4).
- Produces:
  - `type BrandContext = { brand: { name; slug; domain; stage }; onboarding: { answers: Record<string, unknown>; missing: string[] }; health: { health: number | null; delta: number | null }; latestAudit: AuditWithScores | null; activePlan: PlanView | null; openItems: PlanItemView[]; trackers: TrackerSummary[]; integrations: { service; status; identifiers }[] }`
  - `getBrandContext(slug: string): Promise<BrandContext>`
  - `getPlanQuestions(slug: string): Promise<Question[]>`
  - `createApiToken(userId: string, name: string): Promise<{ id: string; token: string }>` (token prefix `hm_`)
  - `verifyApiToken(raw: string): Promise<{ tokenId: string; userId: string; name: string; email: string } | null>`
  - `revokeApiToken(userId: string, tokenId: string): Promise<void>`
  - `listApiTokens(userId: string): Promise<{ id: string; name: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }[]>`

- [ ] **Step 1: Write the failing tests**

`tests/integration/context.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { recordAudit } from "@/lib/services/audits";
import { createBrand, saveOnboarding } from "@/lib/services/brands";
import { getBrandContext, getPlanQuestions } from "@/lib/services/context";
import { createPlanVersion } from "@/lib/services/plans";

describe("brand context", () => {
  it("bundles everything an agent needs in one call", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", domain: "roofcoms.com", actor });
    await saveOnboarding("roof-co", { primary_goal: "leads", monthly_budget: 1000 }, actor);
    await recordAudit({ brandSlug: "roof-co", scores: [{ category: "seo", score: 70 }, { category: "geo", score: 50 }, { category: "ai_visibility", score: 10 }, { category: "website_content", score: 60 }], actor });
    await createPlanVersion({
      brandSlug: "roof-co",
      plan: { objective: "Leads" },
      items: [{ title: "A", funnelStage: "acquisition" }, { title: "B", funnelStage: "revenue", needsApproval: true }],
      actor,
    });
    const ctx = await getBrandContext("roof-co");
    expect(ctx.brand).toMatchObject({ slug: "roof-co", domain: "roofcoms.com", stage: "planned" });
    expect(ctx.onboarding.missing).not.toContain("primary_goal");
    expect(ctx.latestAudit?.scores).toHaveLength(4);
    // (70·20 + 50·15 + 10·20 + 60·20) / 75 = 3550 / 75 = 47.33 → 47; coverage 0.75 is not partial
    expect(ctx.health.health).toBe(47);
    expect(ctx.openItems.map((i) => i.title)).toEqual(["A", "B"]);
    expect(ctx.trackers).toEqual([]);
  });

  it("only asks plan questions not answered in onboarding", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });
    await saveOnboarding("roof-co", { primary_goal: "leads", monthly_budget: 1000 }, actor);
    const keys = (await getPlanQuestions("roof-co")).map((q) => q.key);
    expect(keys).not.toContain("primary_goal");
    expect(keys).toContain("primary_channel");
  });
});
```

`tests/integration/tokens.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createApiToken, listApiTokens, revokeApiToken, verifyApiToken } from "@/lib/services/tokens";

describe("api tokens", () => {
  it("creates, verifies, lists, and revokes tokens", async () => {
    const actor = await createTestUser("corey@test.local");
    const { id, token } = await createApiToken(actor.userId, "Claude Desktop");
    expect(token).toMatch(/^hm_[A-Za-z0-9_-]{40,}$/);
    expect(await verifyApiToken(token)).toMatchObject({ tokenId: id, userId: actor.userId, name: "Claude Desktop", email: "corey@test.local" });
    expect(await verifyApiToken("hm_wrong")).toBeNull();
    const [listed] = await listApiTokens(actor.userId);
    expect(listed.lastUsedAt).toBeInstanceOf(Date);
    expect(listed).not.toHaveProperty("tokenHash");
    await revokeApiToken(actor.userId, id);
    expect(await verifyApiToken(token)).toBeNull();
  });

  it("does not let one user revoke another user's token", async () => {
    const a = await createTestUser("a@test.local");
    const b = await createTestUser("b@test.local");
    const { token, id } = await createApiToken(a.userId, "A");
    await revokeApiToken(b.userId, id);
    expect(await verifyApiToken(token)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/context.test.ts tests/integration/tokens.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `lib/services/context.ts`

```ts
import { missingOnboardingQuestions, missingPlanQuestions, type Question } from "@/lib/domain/questions";
import { summarizeHealth } from "@/lib/domain/scoring";
import { listAudits, type AuditWithScores } from "./audits";
import { getBrandBySlug } from "./brands";
import { listIntegrations } from "./integrations";
import { getActivePlan, type PlanItemView, type PlanView } from "./plans";
import { listTrackers, type TrackerSummary } from "./trackers";

const OPEN = new Set(["planned", "active", "needs_approval", "approved", "blocked"]);

export type BrandContext = {
  brand: { name: string; slug: string; domain: string | null; stage: string };
  onboarding: { answers: Record<string, unknown>; missing: string[] };
  health: { health: number | null; delta: number | null };
  latestAudit: AuditWithScores | null;
  activePlan: PlanView | null;
  openItems: PlanItemView[];
  trackers: TrackerSummary[];
  integrations: { service: string; status: string; identifiers: Record<string, string> }[];
};

export async function getBrandContext(slug: string): Promise<BrandContext> {
  const brand = await getBrandBySlug(slug);
  const [audits, activePlan, trackers, integrations] = await Promise.all([
    listAudits(brand.id),
    getActivePlan(brand.id),
    listTrackers(brand.id),
    listIntegrations(brand.id),
  ]);
  return {
    brand: { name: brand.name, slug: brand.slug, domain: brand.domain, stage: brand.stage },
    onboarding: { answers: brand.onboarding, missing: missingOnboardingQuestions(brand.onboarding).map((q) => q.key) },
    health: summarizeHealth(audits),
    latestAudit: audits[0] ?? null,
    activePlan,
    openItems: activePlan?.items.filter((i) => OPEN.has(i.status)) ?? [],
    trackers,
    integrations: integrations.map((i) => ({ service: i.service, status: i.status, identifiers: i.identifiers })),
  };
}

export async function getPlanQuestions(slug: string): Promise<Question[]> {
  const brand = await getBrandBySlug(slug);
  return missingPlanQuestions(brand.onboarding);
}
```

- [ ] **Step 4: Implement** — `lib/services/tokens.ts`

```ts
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { apiTokens, users } from "@/lib/data/schema";
import { ValidationError } from "./errors";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export async function createApiToken(userId: string, name: string): Promise<{ id: string; token: string }> {
  if (!name.trim()) throw new ValidationError("Token name is required", "name");
  const token = `hm_${randomBytes(32).toString("base64url")}`;
  const [row] = await db.insert(apiTokens).values({ userId, name: name.trim(), tokenHash: hash(token) }).returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function verifyApiToken(raw: string) {
  const [row] = await db
    .select({ tokenId: apiTokens.id, userId: apiTokens.userId, name: apiTokens.name, email: users.email })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hash(raw)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  return row;
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test:int`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services tests/integration
git commit -m "feat(services): brand context bundle and hashed API tokens"
```

### Task 12: MCP server — tools, auth, and route

**Files:**
- Create: `lib/mcp/tools.ts`, `lib/mcp/run.ts`, `lib/mcp/auth.ts`, `lib/mcp/register.ts`, `app/api/[transport]/route.ts`
- Test: `tests/integration/mcp-tools.test.ts`

**Interfaces:**
- Consumes: every service from Tasks 6–11; `CATEGORIES` (Task 2), `FUNNEL_STAGES` (Task 2), `SERVICES` (Task 2), `AGENT_STATUSES` (Task 9).
- Produces:
  - `tools: AnyTool[]` and `findTool(name: string): AnyTool` from `lib/mcp/tools.ts`; tool names exactly: `list_brands, get_brand_context, get_onboarding_questions, save_onboarding, list_files, read_file, write_file, read_skill, record_audit, get_plan_questions, create_plan_version, get_next_plan_item, update_plan_item, start_tracker, add_checkin, upsert_integration, log_activity`
  - `runTool(tool: AnyTool, rawArgs: unknown, actor: Actor): Promise<CallToolResult>` from `lib/mcp/run.ts` — success: `{ content: [{ type: "text", text: JSON }] }`; domain or validation error: `{ isError: true, content: [{ type: "text", text: JSON { error, message, ...details } }] }`
  - `authenticateBearer(bearer: string | undefined): Promise<AuthInfo | undefined>` and `actorFromAuth(info: AuthInfo | undefined): Actor` from `lib/mcp/auth.ts`
  - `registerTools(server: McpServer): void`
  - HTTP endpoint `POST /api/mcp` (Streamable HTTP), `Authorization: Bearer hm_…` required

- [ ] **Step 1: Write the failing tests** — `tests/integration/mcp-tools.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { actorFromAuth, authenticateBearer } from "@/lib/mcp/auth";
import { runTool } from "@/lib/mcp/run";
import { findTool, tools } from "@/lib/mcp/tools";
import { createBrand } from "@/lib/services/brands";
import { createApiToken } from "@/lib/services/tokens";
import type { Actor } from "@/lib/services/actor";

async function call(name: string, args: unknown, actor: Actor) {
  const res = await runTool(findTool(name), args, actor);
  const body = JSON.parse((res.content[0] as { text: string }).text);
  return { isError: res.isError === true, body };
}

describe("MCP tools", () => {
  it("exposes the full tool set", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_checkin",
        "create_plan_version",
        "get_brand_context",
        "get_next_plan_item",
        "get_onboarding_questions",
        "get_plan_questions",
        "list_brands",
        "list_files",
        "log_activity",
        "read_file",
        "read_skill",
        "record_audit",
        "save_onboarding",
        "start_tracker",
        "update_plan_item",
        "upsert_integration",
        "write_file",
      ].sort(),
    );
  });

  it("runs onboarding → audit → plan → execute → check-in end to end", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "Roof Co", actor });

    const q = await call("get_onboarding_questions", { brand: "roof-co" }, actor);
    expect(q.body.questions.length).toBeGreaterThan(5);
    await call("save_onboarding", { brand: "roof-co", answers: { primary_goal: "leads" } }, actor);

    await call("write_file", { brand: "roof-co", path: "audits/2026-10-01-full-audit.md", content: "# Audit" }, actor);
    const audit = await call(
      "record_audit",
      {
        brand: "roof-co",
        audited_at: "2026-10-01T00:00:00Z",
        report_path: "audits/2026-10-01-full-audit.md",
        request_id: "a1",
        scores: [
          { category: "seo", score: 40, evidence: "2 of 10 keywords" },
          { category: "geo", score: 60 },
          { category: "ai_visibility", score: 5 },
          { category: "website_content", score: 70 },
        ],
      },
      actor,
    );
    // (40·20 + 60·15 + 5·20 + 70·20) / 75 = 3200 / 75 = 42.67 → 43
    expect(audit).toMatchObject({ isError: false, body: { health: 43, partial: false, duplicate: false } });

    const plan = await call(
      "create_plan_version",
      {
        brand: "roof-co",
        request_id: "p1",
        plan: { objective: "Roofing leads", primary_channel: "SEO", monthly_budget: 1000 },
        items: [{ title: "Flowood page", funnel_stage: "acquisition", priority: 1, expected_kpi: "Organic leads" }],
      },
      actor,
    );
    expect(plan.body.version).toBe(1);

    const next = await call("get_next_plan_item", { brand: "roof-co" }, actor);
    expect(next.body.item.title).toBe("Flowood page");

    const done = await call(
      "update_plan_item",
      {
        item_id: next.body.item.id,
        status: "done",
        tracker: { kpi: "Organic leads", direction: "up", baseline_value: 2, baseline_at: "2026-09-01T00:00:00Z", source: "GA4", window_days: 14 },
      },
      actor,
    );
    expect(done.body.item.tracker.verdict).toBe("pending");

    const checkin = await call(
      "add_checkin",
      { tracker_id: done.body.item.tracker.id, value: 5, observed_at: "2026-09-20T00:00:00Z", source: "GA4" },
      actor,
    );
    expect(checkin.body.verdict).toBe("positive");

    const ctx = await call("get_brand_context", { brand: "roof-co" }, actor);
    expect(ctx.body.brand.stage).toBe("executing");
  });

  it("returns structured errors instead of throwing", async () => {
    const actor = await createTestUser();
    await createBrand({ name: "SuperThrift", slug: "superthriftdeals-org", actor });
    const nf = await call("get_brand_context", { brand: "superthrift" }, actor);
    expect(nf).toMatchObject({ isError: true, body: { error: "not_found", suggestions: ["superthriftdeals-org"] } });
    const bad = await call("record_audit", { brand: "superthriftdeals-org", scores: [{ category: "tiktok", score: 5 }] }, actor);
    expect(bad).toMatchObject({ isError: true, body: { error: "validation" } });
    const badDate = await call(
      "add_checkin",
      { tracker_id: "00000000-0000-0000-0000-000000000000", value: 1, observed_at: "yesterday", source: "x" },
      actor,
    );
    expect(badDate).toMatchObject({ isError: true, body: { error: "validation" } });
  });

  it("refuses agent approval and reads skills with their references", async () => {
    const actor = await createTestUser();
    await call("write_file", { path: "skills/ads-audit/SKILL.md", content: "---\nname: ads-audit\n---\n# Ads audit" }, actor);
    await call("write_file", { path: "skills/ads-audit/references/scoring.md", content: "# Scoring" }, actor);
    const skill = await call("read_skill", { name: "ads-audit" }, actor);
    expect(skill.body).toMatchObject({ path: "skills/ads-audit/SKILL.md", references: ["skills/ads-audit/references/scoring.md"] });
    expect(skill.body.text).toContain("# Ads audit");
  });

  it("authenticates bearer tokens into an actor", async () => {
    const actor = await createTestUser("corey@test.local");
    const { token } = await createApiToken(actor.userId, "Claude Desktop");
    const info = await authenticateBearer(token);
    expect(actorFromAuth(info)).toEqual({ kind: "token", userId: actor.userId, label: "Claude Desktop (corey@test.local)" });
    expect(await authenticateBearer(undefined)).toBeUndefined();
    expect(await authenticateBearer("hm_nope")).toBeUndefined();
    expect(() => actorFromAuth(undefined)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/mcp-tools.test.ts`
Expected: FAIL — `@/lib/mcp/*` not found.

- [ ] **Step 3: Implement the runner** — `lib/mcp/run.ts`

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import type { Actor } from "@/lib/services/actor";
import { DomainError } from "@/lib/services/errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef<S extends z.ZodRawShape = any> = {
  name: string;
  description: string;
  input: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: { actor: Actor }) => Promise<unknown>;
};
export type AnyTool = ToolDef;

export const defineTool = <S extends z.ZodRawShape>(t: ToolDef<S>): ToolDef<S> => t;

const text = (value: unknown) => [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];

export async function runTool(tool: AnyTool, rawArgs: unknown, actor: Actor): Promise<CallToolResult> {
  try {
    const args = z.object(tool.input).parse(rawArgs ?? {});
    const result = await tool.handler(args, { actor });
    return { content: text(result) };
  } catch (e) {
    if (e instanceof ZodError) {
      return {
        isError: true,
        content: text({ error: "validation", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }),
      };
    }
    if (e instanceof DomainError) {
      return { isError: true, content: text({ error: e.code, message: e.message, ...e.details }) };
    }
    throw e;
  }
}
```

- [ ] **Step 4: Implement the tools** — `lib/mcp/tools.ts`

```ts
import { z } from "zod";
import { FUNNEL_STAGES } from "@/lib/domain/funnel";
import { SERVICES } from "@/lib/domain/integrations";
import { missingOnboardingQuestions } from "@/lib/domain/questions";
import { CATEGORIES } from "@/lib/domain/scoring";
import { logActivity } from "@/lib/services/activity";
import { recordAudit } from "@/lib/services/audits";
import { getBrandBySlug, listBrands, saveOnboarding } from "@/lib/services/brands";
import { getBrandContext, getPlanQuestions } from "@/lib/services/context";
import { NotFoundError } from "@/lib/services/errors";
import { fileDownloadUrl, listFiles, readFile, writeFile } from "@/lib/services/files";
import { upsertIntegration } from "@/lib/services/integrations";
import { AGENT_STATUSES, createPlanVersion, getNextPlanItem, updatePlanItem } from "@/lib/services/plans";
import { addCheckin, startTracker } from "@/lib/services/trackers";
import { defineTool, type AnyTool } from "./run";

const isoDate = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), "Must be an ISO 8601 date like 2026-10-02 or 2026-10-02T15:00:00Z");
const brandArg = z.string().describe("Brand slug, e.g. superthriftdeals-org (see list_brands)");
const optionalBrand = z.string().optional().describe("Brand slug. Omit for shared files (skills/, workspace/, workflow-templates/).");
const trackerShape = {
  kpi: z.string().describe("Metric name, e.g. 'Organic clicks to /donate'"),
  unit: z.string().optional(),
  direction: z.enum(["up", "down"]).describe("'up' if higher is better, 'down' if lower is better (e.g. CPA)"),
  baseline_value: z.number(),
  baseline_at: isoDate,
  source: z.string().describe("Where the number comes from, e.g. GA4, GSC, Google Ads"),
  window_days: z.number().int().min(1).describe("Days to wait before judging impact"),
  threshold_pct: z.number().positive().optional().describe("Minimum % change that counts as impact (default 5)"),
};
const toTracker = (t: z.infer<z.ZodObject<typeof trackerShape>>) => ({
  kpi: t.kpi,
  unit: t.unit ?? null,
  direction: t.direction,
  baselineValue: t.baseline_value,
  baselineAt: new Date(t.baseline_at),
  source: t.source,
  windowDays: t.window_days,
  thresholdPct: t.threshold_pct,
});
const brandId = async (slug?: string) => (slug ? (await getBrandBySlug(slug)).id : null);

export const tools: AnyTool[] = [
  defineTool({
    name: "list_brands",
    description: "List all client brands with stage, domain, and latest Health score.",
    input: {},
    handler: async () => ({ brands: await listBrands() }),
  }),
  defineTool({
    name: "get_brand_context",
    description:
      "Everything about one brand in a single call: onboarding answers and gaps, Health and delta, latest audit scores, active plan with items, trackers, integrations. Call this first.",
    input: { brand: brandArg },
    handler: async ({ brand }) => getBrandContext(brand),
  }),
  defineTool({
    name: "get_onboarding_questions",
    description: "Onboarding questions still unanswered for a brand. Research the website first and only ask the user what you cannot find.",
    input: { brand: brandArg },
    handler: async ({ brand }) => {
      const b = await getBrandBySlug(brand);
      return { answers: b.onboarding, questions: missingOnboardingQuestions(b.onboarding) };
    },
  }),
  defineTool({
    name: "save_onboarding",
    description: "Merge onboarding answers (keys from get_onboarding_questions) into the brand.",
    input: { brand: brandArg, answers: z.record(z.unknown()) },
    handler: async ({ brand, answers }, { actor }) => {
      const r = await saveOnboarding(brand, answers, actor);
      return { saved: Object.keys(answers), missing: r.missing };
    },
  }),
  defineTool({
    name: "list_files",
    description: "List files for a brand (or shared files when brand is omitted), optionally under a folder prefix like 'audits/'.",
    input: { brand: optionalBrand, prefix: z.string().optional() },
    handler: async ({ brand, prefix }) => ({ files: await listFiles({ brandId: await brandId(brand), prefix }) }),
  }),
  defineTool({
    name: "read_file",
    description: "Read a file. Text files return `text`; binary files return a short-lived `download_url`.",
    input: { brand: optionalBrand, path: z.string(), version: z.number().int().positive().optional() },
    handler: async ({ brand, path, version }) => {
      const id = await brandId(brand);
      const f = await readFile({ brandId: id, path, version });
      return {
        path: f.path,
        version: f.version,
        content_type: f.contentType,
        size: f.size,
        ...(f.text !== null ? { text: f.text } : { download_url: await fileDownloadUrl({ brandId: id, path, version }) }),
      };
    },
  }),
  defineTool({
    name: "write_file",
    description:
      "Create or update a text file. Every write is a new version. Pass expected_version (from read_file) to avoid overwriting someone else's change. Brand folders: audits/, plans/, deliverables/, workflow-results/, ads-audit/, ads-optimize/, data/, memory/, workflows/.",
    input: {
      brand: optionalBrand,
      path: z.string(),
      content: z.string(),
      expected_version: z.number().int().min(0).optional(),
    },
    handler: async ({ brand, path, content, expected_version }, { actor }) => {
      const r = await writeFile({ brandId: await brandId(brand), path, content, expectedVersion: expected_version, actor });
      return { path: r.path, version: r.version, unchanged: r.unchanged };
    },
  }),
  defineTool({
    name: "read_skill",
    description: "Read a shared skill's SKILL.md and list its reference files (read those with read_file when the skill tells you to).",
    input: { name: z.string().describe("Skill folder name, e.g. ads-audit") },
    handler: async ({ name }) => {
      const path = `skills/${name}/SKILL.md`;
      const f = await readFile({ brandId: null, path }).catch(async (e) => {
        if (e instanceof NotFoundError) {
          const all = await listFiles({ brandId: null, prefix: "skills/" });
          const names = [...new Set(all.map((x) => x.path.split("/")[1]))];
          throw new NotFoundError(`Skill "${name}" not found`, names.filter((n) => n.includes(name) || name.includes(n)).slice(0, 5));
        }
        throw e;
      });
      const refs = (await listFiles({ brandId: null, prefix: `skills/${name}/` })).map((x) => x.path).filter((p) => p !== path);
      return { path, version: f.version, text: f.text, references: refs };
    },
  }),
  defineTool({
    name: "record_audit",
    description:
      "Record an audit's category scores (0-100). Save the full report first with write_file under audits/<date>-full-audit.md and pass report_path. Always pass a unique request_id so retries are safe.",
    input: {
      brand: brandArg,
      audited_at: isoDate.optional(),
      report_path: z.string().optional(),
      request_id: z.string().optional(),
      scores: z
        .array(
          z.object({
            category: z.enum(CATEGORIES),
            score: z.number().min(0).max(100),
            target: z.number().min(0).max(100).optional(),
            evidence: z.string().optional(),
          }),
        )
        .min(1),
    },
    handler: async (a, { actor }) =>
      recordAudit({
        brandSlug: a.brand,
        auditedAt: a.audited_at ? new Date(a.audited_at) : undefined,
        reportPath: a.report_path,
        requestId: a.request_id,
        scores: a.scores,
        actor,
      }),
  }),
  defineTool({
    name: "get_plan_questions",
    description: "Plan questions not already answered during onboarding. Ask the user these before create_plan_version.",
    input: { brand: brandArg },
    handler: async ({ brand }) => ({ questions: await getPlanQuestions(brand) }),
  }),
  defineTool({
    name: "create_plan_version",
    description:
      "Create a new plan version (the previous one is archived). Mark anything outward-facing (publishing, ad spend, live site changes) needs_approval: true. Always pass a unique request_id.",
    input: {
      brand: brandArg,
      request_id: z.string().optional(),
      plan: z.object({
        objective: z.string(),
        primary_channel: z.string().optional(),
        secondary_channels: z.array(z.string()).optional(),
        monthly_budget: z.number().min(0).optional(),
        weekly_hours: z.number().min(0).optional(),
        timeline: z.string().optional(),
        summary: z.string().optional(),
        source_audit_id: z.string().uuid().optional(),
        plan_file_path: z.string().optional(),
      }),
      items: z.array(
        z.object({
          title: z.string(),
          description: z.string().optional(),
          funnel_stage: z.enum(FUNNEL_STAGES),
          channel: z.string().optional(),
          priority: z.number().int().optional(),
          expected_kpi: z.string().optional(),
          needs_approval: z.boolean().optional(),
        }),
      ),
    },
    handler: async (a, { actor }) =>
      createPlanVersion({
        brandSlug: a.brand,
        requestId: a.request_id,
        plan: {
          objective: a.plan.objective,
          primaryChannel: a.plan.primary_channel,
          secondaryChannels: a.plan.secondary_channels,
          monthlyBudget: a.plan.monthly_budget,
          weeklyHours: a.plan.weekly_hours,
          timeline: a.plan.timeline,
          summary: a.plan.summary,
          sourceAuditId: a.plan.source_audit_id,
          planFilePath: a.plan.plan_file_path,
        },
        items: a.items.map((i) => ({
          title: i.title,
          description: i.description,
          funnelStage: i.funnel_stage,
          channel: i.channel,
          priority: i.priority,
          expectedKpi: i.expected_kpi,
          needsApproval: i.needs_approval,
        })),
        actor,
      }),
  }),
  defineTool({
    name: "get_next_plan_item",
    description: "The highest-priority plan item that is ready to work (planned, or approved in the app).",
    input: { brand: brandArg },
    handler: async ({ brand }) => ({ item: await getNextPlanItem(brand) }),
  }),
  defineTool({
    name: "update_plan_item",
    description:
      "Update a plan item's status (planned, active, done, blocked), append a note, link files, or attach a tracker. Marking done requires a tracker (pass `tracker` here if none exists). Items needing approval must be approved in the app first.",
    input: {
      item_id: z.string().uuid(),
      status: z.enum(AGENT_STATUSES).optional(),
      note: z.string().optional(),
      link_files: z.array(z.string()).optional(),
      tracker: z.object(trackerShape).optional(),
    },
    handler: async (a, { actor }) => ({
      item: await updatePlanItem({
        itemId: a.item_id,
        status: a.status,
        note: a.note,
        linkFiles: a.link_files,
        tracker: a.tracker ? toTracker(a.tracker) : undefined,
        actor,
      }),
    }),
  }),
  defineTool({
    name: "start_tracker",
    description: "Attach a KPI tracker with a baseline to a plan item.",
    input: { item_id: z.string().uuid(), ...trackerShape },
    handler: async ({ item_id, ...t }, { actor }) => ({
      tracker: await startTracker({ ...toTracker(t), planItemId: item_id, actor }),
    }),
  }),
  defineTool({
    name: "add_checkin",
    description: "Record a new KPI observation for a tracker. Returns the recomputed verdict (pending until the window has passed).",
    input: {
      tracker_id: z.string().uuid(),
      value: z.number(),
      observed_at: isoDate,
      source: z.string(),
      note: z.string().optional(),
    },
    handler: async (a, { actor }) =>
      addCheckin({ trackerId: a.tracker_id, value: a.value, observedAt: new Date(a.observed_at), source: a.source, note: a.note, actor }),
  }),
  defineTool({
    name: "upsert_integration",
    description: "Record which accounts a brand uses (GA4 property, GSC site, Ads customer ID, repo, pages) and whether they are connected.",
    input: {
      brand: brandArg,
      service: z.enum(SERVICES),
      status: z.enum(["connected", "not_connected", "error"]),
      identifiers: z.record(z.string()).optional(),
      notes: z.string().optional(),
    },
    handler: async (a, { actor }) => ({
      integration: await upsertIntegration({
        brandSlug: a.brand,
        service: a.service,
        status: a.status,
        identifiers: a.identifiers,
        notes: a.notes,
        actor,
      }),
    }),
  }),
  defineTool({
    name: "log_activity",
    description: "Add a short entry to the activity history (e.g. a summary of a chat or workflow run).",
    input: { brand: optionalBrand, kind: z.enum(["chat", "workflow"]), summary: z.string().min(1).max(500) },
    handler: async ({ brand, kind, summary }, { actor }) => {
      await logActivity({ brandId: await brandId(brand), actor, kind, summary });
      return { logged: true };
    },
  }),
];

export function findTool(name: string): AnyTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Unknown tool ${name}`);
  return t;
}
```

- [ ] **Step 5: Implement auth and registration**

`lib/mcp/auth.ts`:
```ts
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Actor } from "@/lib/services/actor";
import { verifyApiToken } from "@/lib/services/tokens";

export async function authenticateBearer(bearer: string | undefined): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const t = await verifyApiToken(bearer);
  if (!t) return undefined;
  return {
    token: bearer,
    clientId: t.tokenId,
    scopes: ["workspace"],
    extra: { userId: t.userId, label: `${t.name} (${t.email})` },
  };
}

export function actorFromAuth(info: AuthInfo | undefined): Actor {
  const userId = info?.extra?.userId;
  const label = info?.extra?.label;
  if (typeof userId !== "string" || typeof label !== "string") throw new Error("Unauthenticated MCP request");
  return { kind: "token", userId, label };
}
```

`lib/mcp/register.ts`:
```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { actorFromAuth } from "./auth";
import { runTool } from "./run";
import { tools } from "./tools";

export function registerTools(server: McpServer): void {
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.input, async (args, extra) => runTool(tool, args, actorFromAuth(extra.authInfo)));
  }
}
```

`app/api/[transport]/route.ts`:
```ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { authenticateBearer } from "@/lib/mcp/auth";
import { registerTools } from "@/lib/mcp/register";

export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "hughes-marketing", version: "1.0.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true },
);

const authed = withMcpAuth(handler, (_req, bearer) => authenticateBearer(bearer), { required: true });

export { authed as DELETE, authed as GET, authed as POST };
```
If the installed `mcp-handler` version rejects `serverInfo` or `disableSse`, check its README (`node_modules/mcp-handler/README.md`) and use the equivalent option names — the tool registration and auth wiring stay the same.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm test:int`
Expected: PASS. Then run `pnpm build` — expected: build succeeds with `/api/[transport]` listed as a dynamic route.

- [ ] **Step 7: Commit**

```bash
git add lib/mcp app/api tests/integration/mcp-tools.test.ts
git commit -m "feat(mcp): token-authenticated MCP server exposing the marketing loop"
```

---

### Task 13: Sign-in with Google, allowlist, and the dev bypass

**Files:**
- Create: `lib/auth/bypass.ts`, `lib/auth/supabase-server.ts`, `lib/auth/session.ts`, `middleware.ts`, `app/login/page.tsx`, `app/auth/callback/route.ts`, `app/actions/auth.ts`
- Test: `lib/auth/bypass.test.ts`

**Interfaces:**
- Consumes: `isAllowedEmail`, `upsertUserByEmail`, `SessionUser` (Task 6); `Actor` (Task 6).
- Produces: `bypassEmail(env?: NodeJS.ProcessEnv): string | null`; `createSupabaseServerClient(): Promise<SupabaseClient>`; `requireUser(): Promise<SessionUser>`; `actorFor(user: SessionUser): Actor`; server actions `signInWithGoogle()`, `signOut()`.

- [ ] **Step 1: Write the failing test** — `lib/auth/bypass.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { bypassEmail } from "./bypass";

describe("bypassEmail", () => {
  it("is enabled only with both flags and never on Vercel", () => {
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c" } as NodeJS.ProcessEnv)).toBe("a@b.c");
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "false", AUTH_BYPASS_EMAIL: "a@b.c" } as NodeJS.ProcessEnv)).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true" } as NodeJS.ProcessEnv)).toBeNull();
    expect(bypassEmail({ ALLOW_AUTH_BYPASS: "true", AUTH_BYPASS_EMAIL: "a@b.c", VERCEL: "1" } as NodeJS.ProcessEnv)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/auth/bypass.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/auth/bypass.ts`

```ts
// Local development and E2E only. VERCEL is always set on Vercel deployments, so this can never activate there.
export function bypassEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VERCEL) return null;
  if (env.ALLOW_AUTH_BYPASS !== "true") return null;
  return env.AUTH_BYPASS_EMAIL?.trim().toLowerCase() || null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit lib/auth/bypass.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Supabase client, session helpers, and middleware**

`lib/auth/supabase-server.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component; middleware refreshes the session instead.
        }
      },
    },
  });
}
```

`lib/auth/session.ts`:
```ts
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/services/actor";
import { isAllowedEmail, upsertUserByEmail, type SessionUser } from "@/lib/services/users";
import { bypassEmail } from "./bypass";
import { createSupabaseServerClient } from "./supabase-server";

export async function requireUser(): Promise<SessionUser> {
  const bypass = bypassEmail();
  if (bypass) return upsertUserByEmail({ email: bypass, name: "Local Dev" });
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !isAllowedEmail(user.email)) redirect("/login");
  return upsertUserByEmail({
    email: user.email,
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });
}

export function actorFor(user: SessionUser): Actor {
  return { kind: "user", userId: user.id, label: user.email };
}
```

`middleware.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bypassEmail } from "@/lib/auth/bypass";

export async function middleware(request: NextRequest) {
  if (bypassEmail()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // /api/mcp authenticates with bearer tokens; /login and /auth must stay public.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/mcp|login|auth).*)"],
};
```

- [ ] **Step 6: Implement login, callback, and actions**

`app/actions/auth.ts`:
```ts
"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export async function signInWithGoogle() {
  const supabase = await createSupabaseServerClient();
  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

`app/auth/callback/route.ts`:
```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isAllowedEmail, upsertUserByEmail } from "@/lib/services/users";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  const email = data.user?.email;
  if (error || !email) return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=not_allowed", url.origin));
  }
  await upsertUserByEmail({
    email,
    name: (data.user?.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (data.user?.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  return NextResponse.redirect(new URL("/", url.origin));
}
```

`app/login/page.tsx`:
```tsx
import { signInWithGoogle } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ERRORS: Record<string, string> = {
  not_allowed: "That Google account isn't on the Five Hughes team list.",
  oauth: "Google sign-in failed. Try again.",
  missing_code: "Google sign-in was interrupted. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Hughes Marketing</CardTitle>
          <CardDescription>Sign in with your team Google account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {ERRORS[error] ?? "Sign-in failed."}
            </p>
          )}
          <form action={signInWithGoogle}>
            <Button type="submit" className="w-full">
              Continue with Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7: Verify**

Run: `pnpm test:unit && pnpm build`
Expected: unit tests PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/auth middleware.ts app/login app/auth app/actions/auth.ts
git commit -m "feat(auth): Google sign-in with email allowlist and local-only bypass"
```

---

### Task 14: AI Assets importer

**Files:**
- Create: `lib/import/parse-audit.ts`, `lib/import/parse-plan.ts`, `lib/import/parse-integrations.ts`, `lib/import/run-import.ts`, `scripts/import-ai-assets.ts`, fixture files under `tests/fixtures/ai-assets/`
- Test: `lib/import/parse-audit.test.ts`, `lib/import/parse-plan.test.ts`, `lib/import/parse-integrations.test.ts`, `tests/integration/import.test.ts`

**Interfaces:**
- Consumes: `ensureBrand` (Task 6), `writeFile`, `readFile` (Task 7), `recordAudit` (Task 8), `createPlanVersion` (Task 9), `upsertIntegration` (Task 10), `upsertUserByEmail` (Task 6).
- Produces:
  - `parseAuditMarkdown(md: string): { category: Category; score: number; evidence: string | null }[]`; `auditDateFromFilename(name: string): Date | null`
  - `parsePlanHeader(md: string): { version: number | null; objective: string | null; primaryChannel: string | null; secondaryChannels: string[]; monthlyBudget: number | null; weeklyHours: number | null; timeline: string | null; summary: string | null }`
  - `parseIntegrations(md: string): { service: Service; identifiers: Record<string, string> }[]`
  - `type ImportReport = { brands: string[]; written: number; unchanged: number; skipped: string[]; failed: { path: string; error: string }[]; audits: number; plans: number; integrations: number }`
  - `runImport(root: string, actor: Actor): Promise<ImportReport>`

- [ ] **Step 1: Write the failing parser tests**

`lib/import/parse-audit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { auditDateFromFilename, parseAuditMarkdown } from "./parse-audit";

const SAMPLE = `# Full marketing audit — Roofcoms

## AI Visibility

**Readiness:** 5/100

Roofcoms was mentioned in 0 of 9 tested answers.

**Top findings**

- Absent from all tested recommendations — Roofcoms did not appear in any of the 9 checks.

## GEO
**Readiness:** 86/100
**GEO audit:** status: ready / score: 86/100
## SEO
**Readiness:** 49/100
## Website & Content
**Readiness:** 41/100
- Page speed (fail) — Lighthouse performance 60/100
## Social Media
**Readiness:** 0/100
## Paid Ads
**Readiness:** 75/100
## Site content
## How It Works
**Readiness:** 99/100
`;

describe("parseAuditMarkdown", () => {
  it("extracts the six category readiness scores and first evidence bullet", () => {
    const r = parseAuditMarkdown(SAMPLE);
    expect(r.map((s) => [s.category, s.score])).toEqual([
      ["ai_visibility", 5],
      ["geo", 86],
      ["seo", 49],
      ["website_content", 41],
      ["social", 0],
      ["paid_ads", 75],
    ]);
    expect(r[0].evidence).toMatch(/^Absent from all tested recommendations/);
    expect(r[1].evidence).toBeNull();
  });

  it("returns nothing for documents without readiness sections", () => {
    expect(parseAuditMarkdown("# Ads audit\n\nNo scores here")).toEqual([]);
  });
});

describe("auditDateFromFilename", () => {
  it("reads date and optional time", () => {
    expect(auditDateFromFilename("2026-09-29-123919-full-audit.md")?.toISOString()).toBe("2026-09-29T12:39:19.000Z");
    expect(auditDateFromFilename("2026-09-24-light-audit.md")?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(auditDateFromFilename("report.md")).toBeNull();
  });
});
```

`lib/import/parse-plan.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parsePlanHeader } from "./parse-plan";

const PLAN = `# Current Marketing Plan

_Last refreshed: 2026-09-08T17:17:07.326526+00:00_

Status: active
Version: 13
Source audit: audits/2026-09-08-170920-full-audit.md
Objective: Generate roofing leads and demos over the 90-day sprint.
Primary focus: Paid ads
Secondary focuses: GEO, SEO, AI visibility
Monthly budget: $1,000.00
Weekly bandwidth: 2 hours
Timeline horizon: 90_day

## Summary

Turn Roofcoms' existing site into a lead destination.

## Audit overview
`;

describe("parsePlanHeader", () => {
  it("extracts header fields and the summary paragraph", () => {
    expect(parsePlanHeader(PLAN)).toEqual({
      version: 13,
      objective: "Generate roofing leads and demos over the 90-day sprint.",
      primaryChannel: "Paid ads",
      secondaryChannels: ["GEO", "SEO", "AI visibility"],
      monthlyBudget: 1000,
      weeklyHours: 2,
      timeline: "90_day",
      summary: "Turn Roofcoms' existing site into a lead destination.",
    });
  });

  it("returns nulls for a non-plan document", () => {
    expect(parsePlanHeader("# Something else")).toMatchObject({ version: null, objective: null, secondaryChannels: [] });
  });
});
```

`lib/import/parse-integrations.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseIntegrations } from "./parse-integrations";

const MD = `## Social platforms

- ⚪ LinkedIn → [connect](https://example.com)
- ✅ **Facebook** — connected
    - @SuperThriftPearl  ·  id: 6abb53cd884bd7461851ab33
- ✅ **Google Business Profile** — connected
    - @SuperThrift Pearl  ·  id: 6aaad4498d284ffb21099ae1

## Connected

### Google Analytics ✅
- Properties:
  - \`515827425\` — SuperThrift
### Google Search Console ✅
- Sites:
  - \`sc-domain:superthriftdeals.org\`
### GitHub ✅
- Account: \`verticalconsulting\`
- Repos:
  - \`verticalconsulting/www-verticalconsulting-net\` (default: main)
### Google Ads ✅
- Ad accounts:
  - \`6690622662\` — SuperThrift Pearl
### Gmail ✅
- Connected
### Formspree: Formspree (xzdekbzd) (xzdekbzd) ✅
- Form ID: \`xzdekbzd\`
`;

describe("parseIntegrations", () => {
  it("maps connected services to identifiers", () => {
    expect(parseIntegrations(MD)).toEqual([
      { service: "facebook", identifiers: { handle: "@SuperThriftPearl" } },
      { service: "google_business_profile", identifiers: { handle: "@SuperThrift Pearl" } },
      { service: "ga4", identifiers: { property_id: "515827425" } },
      { service: "gsc", identifiers: { site: "sc-domain:superthriftdeals.org" } },
      { service: "github", identifiers: { account: "verticalconsulting" } },
      { service: "google_ads", identifiers: { customer_id: "6690622662" } },
      { service: "formspree", identifiers: { form_id: "xzdekbzd" } },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/import`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the parsers**

`lib/import/parse-audit.ts`:
```ts
import type { Category } from "@/lib/domain/scoring";

const HEADINGS: Record<string, Category> = {
  "ai visibility": "ai_visibility",
  geo: "geo",
  seo: "seo",
  "website & content": "website_content",
  "social media": "social",
  "paid ads": "paid_ads",
};

export function parseAuditMarkdown(md: string): { category: Category; score: number; evidence: string | null }[] {
  const out: { category: Category; score: number; evidence: string | null }[] = [];
  let current: { category: Category; score: number | null; evidence: string | null } | null = null;
  const flush = () => {
    if (current && current.score !== null) out.push({ category: current.category, score: current.score, evidence: current.evidence });
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const cat = HEADINGS[heading[1].toLowerCase()];
      current = cat && !out.some((o) => o.category === cat) ? { category: cat, score: null, evidence: null } : null;
      continue;
    }
    if (!current) continue;
    const readiness = /\*\*Readiness:\*\*\s*(\d{1,3})\s*\/\s*100/.exec(line);
    if (readiness && current.score === null) {
      current.score = Math.min(100, Number(readiness[1]));
      continue;
    }
    const bullet = /^-\s+(.+)$/.exec(line.trim());
    if (bullet && current.evidence === null && current.score !== null) current.evidence = bullet[1].slice(0, 300);
  }
  flush();
  return out;
}

export function auditDateFromFilename(name: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?-/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}
```

`lib/import/parse-plan.ts`:
```ts
export function parsePlanHeader(md: string) {
  const field = (label: string): string | null => {
    const m = new RegExp(`^${label}:\\s*(.+?)\\s*$`, "mi").exec(md);
    return m ? m[1] : null;
  };
  const num = (s: string | null): number | null => {
    if (!s) return null;
    const m = /-?[\d,]+(?:\.\d+)?/.exec(s);
    return m ? Number(m[0].replace(/,/g, "")) : null;
  };
  // No `m` flag: `$` must mean end of document so multi-paragraph summaries are kept whole.
  const summaryMatch = /(?:^|\n)##\s+Summary[ \t]*\r?\n+([\s\S]*?)(?=\r?\n##\s|$)/.exec(md);
  const version = num(field("Version"));
  return {
    version: version === null ? null : Math.trunc(version),
    objective: field("Objective"),
    primaryChannel: field("Primary focus"),
    secondaryChannels: (field("Secondary focuses") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    monthlyBudget: num(field("Monthly budget")),
    weeklyHours: num(field("Weekly bandwidth")),
    timeline: field("Timeline horizon"),
    summary: summaryMatch ? summaryMatch[1].trim() || null : null,
  };
}
```

`lib/import/parse-integrations.ts`:
```ts
import type { Service } from "@/lib/domain/integrations";

const CONNECTED_HEADINGS: [prefix: string, service: Service, key: string][] = [
  ["Google Analytics", "ga4", "property_id"],
  ["Google Search Console", "gsc", "site"],
  ["Google Ads", "google_ads", "customer_id"],
  ["GitHub", "github", "account"],
  ["Formspree", "formspree", "form_id"],
];
const SOCIAL: Record<string, Service> = { Facebook: "facebook", "Google Business Profile": "google_business_profile" };

export function parseIntegrations(md: string): { service: Service; identifiers: Record<string, string> }[] {
  const out: { service: Service; identifiers: Record<string, string> }[] = [];
  let current: { service: Service; identifiers: Record<string, string>; key: string } | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h3 = /^###\s+(.+?)\s*✅\s*$/.exec(line);
    if (h3) {
      const match = CONNECTED_HEADINGS.find(([prefix]) => h3[1].startsWith(prefix));
      current = match ? { service: match[1], identifiers: {}, key: match[2] } : null;
      if (current) out.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      current = null;
      continue;
    }
    const social = /^-\s+✅\s+\*\*(.+?)\*\*\s+—\s+connected/.exec(line);
    if (social) {
      const service = SOCIAL[social[1]];
      current = service ? { service, identifiers: {}, key: "handle" } : null;
      if (current) out.push(current);
      continue;
    }
    if (!current || current.identifiers[current.key]) continue;
    if (current.key === "handle") {
      const handle = /^-\s+(@.+?)\s+·/.exec(line);
      if (handle) current.identifiers.handle = handle[1].trim();
      continue;
    }
    const code = /`([^`]+)`/.exec(line);
    if (code) current.identifiers[current.key] = code[1];
  }
  return out.map(({ service, identifiers }) => ({ service, identifiers }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit lib/import`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the fixture tree**

`tests/fixtures/ai-assets/Roofcoms.com/audits/2026-09-08-170920-full-audit.md`:
```markdown
# Full marketing audit — Roofcoms

## AI Visibility
**Readiness:** 5/100
## GEO
**Readiness:** 60/100
## SEO
**Readiness:** 40/100
## Website & Content
**Readiness:** 70/100
## Social Media
**Readiness:** 0/100
## Paid Ads
**Readiness:** 20/100
```

`tests/fixtures/ai-assets/Roofcoms.com/PLAN.md`:
```markdown
# Current Marketing Plan

Version: 13
Objective: Generate roofing leads and demos over the 90-day sprint.
Primary focus: Paid ads
Secondary focuses: GEO, SEO
Monthly budget: $1,000.00
Weekly bandwidth: 2 hours
Timeline horizon: 90_day

## Summary

Turn the site into a lead destination.
```

`tests/fixtures/ai-assets/Roofcoms.com/BRAND.md`: `# Brand context — Roof Co`

`tests/fixtures/ai-assets/Superthriftdeals.org/INTEGRATIONS.md`:
````markdown
## Connected

### Google Analytics ✅
- Properties:
  - `515827425` — SuperThrift
````

`tests/fixtures/ai-assets/Superthriftdeals.org/memory/.dreams/events.jsonl`: `{"type":"skip-me"}`

`tests/fixtures/ai-assets/Hughes Files/skills/ads/SKILL.md`:
```markdown
---
name: ads
description: "Plan paid campaigns."
---
# Ads
```

`tests/fixtures/ai-assets/_Personal-Automations/secret.md`: `do not import`

`tests/fixtures/ai-assets/desktop.ini`: `[.ShellClassInfo]`

`tests/fixtures/ai-assets/README.md`: `# Root readme`

- [ ] **Step 6: Write the failing importer test** — `tests/integration/import.test.ts`

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { runImport } from "@/lib/import/run-import";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { listFiles, readFile } from "@/lib/services/files";
import { listIntegrations } from "@/lib/services/integrations";
import { getActivePlan } from "@/lib/services/plans";

const ROOT = path.resolve("tests/fixtures/ai-assets");

describe("runImport", () => {
  it("imports brands, files, audits, plans, integrations, and shared skills", async () => {
    const actor = await createTestUser();
    const report = await runImport(ROOT, actor);
    expect(report.failed).toEqual([]);
    expect(report.brands.sort()).toEqual(["roofcoms-com", "superthriftdeals-org"]);
    expect(report.audits).toBe(1);
    expect(report.plans).toBe(1);
    expect(report.integrations).toBe(1);
    expect(report.skipped).toEqual(expect.arrayContaining(["README.md", "desktop.ini", "_Personal-Automations"]));

    const roof = await getBrandBySlug("roofcoms-com");
    expect(roof).toMatchObject({ name: "Roof Co", domain: "roofcoms.com", stage: "planned" });
    const [audit] = await listAudits(roof.id);
    expect(audit).toMatchObject({ health: 35, reportPath: "audits/2026-09-08-170920-full-audit.md" });
    const plan = await getActivePlan(roof.id);
    expect(plan).toMatchObject({ objective: "Generate roofing leads and demos over the 90-day sprint.", monthlyBudget: 1000, planFilePath: "PLAN.md" });

    const st = await getBrandBySlug("superthriftdeals-org");
    expect(st.name).toBe("SuperThrift");
    expect(await listIntegrations(st.id)).toEqual([expect.objectContaining({ service: "ga4", identifiers: { property_id: "515827425" } })]);
    expect((await listFiles({ brandId: st.id })).map((f) => f.path)).toEqual(["INTEGRATIONS.md"]);

    expect((await readFile({ brandId: null, path: "skills/ads/SKILL.md" })).text).toContain("# Ads");
    const everything = [...(await listFiles({ brandId: null })), ...(await listFiles({ brandId: roof.id }))];
    expect(everything.some((f) => f.path.includes("secret"))).toBe(false);
  });

  it("is idempotent", async () => {
    const actor = await createTestUser();
    const first = await runImport(ROOT, actor);
    const second = await runImport(ROOT, actor);
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(first.written);
    expect(second.audits).toBe(0);
    expect(second.plans).toBe(0);
    expect(await listAudits((await getBrandBySlug("roofcoms-com")).id)).toHaveLength(1);
  });
});
```
Roof Co health: (5·20 + 60·15 + 40·20 + 70·20 + 0·10 + 20·15) / 100 = (100 + 900 + 800 + 1400 + 0 + 300) / 100 = **35**.

- [ ] **Step 7: Run to verify failure**

Run: `pnpm vitest run --project integration tests/integration/import.test.ts`
Expected: FAIL — `@/lib/import/run-import` not found.

- [ ] **Step 8: Implement** — `lib/import/run-import.ts`

```ts
import { readdir, readFile as readFs } from "node:fs/promises";
import path from "node:path";
import { normalizeDomain } from "@/lib/domain/text";
import type { Actor } from "@/lib/services/actor";
import { recordAudit } from "@/lib/services/audits";
import { ensureBrand } from "@/lib/services/brands";
import { createPlanVersion } from "@/lib/services/plans";
import { upsertIntegration } from "@/lib/services/integrations";
import { writeFile } from "@/lib/services/files";
import { auditDateFromFilename, parseAuditMarkdown } from "./parse-audit";
import { parseIntegrations } from "./parse-integrations";
import { parsePlanHeader } from "./parse-plan";

const SHARED_FOLDER = "Hughes Files";
const EXCLUDED_FOLDERS = new Set(["_Personal-Automations", "_Duplicates-to-delete"]);
const EXCLUDED_FILES = new Set(["desktop.ini", "Thumbs.db"]);

const BRAND_OVERRIDES: Record<string, { name: string; domain: string }> = {
  "Mercyhouseatc.com": { name: "Mercy House ATC", domain: "mercyhouseatc.com" },
  "Mercyhouseatc.com-vehicledonation": { name: "Mercy House Vehicle Donation", domain: "vehicledonationms.com" },
  "Superthriftdeals.org": { name: "SuperThrift", domain: "superthriftdeals.org" },
  "Bradleybrowninc.com": { name: "Bradley Brown Inc.", domain: "bradleybrowninc.com" },
  "Midstatewelding.com": { name: "Mid-State Welding", domain: "midstatewelding.com" },
  "Myelitegutters.com": { name: "Elite Gutters", domain: "myelitegutters.com" },
  "Roofcoms.com": { name: "Roof Co", domain: "roofcoms.com" },
};

export type ImportReport = {
  brands: string[];
  written: number;
  unchanged: number;
  skipped: string[];
  failed: { path: string; error: string }[];
  audits: number;
  plans: number;
  integrations: number;
};

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || EXCLUDED_FILES.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

export async function runImport(root: string, actor: Actor): Promise<ImportReport> {
  const report: ImportReport = { brands: [], written: 0, unchanged: 0, skipped: [], failed: [], audits: 0, plans: 0, integrations: 0 };

  const importFiles = async (dir: string, brandId: string | null) => {
    for (const rel of await walk(dir)) {
      try {
        const bytes = new Uint8Array(await readFs(path.join(dir, rel)));
        const r = await writeFile({ brandId, path: rel, content: bytes, actor, quiet: true });
        if (r.unchanged) report.unchanged++;
        else report.written++;
      } catch (e) {
        report.failed.push({ path: path.join(dir, rel), error: (e as Error).message });
      }
    }
  };

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      report.skipped.push(entry.name);
      continue;
    }
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_FOLDERS.has(entry.name)) {
      report.skipped.push(entry.name);
      continue;
    }
    const dir = path.join(root, entry.name);
    if (entry.name === SHARED_FOLDER) {
      await importFiles(dir, null);
      continue;
    }

    const override = BRAND_OVERRIDES[entry.name];
    const brand = await ensureBrand({
      name: override?.name ?? entry.name,
      slug: entry.name,
      domain: override?.domain ?? (entry.name.includes(".") ? normalizeDomain(entry.name) : null),
      actor,
    });
    report.brands.push(brand.slug);
    await importFiles(dir, brand.id);

    const auditsDir = path.join(dir, "audits");
    const auditFiles = (await readdir(auditsDir).catch(() => [] as string[])).filter((f) => f.endsWith("-audit.md")).sort();
    for (const name of auditFiles) {
      try {
        const scores = parseAuditMarkdown(await readFs(path.join(auditsDir, name), "utf8"));
        if (scores.length === 0) continue;
        const r = await recordAudit({
          brandSlug: brand.slug,
          auditedAt: auditDateFromFilename(name) ?? undefined,
          reportPath: `audits/${name}`,
          scores: scores.map((s) => ({ category: s.category, score: s.score, evidence: s.evidence })),
          requestId: `import:${brand.slug}:audits/${name}`,
          actor,
        });
        if (!r.duplicate) report.audits++;
      } catch (e) {
        report.failed.push({ path: path.join(auditsDir, name), error: (e as Error).message });
      }
    }

    const planMd = await readFs(path.join(dir, "PLAN.md"), "utf8").catch(() => null);
    if (planMd) {
      const h = parsePlanHeader(planMd);
      if (h.objective) {
        const r = await createPlanVersion({
          brandSlug: brand.slug,
          requestId: `import:${brand.slug}:PLAN.md`,
          plan: {
            objective: h.objective,
            primaryChannel: h.primaryChannel,
            secondaryChannels: h.secondaryChannels,
            monthlyBudget: h.monthlyBudget,
            weeklyHours: h.weeklyHours,
            timeline: h.timeline,
            summary: h.summary,
            planFilePath: "PLAN.md",
          },
          items: [],
          actor,
        });
        if (!r.duplicate) report.plans++;
      }
    }

    const integrationsMd = await readFs(path.join(dir, "INTEGRATIONS.md"), "utf8").catch(() => null);
    if (integrationsMd) {
      for (const i of parseIntegrations(integrationsMd)) {
        await upsertIntegration({ brandSlug: brand.slug, service: i.service, status: "connected", identifiers: i.identifiers, actor });
        report.integrations++;
      }
    }
  }
  return report;
}
```

Integration upserts are naturally idempotent, so the idempotency test does not assert `second.integrations`.

- [ ] **Step 9: Implement the CLI** — `scripts/import-ai-assets.ts`

```ts
import { sql } from "@/lib/data/db";
import { getEnv } from "@/lib/env";
import { runImport } from "@/lib/import/run-import";
import { upsertUserByEmail } from "@/lib/services/users";

const root = process.argv[2];
if (!root) {
  console.error('Usage: pnpm import:ai-assets "C:/Users/you/Google Drive Streaming/My Drive/AI Assets"');
  process.exit(2);
}
const email = process.env.IMPORT_AS_EMAIL ?? getEnv().ALLOWED_EMAILS[0];
if (!email) {
  console.error("Set IMPORT_AS_EMAIL or ALLOWED_EMAILS so imported changes have an author.");
  process.exit(2);
}
const user = await upsertUserByEmail({ email });
const report = await runImport(root, { kind: "user", userId: user.id, label: `import (${email})` });
console.log(`Brands: ${report.brands.join(", ")}`);
console.log(`Files written: ${report.written}, unchanged: ${report.unchanged}`);
console.log(`Audits: ${report.audits}, plans: ${report.plans}, integrations: ${report.integrations}`);
console.log(`Skipped: ${report.skipped.join(", ") || "none"}`);
for (const f of report.failed) console.error(`FAILED ${f.path}: ${f.error}`);
await sql.end();
process.exit(report.failed.length > 0 ? 1 : 0);
```

- [ ] **Step 10: Run all tests**

Run: `pnpm test`
Expected: PASS (unit + integration).

- [ ] **Step 11: Commit**

```bash
git add lib/import scripts/import-ai-assets.ts tests/fixtures tests/integration/import.test.ts
git commit -m "feat(import): idempotent AI Assets importer for brands, files, audits, plans, integrations"
```

### Task 15: Theme, prompts, and the workspace shell

**Files:**
- Create: `lib/prompts.ts`, `lib/prompts.test.ts`, `lib/action-result.ts`, `app/actions/brands.ts`, `app/b/[slug]/layout.tsx`, `app/b/[slug]/page.tsx`, `components/workspace/{top-bar,brand-switcher,add-brand-dialog,tab-nav,health-pill,stage-badge,sidebar,activity-list,get-started,copy-button,workspace-panels}.tsx`
- Modify: `app/globals.css` (replace), `app/layout.tsx` (replace), `app/page.tsx` (replace)

**Interfaces:**
- Consumes: services from Tasks 6–11, `requireUser`, `actorFor` (Task 13), `groupByRecency`, `gettingStarted` (Task 4), `band` (Task 2).
- Produces:
  - `type PromptKind = "onboard" | "audit" | "plan" | "execute" | "checkin"`; `PROMPT_LABELS: Record<PromptKind, string>`; `agentPrompt(kind: PromptKind, brand: { name: string; slug: string; domain: string | null }): string`
  - `type Result<T> = { ok: true; data: T } | { ok: false; error: string }`; `attempt<T>(fn: () => Promise<T>): Promise<Result<T>>`
  - `createBrandAction(prev: { error?: string }, formData: FormData): Promise<{ error?: string }>` (redirects to `/b/<slug>/plan` on success)
  - Components: `<CopyButton text label? variant? />`, `<HealthPill health delta />`, `<StageBadge stage />`, `<AddBrandDialog trigger />`, `<WorkspacePanels brandSlug>{main}</WorkspacePanels>` (renders `<RightPane brandSlug />` from Task 17 — until Task 17 lands, import a placeholder: see Step 9)
  - CSS tokens: `--funnel-{acquisition,activation,retention,referral,revenue}`, `--band-{red,amber,green}`; Tailwind colors `funnel-*`, `band-*`; fonts `font-sans` (Inter), `font-display` (Fraunces)

- [ ] **Step 1: Write the failing prompts test** — `lib/prompts.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { agentPrompt, PROMPT_LABELS } from "./prompts";

const brand = { name: "Roof Co", slug: "roofcoms-com", domain: "roofcoms.com" };

describe("agentPrompt", () => {
  it("names the brand slug and the right MCP tools for each stage", () => {
    expect(agentPrompt("onboard", brand)).toContain('get_brand_context with brand "roofcoms-com"');
    expect(agentPrompt("onboard", brand)).toContain("https://roofcoms.com");
    expect(agentPrompt("audit", brand)).toMatch(/record_audit[\s\S]*request_id/);
    expect(agentPrompt("plan", brand)).toContain("get_plan_questions");
    expect(agentPrompt("execute", brand)).toContain("get_next_plan_item");
    expect(agentPrompt("checkin", brand)).toContain("add_checkin");
    expect(Object.keys(PROMPT_LABELS)).toEqual(["onboard", "audit", "plan", "execute", "checkin"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run --project unit lib/prompts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `lib/prompts.ts`

```ts
export type PromptKind = "onboard" | "audit" | "plan" | "execute" | "checkin";

export const PROMPT_LABELS: Record<PromptKind, string> = {
  onboard: "Onboard the brand",
  audit: "Run an audit",
  plan: "Build the plan",
  execute: "Work the next plan item",
  checkin: "Check in on trackers",
};

export function agentPrompt(kind: PromptKind, b: { name: string; slug: string; domain: string | null }): string {
  const site = b.domain ? `https://${b.domain}` : "the brand's website";
  const intro = `You are working on the brand "${b.name}" in the Hughes Marketing workspace through the hughes-marketing MCP server. Start by calling get_brand_context with brand "${b.slug}".`;
  const today = "<today's date as YYYY-MM-DD>";
  switch (kind) {
    case "onboard":
      return `${intro}

Onboard this brand:
1. Call get_onboarding_questions.
2. Research ${site} with the browser (Claude in Chrome) and answer everything you can from the site and public sources.
3. Ask me only the questions you could not answer, all in one message.
4. Save the answers with save_onboarding.
5. Write BRAND.md (essence, voice, audience, positioning, visual identity, with sources) using write_file.
6. Record the brand's accounts with upsert_integration (GA4 property, Search Console site, Google Ads customer ID, GitHub repo, social pages).
Finish with log_activity summarizing what you did.`;
    case "audit":
      return `${intro}

Run a full marketing audit of ${site}:
1. Use read_skill for "ai-seo" and "site-architecture" (and "ads-audit" if the brand runs paid ads) and follow them.
2. Use the browser and your connected tools to gather evidence. Separate measured facts from inferences.
3. Score six categories from 0 to 100, each with one line of evidence and a realistic target: ai_visibility, geo, seo, website_content, social, paid_ads.
4. Save the full report with write_file to audits/${today}-full-audit.md.
5. Call record_audit with the scores, report_path, audited_at, and request_id "audit-${b.slug}-${today}".
Tell me the Health score and how it changed since the last audit.`;
    case "plan":
      return `${intro}

Build the marketing plan:
1. Call get_plan_questions and ask me those questions.
2. Using the latest audit and my answers, draft a plan: objective, primary and secondary channels, monthly budget, timeline, and 5–10 items. Each item needs a funnel_stage, priority (1 = do first), and expected_kpi. Set needs_approval: true for anything that publishes content, spends money, or changes the live site.
3. Save the plan narrative with write_file to plans/${today}-plan.md.
4. Call create_plan_version with plan_file_path set to that file and request_id "plan-${b.slug}-${today}".
Summarize the plan for me in a short list.`;
    case "execute":
      return `${intro}

Work the plan:
1. Call get_next_plan_item. If it returns nothing, tell me what is waiting for approval and stop.
2. Read the matching skill with read_skill and follow it. Use the browser when you need to.
3. Save deliverables with write_file under deliverables/ or workflow-results/.
4. Call update_plan_item with link_files, a short note, and status "done" plus a tracker: the KPI this item should move, direction, the real current value as baseline_value with baseline_at, the data source, and window_days for when impact should show.
If the work needs something published, spent, or changed live, stop and tell me — I approve it in the app.`;
    case "checkin":
      return `${intro}

Check in on impact:
1. For every tracker in the context whose verdict is pending, get the current KPI value from its source (GA4, Search Console, Google Ads, or the site).
2. Call add_checkin with the value, observed_at, and source.
3. Report each verdict (positive, neutral, negative, or still measuring).
If the latest audit is more than 30 days old, recommend rerunning the audit.`;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run --project unit lib/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Add typography and replace the theme** — run `pnpm add -D @tailwindcss/typography`, then replace `app/globals.css` with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (@media (prefers-color-scheme: dark));

:root {
  --radius: 0.75rem;
  --background: #fafaf9;
  --foreground: #1c1917;
  --card: #ffffff;
  --card-foreground: #1c1917;
  --popover: #ffffff;
  --popover-foreground: #1c1917;
  --primary: #4f46e5;
  --primary-foreground: #ffffff;
  --secondary: #eef2ff;
  --secondary-foreground: #3730a3;
  --muted: #f5f5f4;
  --muted-foreground: #57534e;
  --accent: #eef2ff;
  --accent-foreground: #3730a3;
  --destructive: #dc2626;
  --border: #e7e5e4;
  --input: #e7e5e4;
  --ring: #6366f1;
  --sidebar: #f5f5f4;
  --funnel-acquisition: #3b82f6;
  --funnel-activation: #14b8a6;
  --funnel-retention: #8b5cf6;
  --funnel-referral: #f59e0b;
  --funnel-revenue: #22c55e;
  --band-red: #dc2626;
  --band-amber: #d97706;
  --band-green: #16a34a;
  --chart-1: #4f46e5;
  --chart-2: #0ea5e9;
  --chart-3: #14b8a6;
  --chart-4: #f59e0b;
  --chart-5: #ec4899;
  --chart-6: #22c55e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0c0a09;
    --foreground: #fafaf9;
    --card: #1c1917;
    --card-foreground: #fafaf9;
    --popover: #1c1917;
    --popover-foreground: #fafaf9;
    --primary: #818cf8;
    --primary-foreground: #1e1b4b;
    --secondary: #1e1b4b;
    --secondary-foreground: #c7d2fe;
    --muted: #292524;
    --muted-foreground: #a8a29e;
    --accent: #1e1b4b;
    --accent-foreground: #c7d2fe;
    --destructive: #f87171;
    --border: #292524;
    --input: #3f3f46;
    --ring: #818cf8;
    --sidebar: #141210;
    --funnel-acquisition: #60a5fa;
    --funnel-activation: #2dd4bf;
    --funnel-retention: #a78bfa;
    --funnel-referral: #fbbf24;
    --funnel-revenue: #4ade80;
    --band-red: #f87171;
    --band-amber: #fbbf24;
    --band-green: #4ade80;
    --chart-1: #818cf8;
    --chart-2: #38bdf8;
    --chart-3: #2dd4bf;
    --chart-4: #fbbf24;
    --chart-5: #f472b6;
    --chart-6: #4ade80;
  }
  .hljs {
    background: var(--muted) !important;
    color: var(--foreground) !important;
  }
}

@theme inline {
  --font-sans: var(--font-inter);
  --font-display: var(--font-fraunces);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-funnel-acquisition: var(--funnel-acquisition);
  --color-funnel-activation: var(--funnel-activation);
  --color-funnel-retention: var(--funnel-retention);
  --color-funnel-referral: var(--funnel-referral);
  --color-funnel-revenue: var(--funnel-revenue);
  --color-band-red: var(--band-red);
  --color-band-amber: var(--band-amber);
  --color-band-green: var(--band-green);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-chart-6: var(--chart-6);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 6: Replace the root layout and home page**

`app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "highlight.js/styles/github.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });

export const metadata: Metadata = { title: "Hughes Marketing", description: "Five Hughes LLC marketing workspace" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="font-sans antialiased">
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}
```

`app/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { AddBrandDialog } from "@/components/workspace/add-brand-dialog";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/services/brands";

export default async function Home() {
  await requireUser();
  const brands = await listBrands();
  if (brands.length > 0) redirect(`/b/${brands[0].slug}/plan`);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="font-display text-3xl">Add your first brand</h1>
        <p className="text-muted-foreground">
          Add a client brand, then connect Claude Desktop to onboard it, run an audit, and build a plan.
        </p>
        <AddBrandDialog trigger={<Button size="lg">Add brand</Button>} />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Action helper and brand action**

`lib/action-result.ts`:
```ts
import { DomainError } from "@/lib/services/errors";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    throw e;
  }
}
```

`app/actions/brands.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { createBrand } from "@/lib/services/brands";

export async function createBrandAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const r = await attempt(() =>
    createBrand({
      name: String(formData.get("name") ?? ""),
      domain: String(formData.get("domain") ?? "").trim() || null,
      actor: actorFor(user),
    }),
  );
  if (!r.ok) return { error: r.error };
  redirect(`/b/${r.data.slug}/plan`);
}
```

- [ ] **Step 8: Small shared components**

`components/workspace/copy-button.tsx`:
```tsx
"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  size = "sm",
  toastMessage = "Copied — paste it into Claude Desktop",
}: {
  text: string;
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  size?: "sm" | "default";
  toastMessage?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        toast.success(toastMessage);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label}
    </Button>
  );
}
```

`components/workspace/health-pill.tsx`:
```tsx
import { Activity } from "lucide-react";
import { band } from "@/lib/domain/scoring";
import { cn } from "@/lib/utils";

const BAND_CLASS = {
  red: "bg-band-red/10 text-band-red",
  amber: "bg-band-amber/10 text-band-amber",
  green: "bg-band-green/10 text-band-green",
} as const;

export function HealthPill({ health, delta }: { health: number | null; delta: number | null }) {
  const cls = health === null ? "bg-muted text-muted-foreground" : BAND_CLASS[band(health)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", cls)}>
      <Activity className="size-3.5" />
      Health {health ?? "—"}
      {delta !== null && delta !== 0 && (
        <span className={delta > 0 ? "text-band-green" : "text-band-red"}>
          {delta > 0 ? "▲" : "▼"}
          {Math.abs(delta)}
        </span>
      )}
    </span>
  );
}
```

`components/workspace/stage-badge.tsx`:
```tsx
import { cn } from "@/lib/utils";

const STAGES = {
  onboarding: { label: "Onboarding", cls: "bg-chart-2/15 text-chart-2" },
  audited: { label: "Audited", cls: "bg-chart-4/15 text-chart-4" },
  planned: { label: "Planned", cls: "bg-primary/15 text-primary" },
  executing: { label: "Executing", cls: "bg-chart-6/15 text-chart-6" },
} as const;

export function StageBadge({ stage }: { stage: keyof typeof STAGES }) {
  const s = STAGES[stage];
  return <span className={cn("hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline", s.cls)}>{s.label}</span>;
}
```

`components/workspace/add-brand-dialog.tsx`:
```tsx
"use client";
import { useActionState, useState } from "react";
import { createBrandAction } from "@/app/actions/brands";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AddBrandDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlledOpen ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const [state, action, pending] = useActionState(createBrandAction, {});
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a brand</DialogTitle>
          <DialogDescription>Create the client workspace. Onboarding happens next, through Claude Desktop.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brand-name">Brand name</Label>
            <Input id="brand-name" name="name" required placeholder="SuperThrift" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-domain">Website</Label>
            <Input id="brand-domain" name="domain" placeholder="superthriftdeals.org" />
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating…" : "Create brand"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`components/workspace/brand-switcher.tsx`:
```tsx
"use client";
import { ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BrandSummary } from "@/lib/services/brands";
import { AddBrandDialog } from "./add-brand-dialog";

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold text-white" style={{ background: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function BrandSwitcher({ brands, current }: { brands: BrandSummary[]; current: BrandSummary }) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-2 font-medium">
            <Avatar name={current.name} color={current.color} />
            <span className="max-w-40 truncate">{current.name}</span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Brands</DropdownMenuLabel>
          {brands.map((b) => (
            <DropdownMenuItem key={b.id} asChild>
              <Link href={`/b/${b.slug}/plan`} className="flex items-center gap-2">
                <Avatar name={b.name} color={b.color} />
                <span className="flex-1 truncate">{b.name}</span>
                <span className="text-xs text-muted-foreground">{b.health ?? "—"}</span>
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <Plus className="size-4" /> Add brand
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddBrandDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
```

`components/workspace/tab-nav.tsx`:
```tsx
"use client";
import { BarChart3, Bot, CalendarDays, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "agent", label: "Agent", icon: Bot },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "plan", label: "Plan", icon: ClipboardList },
  { key: "briefs", label: "Briefs", icon: FileText },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
] as const;

export function TabNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex items-center gap-1 rounded-full bg-muted p-1">
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = pathname.startsWith(`/b/${slug}/${key}`);
        return (
          <Link
            key={key}
            href={`/b/${slug}/${key}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-card text-primary shadow-sm",
            )}
          >
            <Icon className="size-4" />
            <span className="hidden lg:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

`components/workspace/top-bar.tsx`:
```tsx
import Link from "next/link";
import type { BrandSummary } from "@/lib/services/brands";
import { BrandSwitcher } from "./brand-switcher";
import { BrowserDialog } from "./browser-dialog";
import { HealthPill } from "./health-pill";
import { McpDialog } from "./mcp-dialog";
import { StageBadge } from "./stage-badge";
import { TabNav } from "./tab-nav";

export function TopBar({ brands, current, origin }: { brands: BrandSummary[]; current: BrandSummary; origin: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
      <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">H</span>
        <span className="hidden xl:inline">Five Hughes LLC</span>
      </Link>
      <span className="text-muted-foreground">/</span>
      <BrandSwitcher brands={brands} current={current} />
      <HealthPill health={current.health} delta={current.delta} />
      <StageBadge stage={current.stage} />
      <div className="mx-auto">
        <TabNav slug={current.slug} />
      </div>
      <div className="flex items-center gap-2">
        <BrowserDialog brand={current} />
        <McpDialog origin={origin} />
      </div>
    </header>
  );
}
```

- [ ] **Step 9: Sidebar, activity list, checklist, and panel layout**

`components/workspace/activity-list.tsx`:
```tsx
"use client";
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  MessageSquare,
  Plug,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { groupByRecency } from "@/lib/domain/dates";
import type { ActivityRow } from "@/lib/services/activity";

const KIND: Record<ActivityRow["kind"], { icon: LucideIcon; cls: string }> = {
  brand: { icon: Building2, cls: "text-primary" },
  chat: { icon: MessageSquare, cls: "text-chart-2" },
  workflow: { icon: Workflow, cls: "text-funnel-retention" },
  audit: { icon: Gauge, cls: "text-band-amber" },
  plan: { icon: ClipboardList, cls: "text-funnel-activation" },
  approval: { icon: CheckCircle2, cls: "text-band-green" },
  file: { icon: FileText, cls: "text-muted-foreground" },
  tracker: { icon: TrendingUp, cls: "text-chart-5" },
  integration: { icon: Plug, cls: "text-chart-2" },
};

export function ActivityList({ items }: { items: ActivityRow[] }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const filtered = q ? items.filter((i) => i.summary.toLowerCase().includes(q.toLowerCase())) : items;
    return groupByRecency(filtered, new Date());
  }, [items, q]);
  const sections = [
    ["Today", groups.today],
    ["Previous 7 Days", groups.last7],
    ["Previous 14 Days", groups.last14],
    ["Older", groups.older],
  ] as const;
  return (
    <div className="space-y-4">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity…" className="h-8" />
      {sections.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title}>
            <h3 className="mb-1 px-1 text-xs font-medium text-muted-foreground">{title}</h3>
            <ul className="space-y-0.5">
              {list.map((a) => {
                const { icon: Icon, cls } = KIND[a.kind];
                return (
                  <li key={a.id} title={`${a.actorLabel} · ${a.createdAt.toLocaleString()}`} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} />
                    <span className="line-clamp-2">{a.summary}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
      {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">No activity yet.</p>}
    </div>
  );
}
```

`components/workspace/get-started.tsx`:
```tsx
import { CheckCircle2, Circle } from "lucide-react";

export function GetStarted({ steps }: { steps: { key: string; label: string; done: boolean }[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <details className="rounded-lg border bg-card p-2 text-sm" open={done < steps.length}>
      <summary className="flex cursor-pointer items-center justify-between font-medium">
        Get started <span className="text-xs text-muted-foreground">{done}/{steps.length}</span>
      </summary>
      <ul className="mt-2 space-y-1">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            {s.done ? <CheckCircle2 className="size-4 text-band-green" /> : <Circle className="size-4 text-muted-foreground" />}
            <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
```

`components/workspace/sidebar.tsx`:
```tsx
import { Bell, FileText, LogOut, Pin } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityRow } from "@/lib/services/activity";
import type { SessionUser } from "@/lib/services/users";
import { ActivityList } from "./activity-list";
import { GetStarted } from "./get-started";

export function Sidebar({
  user,
  slug,
  activity,
  pending,
  steps,
}: {
  user: SessionUser;
  slug: string;
  activity: ActivityRow[];
  pending: number;
  steps: { key: string; label: string; done: boolean }[];
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="space-y-1 p-3">
        <h3 className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
          <Pin className="size-3" /> Pinned
        </h3>
        {["BRAND.md", "PLAN.md"].map((file) => (
          <Link key={file} href={`/b/${slug}/plan?pane=assets&file=${file}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
            <FileText className="size-4 text-primary" /> {file}
          </Link>
        ))}
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3">
        <ActivityList items={activity} />
      </ScrollArea>
      <div className="space-y-2 border-t p-3">
        <GetStarted steps={steps} />
        <Link href={`/b/${slug}/plan#approvals`} className="flex items-center justify-between rounded-md px-1 py-1 text-sm hover:bg-muted">
          <span className="flex items-center gap-2">
            <Bell className="size-4" /> Approvals
          </span>
          {pending > 0 && <span className="rounded-full bg-band-amber px-2 text-xs font-semibold text-white">{pending}</span>}
        </Link>
        <form action={signOut} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{user.name ?? user.email}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <button type="submit" aria-label="Sign out" className="rounded-md p-1 hover:bg-muted">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </aside>
  );
}
```

`components/workspace/workspace-panels.tsx`:
```tsx
"use client";
import { PanelRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RightPane } from "./right-pane";

export function WorkspacePanels({ brandSlug, children }: { brandSlug: string; children: React.ReactNode }) {
  const [mobilePane, setMobilePane] = useState<"main" | "side">("main");
  return (
    <>
      <div className="hidden min-w-0 flex-1 lg:flex">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={58} minSize={35}>
            <main className="h-full overflow-y-auto">{children}</main>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={25} collapsible collapsedSize={0}>
            <RightPane brandSlug={brandSlug} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <div className="flex min-w-0 flex-1 flex-col lg:hidden">
        <div className="flex justify-end border-b p-1">
          <Button variant="ghost" size="sm" onClick={() => setMobilePane(mobilePane === "main" ? "side" : "main")}>
            <PanelRight className="size-4" /> {mobilePane === "main" ? "Files & tools" : "Back to workspace"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{mobilePane === "main" ? children : <RightPane brandSlug={brandSlug} />}</div>
      </div>
    </>
  );
}
```

Until Task 17, create a stub so the app compiles — `components/workspace/right-pane.tsx`:
```tsx
"use client";
export function RightPane({ brandSlug }: { brandSlug: string }) {
  return <div className="p-4 text-sm text-muted-foreground">Files for {brandSlug} load here.</div>;
}
```
And stubs for the dialogs (replaced in Task 18) — `components/workspace/browser-dialog.tsx`:
```tsx
"use client";
import type { BrandSummary } from "@/lib/services/brands";
export function BrowserDialog(_: { brand: BrandSummary }) {
  return null;
}
```
`components/workspace/mcp-dialog.tsx`:
```tsx
"use client";
export function McpDialog(_: { origin: string }) {
  return null;
}
```

- [ ] **Step 10: Workspace layout and redirect**

`app/b/[slug]/layout.tsx`:
```tsx
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Sidebar } from "@/components/workspace/sidebar";
import { TopBar } from "@/components/workspace/top-bar";
import { WorkspacePanels } from "@/components/workspace/workspace-panels";
import { requireUser } from "@/lib/auth/session";
import { gettingStarted } from "@/lib/domain/checklist";
import { listActivity } from "@/lib/services/activity";
import { listBrands } from "@/lib/services/brands";
import { getBrandContext } from "@/lib/services/context";
import { NotFoundError } from "@/lib/services/errors";
import { countPendingApprovals } from "@/lib/services/plans";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ctx = await getBrandContext(slug).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [brands, pending] = await Promise.all([listBrands(), countPendingApprovals()]);
  const current = brands.find((b) => b.slug === slug)!;
  const activity = await listActivity({ brandId: current.id, limit: 80 });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const steps = gettingStarted({
    onboardingMissing: ctx.onboarding.missing.length,
    auditCount: ctx.latestAudit ? 1 : 0,
    hasPlan: ctx.activePlan !== null,
    doneItems: ctx.activePlan?.items.filter((i) => i.status === "done").length ?? 0,
    decidedVerdicts: ctx.trackers.filter((t) => t.verdict !== "pending").length,
  });
  return (
    <div className="flex h-dvh flex-col">
      <TopBar brands={brands} current={current} origin={origin} />
      <div className="flex min-h-0 flex-1">
        <Sidebar user={user} slug={slug} activity={activity} pending={pending} steps={steps} />
        <WorkspacePanels brandSlug={slug}>{children}</WorkspacePanels>
      </div>
    </div>
  );
}
```

`app/b/[slug]/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default async function BrandIndex({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/b/${slug}/plan`);
}
```

Create `app/b/[slug]/plan/page.tsx` temporarily so the redirect resolves (replaced in Task 16):
```tsx
export default function PlanPage() {
  return <div className="p-6">Plan</div>;
}
```

- [ ] **Step 11: Verify in the browser**

Run: `pnpm test:unit && pnpm build && pnpm dev`
With `.env.local` bypass enabled, open http://localhost:3000. Expected: "Add your first brand" page; adding "Test Brand" lands on `/b/test-brand/plan` with the top bar (brand switcher, gray "Health —" pill, "Onboarding" badge, five tabs), the sidebar showing "Added brand Test Brand" under Today, and a Get started checklist at 1/6. Resize the window below 1024px — the "Files & tools" toggle appears. Toggle the OS to dark mode — colors switch.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(ui): themed three-pane workspace shell, brand switcher, activity sidebar, agent prompts"
```

---

### Task 16: Plan tab

**Files:**
- Create: `app/actions/plans.ts`, `components/plan/{plan-header,health-card,sparkline,channel-progress,funnel,where-you-stand,plan-items,verdict-badge}.tsx`, `scripts/seed-demo.ts`
- Modify: `app/b/[slug]/plan/page.tsx` (replace stub)

**Interfaces:**
- Consumes: `getActivePlan`, `PlanView`, `PlanItemView`, `decidePlanItem` (Task 9); `listAudits`, `AuditWithScores` (Task 8); `summarizeHealth`, `band`, `CATEGORY_LABELS`, `isPartial` (Task 2); `FUNNEL_STAGES`, `FUNNEL_META` (Task 2); `agentPrompt` (Task 15); `CopyButton` (Task 15); `attempt` (Task 15).
- Produces: `decidePlanItemAction(itemId: string, decision: "approve" | "decline"): Promise<Result<{ status: string }>>`; `<VerdictBadge tracker />` reused by Task 18. Test ids used by E2E: `health-score`, `health-delta`, `status-<item title>`; approve button accessible name `Approve <item title>`; empty state text `No audit yet`.

- [ ] **Step 1: Approval action** — `app/actions/plans.ts`

```ts
"use server";
import { revalidatePath } from "next/cache";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { decidePlanItem } from "@/lib/services/plans";

export async function decidePlanItemAction(itemId: string, decision: "approve" | "decline") {
  const user = await requireUser();
  const r = await attempt(async () => {
    const item = await decidePlanItem({ itemId, decision, actor: actorFor(user) });
    return { status: item.status };
  });
  revalidatePath("/b", "layout");
  return r;
}
```

- [ ] **Step 2: Health card and sparkline**

`components/plan/sparkline.tsx`:
```tsx
"use client";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  return (
    <div className="h-10 w-28" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={values.map((v, i) => ({ i, v }))}>
          <YAxis domain={[0, 100]} hide />
          <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`components/plan/health-card.tsx`:
```tsx
import { band } from "@/lib/domain/scoring";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

const TEXT = { red: "text-band-red", amber: "text-band-amber", green: "text-band-green" } as const;

export function HealthCard({ health, delta, history }: { health: number | null; delta: number | null; history: number[] }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Marketing health</div>
        <div data-testid="health-score" className={cn("font-display text-5xl font-semibold", health === null ? "text-muted-foreground" : TEXT[band(health)])}>
          {health ?? "—"}
        </div>
        <div data-testid="health-delta" className="text-xs text-muted-foreground">
          {delta === null ? "first audit" : (
            <span className={delta >= 0 ? "text-band-green" : "text-band-red"}>
              {delta >= 0 ? "▲ +" : "▼ "}
              {delta} since last audit
            </span>
          )}
        </div>
      </div>
      <Sparkline values={history} />
    </div>
  );
}
```

- [ ] **Step 3: Header, channel progress, funnel, where-you-stand**

`components/plan/plan-header.tsx`:
```tsx
import { FileText, Gauge, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/workspace/copy-button";
import { agentPrompt } from "@/lib/prompts";
import type { PlanView } from "@/lib/services/plans";

export function PlanHeader({
  plan,
  brand,
  latestAuditPath,
}: {
  plan: PlanView;
  brand: { name: string; slug: string; domain: string | null };
  latestAuditPath: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-band-green/15 px-2 py-0.5 font-medium text-band-green">{plan.status}</span>
        <span className="text-muted-foreground">Version {plan.version}</span>
        <span className="text-muted-foreground">Updated {plan.updatedAt.toLocaleDateString()}</span>
      </div>
      <h1 className="font-display text-3xl font-semibold">Marketing Plan</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">{plan.summary ?? plan.objective}</p>
      <div className="flex flex-wrap gap-2">
        {latestAuditPath && (
          <Button asChild variant="outline" size="sm">
            <Link href={`?pane=assets&file=${encodeURIComponent(latestAuditPath)}`}>
              <Gauge className="size-4" /> View audit
            </Link>
          </Button>
        )}
        <CopyButton text={agentPrompt("audit", brand)} label="Rerun audit" />
        <CopyButton text={agentPrompt("plan", brand)} label="Rebuild plan" />
        <CopyButton text={agentPrompt("execute", brand)} label="Edit with agent" variant="default" />
        {plan.planFilePath && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`?pane=assets&file=${encodeURIComponent(plan.planFilePath)}`}>
              <FileText className="size-4" /> View plan file
            </Link>
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Sparkles className="size-3" /> Buttons copy a ready prompt for Claude Desktop.
      </p>
    </div>
  );
}
```

`components/plan/channel-progress.tsx`:
```tsx
import type { PlanView } from "@/lib/services/plans";

export function ChannelProgress({ plan }: { plan: PlanView }) {
  const total = plan.items.length;
  const done = plan.items.filter((i) => i.status === "done").length;
  const active = plan.items.filter((i) => i.status === "active" || i.status === "approved").length;
  const blocked = plan.items.filter((i) => i.status === "blocked").length;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const chips = [
    plan.monthlyBudget !== null && `Budget: $${plan.monthlyBudget.toLocaleString()}/mo`,
    plan.weeklyHours !== null && `Bandwidth: ${plan.weeklyHours} h/wk`,
    plan.timeline && `Timeline: ${plan.timeline.replace("_", " ")}`,
    ...plan.secondaryChannels.map((c) => `+ ${c}`),
  ].filter(Boolean) as string[];
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Primary channel</span>{" "}
          <span className="font-semibold">{plan.primaryChannel ?? "Not set"}</span>
        </span>
        <span className="text-muted-foreground">
          {done} of {total} items complete
        </span>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done} done, ${active} active, ${blocked} blocked of ${total}`}>
        <div className="bg-band-green" style={{ width: `${pct(done)}%` }} />
        <div className="bg-primary" style={{ width: `${pct(active)}%` }} />
        <div className="bg-band-red" style={{ width: `${pct(blocked)}%` }} />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-band-green" /> Completed {done}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Active {active}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-band-red" /> Blocked {blocked}</span>
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-md border bg-background px-2 py-1 text-xs">{c}</span>
          ))}
        </div>
      )}
    </section>
  );
}
```

`components/plan/funnel.tsx`:
```tsx
import { FUNNEL_META, FUNNEL_STAGES } from "@/lib/domain/funnel";
import type { PlanItemView } from "@/lib/services/plans";

export function Funnel({ items }: { items: PlanItemView[] }) {
  const addressed = FUNNEL_STAGES.filter((s) => items.some((i) => i.funnelStage === s)).length;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Growth funnel</h2>
        <span className="text-xs text-muted-foreground">{addressed} of 5 stages addressed</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {FUNNEL_STAGES.map((stage) => {
          const meta = FUNNEL_META[stage];
          const list = items.filter((i) => i.funnelStage === stage);
          const done = list.filter((i) => i.status === "done").length;
          return (
            <div key={stage} className="rounded-lg border bg-card p-3 shadow-sm" style={{ borderTop: `3px solid ${meta.color}` }}>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="size-2 rounded-full" style={{ background: meta.color }} /> {meta.label}
              </div>
              <div className="text-xs text-muted-foreground">{meta.hint}</div>
              <div className="mt-2 text-xs">
                {list.length === 0 ? (
                  <span className="text-muted-foreground">Not yet addressed</span>
                ) : (
                  <>
                    <span className="font-semibold">{list.length} items</span> · {done} done
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

`components/plan/where-you-stand.tsx`:
```tsx
import { band, CATEGORY_LABELS, type Category } from "@/lib/domain/scoring";
import type { AuditWithScores } from "@/lib/services/audits";

const BAR = { red: "bg-band-red", amber: "bg-band-amber", green: "bg-band-green" } as const;

export function WhereYouStand({ audit }: { audit: AuditWithScores }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">Where you stand</h2>
      <p className="text-xs text-muted-foreground">
        Channel health from the audit on {audit.auditedAt.toLocaleDateString()}
        {audit.partial && " (partial audit — not counted in Health)"}, with each target.
      </p>
      <ul className="mt-4 space-y-3">
        {audit.scores.map((s) => (
          <li key={s.category}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{CATEGORY_LABELS[s.category as Category] ?? s.category}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.score}
                {s.target !== null && <> → <span className="font-semibold text-foreground">{s.target}</span></>}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-muted">
              <div className={`h-2 rounded-full ${BAR[band(s.score)]}`} style={{ width: `${s.score}%` }} />
              {s.target !== null && <div className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground/60" style={{ left: `${s.target}%` }} />}
            </div>
            {s.evidence && <p className="mt-1 text-xs text-muted-foreground">{s.evidence}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Items list with approvals and verdict badges**

`components/plan/verdict-badge.tsx`:
```tsx
import type { TrackerSummary } from "@/lib/services/trackers";

type T = Pick<TrackerSummary, "verdict" | "changePct" | "changeAbs" | "windowEndsAt">;

export function VerdictBadge({ tracker }: { tracker: T }) {
  const change =
    tracker.changePct !== null
      ? `${tracker.changePct >= 0 ? "+" : ""}${tracker.changePct.toFixed(1)}%`
      : tracker.changeAbs !== null
        ? `${tracker.changeAbs >= 0 ? "+" : ""}${tracker.changeAbs}`
        : "";
  switch (tracker.verdict) {
    case "positive":
      return <span className="rounded-full bg-band-green/15 px-2 py-0.5 text-xs font-medium text-band-green">▲ positive {change}</span>;
    case "negative":
      return <span className="rounded-full bg-band-red/15 px-2 py-0.5 text-xs font-medium text-band-red">▼ negative {change}</span>;
    case "neutral":
      return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">● neutral {change}</span>;
    default:
      return (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          measuring until {tracker.windowEndsAt.toLocaleDateString()}
        </span>
      );
  }
}
```

`components/plan/plan-items.tsx`:
```tsx
"use client";
import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { decidePlanItemAction } from "@/app/actions/plans";
import { Button } from "@/components/ui/button";
import { FUNNEL_META } from "@/lib/domain/funnel";
import type { PlanItemView } from "@/lib/services/plans";
import { cn } from "@/lib/utils";
import { VerdictBadge } from "./verdict-badge";

const STATUS: Record<PlanItemView["status"], { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "bg-muted text-muted-foreground" },
  active: { label: "Active", cls: "bg-chart-2/15 text-chart-2" },
  needs_approval: { label: "Needs approval", cls: "bg-band-amber/15 text-band-amber" },
  approved: { label: "Approved", cls: "bg-primary/15 text-primary" },
  done: { label: "Done", cls: "bg-band-green/15 text-band-green" },
  blocked: { label: "Blocked", cls: "bg-band-red/15 text-band-red" },
  declined: { label: "Declined", cls: "bg-muted text-muted-foreground line-through" },
};

export function PlanItems({ items }: { items: PlanItemView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (id: string, decision: "approve" | "decline") =>
    start(async () => {
      const r = await decidePlanItemAction(id, decision);
      if (r.ok) toast.success(decision === "approve" ? "Approved — the agent can start it now" : "Declined");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <section id="approvals" className="space-y-2">
      <h2 className="font-semibold">Plan items</h2>
      {items.length === 0 && <p className="text-sm text-muted-foreground">This plan has no items yet. Use “Rebuild plan” to have the agent add them.</p>}
      <ul className="divide-y rounded-xl border bg-card shadow-sm">
        {items.map((item) => {
          const tracker = item.tracker
            ? {
                verdict: item.tracker.verdict,
                changePct: item.tracker.changePct,
                changeAbs: null,
                windowEndsAt: new Date(item.tracker.baselineAt.getTime() + item.tracker.windowDays * 86_400_000),
              }
            : null;
          return (
            <li key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: FUNNEL_META[item.funnelStage].color }} title={FUNNEL_META[item.funnelStage].label} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{item.title}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.channel && <span>{item.channel}</span>}
                  {item.expectedKpi && <span>KPI: {item.expectedKpi}</span>}
                  {item.files.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Paperclip className="size-3" /> {item.files.length}
                    </span>
                  )}
                  {tracker && <VerdictBadge tracker={tracker} />}
                </div>
              </div>
              <span data-testid={`status-${item.title}`} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[item.status].cls)}>
                {STATUS[item.status].label}
              </span>
              {item.status === "needs_approval" && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} aria-label={`Approve ${item.title}`} onClick={() => decide(item.id, "approve")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} aria-label={`Decline ${item.title}`} onClick={() => decide(item.id, "decline")}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```
The verdict shown here is the stored `item.tracker.verdict` (updated on every check-in); the Analytics tab recomputes from check-ins at read time.

- [ ] **Step 5: The page** — replace `app/b/[slug]/plan/page.tsx`

```tsx
import { ClipboardList, Gauge } from "lucide-react";
import { ChannelProgress } from "@/components/plan/channel-progress";
import { Funnel } from "@/components/plan/funnel";
import { HealthCard } from "@/components/plan/health-card";
import { PlanHeader } from "@/components/plan/plan-header";
import { PlanItems } from "@/components/plan/plan-items";
import { WhereYouStand } from "@/components/plan/where-you-stand";
import { CopyButton } from "@/components/workspace/copy-button";
import { isPartial, summarizeHealth } from "@/lib/domain/scoring";
import { agentPrompt } from "@/lib/prompts";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { getActivePlan } from "@/lib/services/plans";

function EmptyState({ icon: Icon, title, body, prompt }: { icon: typeof Gauge; title: string; body: string; prompt: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 text-center">
      <Icon className="mx-auto size-8 text-primary" />
      <h2 className="mt-3 font-display text-xl">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="mt-4 flex justify-center">
        <CopyButton text={prompt} label="Copy prompt for Claude Desktop" variant="default" />
      </div>
    </div>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const [audits, plan] = await Promise.all([listAudits(brand.id), getActivePlan(brand.id)]);
  const { health, delta } = summarizeHealth(audits);
  const history = audits.filter((a) => a.health !== null && !isPartial(a.coverage)).map((a) => a.health!).reverse();
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {audits.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No audit yet"
          body={`Onboard ${brand.name} and run the first audit. The Health score, funnel, and plan appear here once the agent records results.`}
          prompt={`${agentPrompt("onboard", b)}\n\nWhen onboarding is done:\n\n${agentPrompt("audit", b)}`}
        />
      ) : !plan ? (
        <>
          <div className="flex justify-end">
            <HealthCard health={health} delta={delta} history={history} />
          </div>
          <EmptyState icon={ClipboardList} title="No plan yet" body="The audit is in. Have the agent ask its plan questions and build the plan." prompt={agentPrompt("plan", b)} />
          <WhereYouStand audit={audits[0]} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <PlanHeader plan={plan} brand={b} latestAuditPath={audits[0]?.reportPath ?? null} />
            <HealthCard health={health} delta={delta} history={history} />
          </div>
          <ChannelProgress plan={plan} />
          <Funnel items={plan.items} />
          <WhereYouStand audit={audits[0]} />
          <PlanItems items={plan.items} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

Create `scripts/seed-demo.ts` (local development only; seeds the "Test Brand" created in Task 15):
```ts
import { sql } from "@/lib/data/db";
import { CATEGORIES } from "@/lib/domain/scoring";
import { recordAudit } from "@/lib/services/audits";
import { createPlanVersion } from "@/lib/services/plans";
import { upsertUserByEmail } from "@/lib/services/users";

const email = process.env.AUTH_BYPASS_EMAIL;
if (!email) throw new Error("Set AUTH_BYPASS_EMAIL in .env.local");
const u = await upsertUserByEmail({ email });
const actor = { kind: "user" as const, userId: u.id, label: u.email };
const scores = (n: number) => CATEGORIES.map((category) => ({ category, score: n, target: 80 }));

await recordAudit({ brandSlug: "test-brand", auditedAt: new Date("2026-09-01"), scores: scores(40), requestId: "demo-a1", actor });
await recordAudit({ brandSlug: "test-brand", auditedAt: new Date("2026-09-20"), scores: scores(52), requestId: "demo-a2", actor });
await createPlanVersion({
  brandSlug: "test-brand",
  requestId: "demo-p1",
  plan: { objective: "More leads", primaryChannel: "SEO", monthlyBudget: 500, timeline: "90_day" },
  items: [
    { title: "Launch $500 search test", funnelStage: "acquisition", priority: 1, needsApproval: true },
    { title: "Publish FAQ page", funnelStage: "activation", priority: 2 },
  ],
  actor,
});
console.log("Seeded test-brand");
await sql.end();
```
Run: `pnpm build && pnpm tsx --env-file=.env.local scripts/seed-demo.ts && pnpm dev`
Expected at `/b/test-brand/plan`: Health 52 (amber) with "▲ +12 since last audit" and a sparkline; progress bar "0 of 2 items complete"; funnel with Acquisition and Activation addressed (2 of 5); six category bars at 52 with target markers at 80; the search-test item shows "Needs approval" with Approve/Decline; clicking Approve shows a toast, the chip becomes "Approved", and the sidebar Approvals count drops to 0.

- [ ] **Step 7: Commit**

```bash
git add app/actions/plans.ts app/b components/plan scripts/seed-demo.ts
git commit -m "feat(ui): Plan tab with health card, channel progress, funnel, category bars, approvals"
```

---

### Task 17: Right pane — assets with markdown preview, integrations, skills

**Files:**
- Create: `app/actions/files.ts`, `app/actions/integrations.ts`, `components/markdown/{markdown-view,mermaid}.tsx`, `components/workspace/{file-tree,assets-pane,integrations-pane,skills-pane,placeholder}.tsx`
- Modify: `components/workspace/right-pane.tsx` (replace stub)

**Interfaces:**
- Consumes: `listFiles`, `readFile`, `listVersions`, `fileDownloadUrl`, `writeFile` (Task 7); `upsertIntegration`, `listIntegrations` (Task 10); `buildTree`, `TreeNode` (Task 4); `splitFrontMatter` (Task 4); `SERVICES`, `SERVICE_LABELS` (Task 2); `attempt`, `Result` (Task 15).
- Produces:
  - Actions: `listFilesAction(brandSlug: string | null): Promise<FileInfo[]>`; `readFileAction(brandSlug: string | null, path: string, version?: number): Promise<Result<FilePreview>>` where `FilePreview = { path; version; contentType; size; text: string | null; downloadUrl: string }`; `listVersionsAction(brandSlug: string | null, path: string)`; `uploadFileAction(formData: FormData): Promise<Result<{ path: string; version: number }>>` (fields `brandSlug` — empty for shared, `folder`, `file`); `listSkillsAction(): Promise<{ name: string; description: string }[]>`; `listIntegrationsAction(brandSlug: string)`; `saveIntegrationAction(input: { brandSlug: string; service: Service; status: "connected" | "not_connected" | "error"; identifiersText: string; notes: string }): Promise<Result<null>>`
  - `<MarkdownView source />`; `<RightPane brandSlug />` reading URL params `pane` (`assets | integrations | skills | workflows | permissions | email`), `scope` (`brand | shared`), `file`.

- [ ] **Step 1: Server actions**

`app/actions/files.ts`:
```ts
"use server";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { splitFrontMatter } from "@/lib/domain/front-matter";
import { getBrandBySlug } from "@/lib/services/brands";
import { ValidationError } from "@/lib/services/errors";
import { fileDownloadUrl, listFiles, listVersions, readFile, writeFile } from "@/lib/services/files";

const brandIdFor = async (slug: string | null) => (slug ? (await getBrandBySlug(slug)).id : null);

export async function listFilesAction(brandSlug: string | null) {
  await requireUser();
  return listFiles({ brandId: await brandIdFor(brandSlug) });
}

export async function readFileAction(brandSlug: string | null, path: string, version?: number) {
  await requireUser();
  return attempt(async () => {
    const brandId = await brandIdFor(brandSlug);
    const f = await readFile({ brandId, path, version });
    return {
      path: f.path,
      version: f.version,
      contentType: f.contentType,
      size: f.size,
      text: f.text,
      downloadUrl: await fileDownloadUrl({ brandId, path: f.path, version: f.version }),
    };
  });
}

export async function listVersionsAction(brandSlug: string | null, path: string) {
  await requireUser();
  return listVersions({ brandId: await brandIdFor(brandSlug), path });
}

export async function uploadFileAction(formData: FormData) {
  const user = await requireUser();
  return attempt(async () => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a file to upload", "file");
    const slug = String(formData.get("brandSlug") ?? "") || null;
    const folder = String(formData.get("folder") ?? "").trim().replace(/^\/+|\/+$/g, "");
    const path = folder ? `${folder}/${file.name}` : file.name;
    const r = await writeFile({
      brandId: await brandIdFor(slug),
      path,
      content: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || undefined,
      actor: actorFor(user),
    });
    return { path: r.path, version: r.version };
  });
}

export async function listSkillsAction() {
  await requireUser();
  const all = await listFiles({ brandId: null, prefix: "skills/" });
  const skillFiles = all.filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f.path));
  return Promise.all(
    skillFiles.map(async (f) => {
      const { text } = await readFile({ brandId: null, path: f.path });
      const { data } = splitFrontMatter(text ?? "");
      return {
        name: f.path.split("/")[1],
        description: typeof data?.description === "string" ? data.description : "",
      };
    }),
  );
}
```

`app/actions/integrations.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import type { Service } from "@/lib/domain/integrations";
import { getBrandBySlug } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

export async function listIntegrationsAction(brandSlug: string) {
  await requireUser();
  return listIntegrations((await getBrandBySlug(brandSlug)).id);
}

export async function saveIntegrationAction(input: {
  brandSlug: string;
  service: Service;
  status: "connected" | "not_connected" | "error";
  identifiersText: string;
  notes: string;
}) {
  const user = await requireUser();
  const identifiers = Object.fromEntries(
    input.identifiersText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const r = await attempt(async () => {
    await upsertIntegration({
      brandSlug: input.brandSlug,
      service: input.service,
      status: input.status,
      identifiers,
      notes: input.notes || null,
      actor: actorFor(user),
    });
    return null;
  });
  revalidatePath("/b", "layout");
  return r;
}
```

- [ ] **Step 2: Markdown rendering**

`components/markdown/mermaid.tsx`:
```tsx
"use client";
import { useEffect, useId, useState } from "react";

export function Mermaid({ chart }: { chart: string }) {
  const id = `m${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const out = await mermaid.render(id, chart);
        if (!cancelled) setSvg(out.svg);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);
  if (error) return <pre className="text-xs text-destructive">{`Diagram error: ${error}\n\n${chart}`}</pre>;
  if (!svg) return <div className="text-xs text-muted-foreground">Rendering diagram…</div>;
  return <div className="my-4 overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

`components/markdown/markdown-view.tsx`:
```tsx
"use client";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { splitFrontMatter } from "@/lib/domain/front-matter";
import { Mermaid } from "./mermaid";

export function MarkdownView({ source }: { source: string }) {
  const { data, body } = splitFrontMatter(source);
  return (
    <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-a:text-primary prose-table:text-xs">
      {data && (
        <table className="not-prose mb-4 w-full rounded-md border text-xs">
          <tbody>
            {Object.entries(data).map(([k, v]) => (
              <tr key={k} className="border-b last:border-0">
                <th className="w-32 bg-muted px-2 py-1 text-left align-top font-medium">{k}</th>
                <td className="px-2 py-1 break-words">{typeof v === "string" ? v : JSON.stringify(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{
          code({ className, children, ...props }) {
            if (/language-mermaid/.test(className ?? "")) return <Mermaid chart={String(children).trim()} />;
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
```

- [ ] **Step 3: File tree and the assets pane**

`components/workspace/file-tree.tsx`:
```tsx
"use client";
import { ChevronRight, File, Folder } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "@/lib/domain/tree";
import { cn } from "@/lib/utils";

export function FileTree({
  nodes,
  selected,
  onSelect,
  depth = 0,
  defaultOpen = false,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  depth?: number;
  defaultOpen?: boolean;
}) {
  return (
    <ul>
      {nodes.map((n) => (
        <TreeItem key={n.path} node={n} selected={selected} onSelect={onSelect} depth={depth} defaultOpen={defaultOpen || (selected?.startsWith(`${n.path}/`) ?? false)} />
      ))}
    </ul>
  );
}

function TreeItem({ node, selected, onSelect, depth, defaultOpen }: { node: TreeNode; selected: string | null; onSelect: (p: string) => void; depth: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const pad = { paddingLeft: `${depth * 12 + 4}px` };
  if (node.children) {
    return (
      <li>
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 rounded py-0.5 text-left text-sm hover:bg-muted" style={pad} aria-expanded={open}>
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          <Folder className="size-4 text-funnel-referral" /> {node.name}
        </button>
        {open && <FileTree nodes={node.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn("flex w-full items-center gap-1.5 rounded py-0.5 text-left text-sm hover:bg-muted", selected === node.path && "bg-accent text-accent-foreground")}
        style={{ paddingLeft: `${depth * 12 + 22}px` }}
      >
        <File className="size-3.5 text-muted-foreground" /> <span className="truncate">{node.name}</span>
      </button>
    </li>
  );
}
```

`components/workspace/assets-pane.tsx`:
```tsx
"use client";
import { Download, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { listFilesAction, listVersionsAction, readFileAction, uploadFileAction } from "@/app/actions/files";
import { MarkdownView } from "@/components/markdown/markdown-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildTree } from "@/lib/domain/tree";
import type { FileInfo } from "@/lib/services/files";
import { FileTree } from "./file-tree";

type Scope = "brand" | "shared";
type Preview = { path: string; version: number; contentType: string; size: number; text: string | null; downloadUrl: string };

export function AssetsPane({
  brandSlug,
  scope,
  file,
  onOpen,
}: {
  brandSlug: string;
  scope: Scope;
  file: string | null;
  onOpen: (scope: Scope, path: string) => void;
}) {
  const [brandFiles, setBrandFiles] = useState<FileInfo[]>([]);
  const [sharedFiles, setSharedFiles] = useState<FileInfo[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<{ version: number; author: string; createdAt: Date }[]>([]);
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const slugFor = useCallback((s: Scope) => (s === "brand" ? brandSlug : null), [brandSlug]);

  const refresh = useCallback(async () => {
    const [b, s] = await Promise.all([listFilesAction(brandSlug), listFilesAction(null)]);
    setBrandFiles(b);
    setSharedFiles(s);
  }, [brandSlug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const load = useCallback(
    async (version?: number) => {
      if (!file) return;
      const r = await readFileAction(slugFor(scope), file, version);
      if (!r.ok) {
        setPreview(null);
        setError(r.error);
        return;
      }
      setError(null);
      setPreview(r.data);
      setVersions(await listVersionsAction(slugFor(scope), file));
    },
    [file, scope, slugFor],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const brandTree = useMemo(() => buildTree(brandFiles.map((f) => f.path)), [brandFiles]);
  const sharedTree = useMemo(() => buildTree(sharedFiles.map((f) => f.path)), [sharedFiles]);

  const upload = (formData: FormData) =>
    start(async () => {
      formData.set("brandSlug", scope === "brand" ? brandSlug : "");
      const r = await uploadFileAction(formData);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Uploaded ${r.data.path} (v${r.data.version})`);
      await refresh();
      onOpen(scope, r.data.path);
    });

  const isMarkdown = preview?.path.toLowerCase().endsWith(".md");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[42%] min-h-32 overflow-y-auto border-b p-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Files</span>
          <form action={upload} className="flex items-center gap-1">
            <Input name="folder" placeholder="folder" className="h-7 w-24 text-xs" aria-label="Upload folder" />
            <Input name="file" type="file" className="h-7 w-40 text-xs" aria-label="File to upload" />
            <Button size="sm" className="h-7" disabled={pending} aria-label="Upload">
              <Upload className="size-3.5" />
            </Button>
          </form>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm font-medium">Brand files</summary>
          <FileTree nodes={brandTree} selected={scope === "brand" ? file : null} onSelect={(p) => onOpen("brand", p)} />
        </details>
        <details open={scope === "shared"}>
          <summary className="cursor-pointer text-sm font-medium">Shared (skills, workspace)</summary>
          <FileTree nodes={sharedTree} selected={scope === "shared" ? file : null} onSelect={(p) => onOpen("shared", p)} />
        </details>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!file && <p className="p-4 text-sm text-muted-foreground">Select a file to preview it.</p>}
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {preview && (
          <>
            <div className="sticky top-0 flex flex-wrap items-center gap-2 border-b bg-card/95 px-3 py-2 text-xs backdrop-blur">
              <span className="min-w-0 flex-1 truncate font-medium">{preview.path}</span>
              <select
                aria-label="Version"
                className="rounded border bg-background px-1 py-0.5"
                value={preview.version}
                onChange={(e) => void load(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version} · {v.author} · {new Date(v.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
              {preview.text !== null && isMarkdown && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setRaw(!raw)}>
                  {raw ? "Preview" : "Raw"}
                </Button>
              )}
              <a href={preview.downloadUrl} className="flex items-center gap-1 text-primary hover:underline" download>
                <Download className="size-3.5" /> Download
              </a>
            </div>
            <div className="p-4">
              {preview.text === null ? (
                <p className="text-sm text-muted-foreground">
                  {preview.contentType} · {(preview.size / 1024).toFixed(1)} KB — no inline preview. Use Download.
                </p>
              ) : isMarkdown && !raw ? (
                <MarkdownView source={preview.text} />
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs">{preview.text}</pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Integrations, skills, placeholder**

`components/workspace/placeholder.tsx`:
```tsx
export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="m-4 rounded-xl border border-dashed p-6 text-center">
      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">Coming next</span>
      <h3 className="mt-2 font-display text-lg">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
```

`components/workspace/integrations-pane.tsx`:
```tsx
"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { listIntegrationsAction, saveIntegrationAction } from "@/app/actions/integrations";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_LABELS, SERVICES, type Service } from "@/lib/domain/integrations";
import { cn } from "@/lib/utils";

type Row = Awaited<ReturnType<typeof listIntegrationsAction>>[number];
const DOT = { connected: "bg-band-green", not_connected: "bg-muted-foreground/40", error: "bg-band-red" } as const;

export function IntegrationsPane({ brandSlug }: { brandSlug: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [pending, start] = useTransition();
  const refresh = useCallback(async () => setRows(await listIntegrationsAction(brandSlug)), [brandSlug]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-2 p-3">
      <p className="text-xs text-muted-foreground">
        The agent pulls data with its own connectors; record each account here so it knows which property, site, or customer ID to use.
      </p>
      {SERVICES.filter((s) => s !== "other").map((service) => {
        const row = rows.find((r) => r.service === service);
        const status = row?.status ?? "not_connected";
        return (
          <div key={service} className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", DOT[status])} />
              <span className="flex-1 text-sm font-medium">{SERVICE_LABELS[service]}</span>
              <span className="text-xs text-muted-foreground">{status.replace("_", " ")}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(editing === service ? null : service)}>
                {editing === service ? "Close" : "Edit"}
              </Button>
            </div>
            {row && Object.keys(row.identifiers).length > 0 && (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                {Object.entries(row.identifiers).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="truncate font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {editing === service && (
              <form
                className="mt-2 space-y-2"
                action={(fd) =>
                  start(async () => {
                    const r = await saveIntegrationAction({
                      brandSlug,
                      service,
                      status: fd.get("status") as "connected" | "not_connected" | "error",
                      identifiersText: String(fd.get("identifiers") ?? ""),
                      notes: String(fd.get("notes") ?? ""),
                    });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`${SERVICE_LABELS[service]} saved`);
                    setEditing(null);
                    await refresh();
                  })
                }
              >
                <select name="status" defaultValue={status} className="w-full rounded border bg-background px-2 py-1 text-sm" aria-label="Status">
                  <option value="connected">Connected</option>
                  <option value="not_connected">Not connected</option>
                  <option value="error">Error</option>
                </select>
                <Textarea
                  name="identifiers"
                  aria-label="Identifiers"
                  placeholder={"property_id=515827425\nsite=sc-domain:example.com"}
                  defaultValue={Object.entries(row?.identifiers ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
                  className="font-mono text-xs"
                />
                <Textarea name="notes" aria-label="Notes" placeholder="Notes" defaultValue={row?.notes ?? ""} className="text-xs" />
                <Button size="sm" disabled={pending}>Save</Button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

`components/workspace/skills-pane.tsx`:
```tsx
"use client";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { listSkillsAction } from "@/app/actions/files";
import { Input } from "@/components/ui/input";

export function SkillsPane({ onOpen }: { onOpen: (path: string) => void }) {
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    void listSkillsAction().then(setSkills);
  }, []);
  const shown = skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2 p-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${skills.length} skills…`} className="h-8" />
      <ul className="space-y-1">
        {shown.map((s) => (
          <li key={s.name}>
            <button type="button" onClick={() => onOpen(`skills/${s.name}/SKILL.md`)} className="w-full rounded-md p-2 text-left hover:bg-muted">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="size-3.5 text-primary" /> {s.name}
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{s.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: The right pane** — replace `components/workspace/right-pane.tsx`

```tsx
"use client";
import { Folder, Lock, Mail, Plug, Sparkles, Workflow } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { AssetsPane } from "./assets-pane";
import { IntegrationsPane } from "./integrations-pane";
import { Placeholder } from "./placeholder";
import { SkillsPane } from "./skills-pane";

const PANES = [
  { key: "assets", label: "Assets", icon: Folder },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "skills", label: "Skills", icon: Sparkles },
  { key: "workflows", label: "Workflows", icon: Workflow },
  { key: "permissions", label: "Permissions", icon: Lock },
  { key: "email", label: "Email", icon: Mail },
] as const;
type PaneKey = (typeof PANES)[number]["key"];

export function RightPane({ brandSlug }: { brandSlug: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pane = (PANES.find((p) => p.key === params.get("pane"))?.key ?? "assets") as PaneKey;
  const scope = params.get("scope") === "shared" ? "shared" : "brand";
  const file = params.get("file");

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-card">
      <nav aria-label="Tools" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
        {PANES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ pane: key })}
            aria-current={pane === key ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
              pane === key && "bg-secondary text-secondary-foreground",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pane === "assets" && (
          <AssetsPane brandSlug={brandSlug} scope={scope} file={file} onOpen={(s, p) => go({ pane: "assets", scope: s, file: p })} />
        )}
        {pane === "integrations" && <IntegrationsPane brandSlug={brandSlug} />}
        {pane === "skills" && <SkillsPane onOpen={(p) => go({ pane: "assets", scope: "shared", file: p })} />}
        {pane === "workflows" && <Placeholder title="Workflows" body="Saved, repeatable agent workflows per brand (audit refresh, weekly check-ins) arrive in the next slice." />}
        {pane === "permissions" && <Placeholder title="Permissions" body="Per-action approval rules and agent scopes arrive in a later slice. Today every outward-facing plan item needs approval in the Plan tab." />}
        {pane === "email" && <Placeholder title="Email" body="Sending and drafting email from the workspace arrives in a later slice." />}
      </div>
    </div>
  );
}
```

Wrap `<RightPane>` usages in `<Suspense>` (required by `useSearchParams` during static rendering). In `components/workspace/workspace-panels.tsx` add `import { Suspense } from "react";` and replace each `<RightPane brandSlug={brandSlug} />` with:
```tsx
<Suspense fallback={null}>
  <RightPane brandSlug={brandSlug} />
</Suspense>
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm build && pnpm dev`. Then import the real AI Assets folder into local dev:
```bash
pnpm import:ai-assets "C:/Users/ogDevOps/Google Drive Streaming/My Drive/AI Assets"
```
Expected CLI output: 7 brands, hundreds of files written, audits ≥ 6, plans 4 (SuperThrift, Mid-State Welding, Elite Gutters, Roof Co), integrations ≥ 5, skipped includes `README.md`, `_Personal-Automations`, `_Duplicates-to-delete`; no FAILED lines.
In the app: `/b/superthriftdeals-org/plan` shows Health from the 2026-09-29 audit; Assets tree shows `audits/`, `deliverables/`, `ads-audit/`…; selecting `BRAND.md` renders formatted markdown; Shared → `skills/ads-audit/SKILL.md` shows a front-matter table and headings; the Version dropdown lists v1; Raw toggles plain text; an `.xlsx` under `data/` shows "no inline preview" with Download. Integrations shows Google Analytics 4 connected with `property_id 515827425`; editing and saving updates the card. Skills lists ~45 skills and opening one jumps to its file.

- [ ] **Step 7: Commit**

```bash
git add app/actions components
git commit -m "feat(ui): right pane with file tree, markdown and Mermaid preview, versions, uploads, integrations, skills"
```

---

### Task 18: Analytics, Agent tab, MCP and browser dialogs, placeholders

**Files:**
- Create: `app/actions/tokens.ts`, `components/analytics/{health-trend,category-trend,trackers-table}.tsx`, `app/b/[slug]/{analytics,agent,briefs,calendar}/page.tsx`
- Modify: `components/workspace/mcp-dialog.tsx`, `components/workspace/browser-dialog.tsx` (replace stubs)

**Interfaces:**
- Consumes: `listAudits` (Task 8), `listTrackers` (Task 10), `createApiToken`, `listApiTokens`, `revokeApiToken` (Task 11), `agentPrompt`, `PROMPT_LABELS` (Task 15), `VerdictBadge` (Task 16), `Placeholder` (Task 17), `CATEGORIES`, `CATEGORY_LABELS`, `isPartial` (Task 2).
- Produces: `createTokenAction(name: string): Promise<Result<{ token: string }>>`, `listTokensAction()`, `revokeTokenAction(id: string): Promise<void>`. E2E relies on: trackers table rows (`role="row"`) containing the KPI name and the verdict word.

- [ ] **Step 1: Token actions** — `app/actions/tokens.ts`

```ts
"use server";
import { requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/services/tokens";

export async function createTokenAction(name: string) {
  const user = await requireUser();
  return attempt(async () => ({ token: (await createApiToken(user.id, name)).token }));
}

export async function listTokensAction() {
  const user = await requireUser();
  return listApiTokens(user.id);
}

export async function revokeTokenAction(id: string) {
  const user = await requireUser();
  await revokeApiToken(user.id, id);
}
```

- [ ] **Step 2: MCP dialog** — replace `components/workspace/mcp-dialog.tsx`

```tsx
"use client";
import { KeyRound, PlugZap } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createTokenAction, listTokensAction, revokeTokenAction } from "@/app/actions/tokens";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CopyButton } from "./copy-button";

type TokenRow = Awaited<ReturnType<typeof listTokensAction>>[number];

export function McpDialog({ origin }: { origin: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Claude Desktop");
  const [token, setToken] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [pending, start] = useTransition();
  const endpoint = `${origin}/api/mcp`;
  const shown = token ?? "<your token>";
  const config = JSON.stringify(
    {
      mcpServers: {
        "hughes-marketing": {
          command: "npx",
          args: ["-y", "mcp-remote", endpoint, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: `Bearer ${shown}` },
        },
      },
    },
    null,
    2,
  );

  useEffect(() => {
    if (open) void listTokensAction().then(setTokens);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setToken(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlugZap className="size-4" /> MCP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Claude Desktop or OpenClaw</DialogTitle>
          <DialogDescription>
            Agents read and write this workspace through the MCP endpoint below. Each person creates their own token; revoke it any time.
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">1. Endpoint</h3>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{endpoint}</code>
            <CopyButton text={endpoint} toastMessage="Endpoint copied" />
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">2. Create a token</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await createTokenAction(name);
                if (!r.ok) return void toast.error(r.error);
                setToken(r.data.token);
                setTokens(await listTokensAction());
              });
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Token name" />
            <Button type="submit" disabled={pending}>
              <KeyRound className="size-4" /> Create token
            </Button>
          </form>
          {token && (
            <div className="rounded-md border border-band-amber bg-band-amber/10 p-2 text-xs">
              <p className="font-medium">Copy this token now — it is shown only once.</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate">{token}</code>
                <CopyButton text={token} toastMessage="Token copied" />
              </div>
            </div>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">3a. Claude Desktop</h3>
          <p className="text-xs text-muted-foreground">
            Settings → Developer → Edit Config, add this to <code>claude_desktop_config.json</code>, then restart Claude Desktop. Requires Node.js.
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{config}</pre>
          <CopyButton text={config} label="Copy config" toastMessage="Config copied" />
        </section>
        <section className="space-y-1">
          <h3 className="text-sm font-semibold">3b. OpenClaw or another MCP client</h3>
          <p className="text-xs text-muted-foreground">
            Add a remote (Streamable HTTP) MCP server with URL <code>{endpoint}</code> and header <code>Authorization: Bearer {"<token>"}</code>.
          </p>
        </section>
        {tokens.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">Your tokens</h3>
            <ul className="divide-y rounded border text-xs">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 p-2">
                  <span className="flex-1">{t.name}</span>
                  <span className="text-muted-foreground">
                    {t.revokedAt ? "revoked" : t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </span>
                  {!t.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-destructive"
                      onClick={() => start(async () => { await revokeTokenAction(t.id); setTokens(await listTokensAction()); })}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Browser automation dialog** — replace `components/workspace/browser-dialog.tsx`

```tsx
"use client";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { agentPrompt } from "@/lib/prompts";
import type { BrandSummary } from "@/lib/services/brands";
import { CopyButton } from "./copy-button";

export function BrowserDialog({ brand }: { brand: BrandSummary }) {
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Globe className="size-4" /> <span className="hidden md:inline">Browser Automation</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Browser automation</DialogTitle>
          <DialogDescription>
            The agent browses with your own signed-in Chrome, so it can read GA4, Search Console, Google Ads, and site admin pages you are logged into.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Install the <strong>Claude in Chrome</strong> extension and sign in with the same Claude account as Claude Desktop.</li>
          <li>In Claude Desktop, enable the Chrome connector, then connect the workspace with the <strong>MCP</strong> button.</li>
          <li>Copy a prompt below and paste it into Claude Desktop. The agent asks before any action that publishes, spends, or changes a live site.</li>
          <li>OpenClaw: use its built-in browser tool with the same prompts.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={agentPrompt("onboard", b)} label="Onboard with browser" />
          <CopyButton text={agentPrompt("audit", b)} label="Audit with browser" />
          <CopyButton text={agentPrompt("checkin", b)} label="Pull KPI check-ins" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Analytics components**

`components/analytics/health-trend.tsx`:
```tsx
"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HealthTrend({ points }: { points: { date: string; health: number }[] }) {
  if (points.length === 0) return <p className="text-sm text-muted-foreground">No full audits yet.</p>;
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Line type="monotone" dataKey="health" name="Health" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`components/analytics/category-trend.tsx`:
```tsx
"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/domain/scoring";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export function CategoryTrend({ points }: { points: Record<string, number | string>[] }) {
  if (points.length === 0) return null;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {CATEGORIES.map((c, i) => (
            <Line key={c} type="monotone" dataKey={c} name={CATEGORY_LABELS[c]} stroke={COLORS[i]} strokeWidth={2} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`components/analytics/trackers-table.tsx`:
```tsx
import { VerdictBadge } from "@/components/plan/verdict-badge";
import type { TrackerSummary } from "@/lib/services/trackers";

export function TrackersTable({ trackers }: { trackers: TrackerSummary[] }) {
  if (trackers.length === 0)
    return <p className="text-sm text-muted-foreground">No trackers yet. Completing a plan item creates one with a baseline.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Plan item</th>
            <th className="p-2">KPI</th>
            <th className="p-2 text-right">Baseline</th>
            <th className="p-2 text-right">Latest</th>
            <th className="p-2">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {trackers.map((t) => (
            <tr key={t.id}>
              <td className="p-2">{t.itemTitle}</td>
              <td className="p-2">
                {t.kpi}
                <span className="block text-xs text-muted-foreground">{t.direction === "up" ? "higher is better" : "lower is better"}</span>
              </td>
              <td className="p-2 text-right tabular-nums">{t.baselineValue}</td>
              <td className="p-2 text-right tabular-nums">{t.latest ?? "—"}</td>
              <td className="p-2">
                <VerdictBadge tracker={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Tab pages**

`app/b/[slug]/analytics/page.tsx`:
```tsx
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
```

`app/b/[slug]/agent/page.tsx`:
```tsx
import { Bot } from "lucide-react";
import { CopyButton } from "@/components/workspace/copy-button";
import { agentPrompt, PROMPT_LABELS, type PromptKind } from "@/lib/prompts";
import { getBrandBySlug } from "@/lib/services/brands";

const NEXT_FOR_STAGE: Record<string, PromptKind> = { onboarding: "onboard", audited: "plan", planned: "execute", executing: "execute" };

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };
  const recommended = NEXT_FOR_STAGE[brand.stage];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <Bot className="size-5" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-semibold">Agent</h1>
          <p className="text-sm text-muted-foreground">Connect Claude Desktop with the MCP button, then paste one of these prompts.</p>
        </div>
      </div>
      {(Object.keys(PROMPT_LABELS) as PromptKind[]).map((kind) => (
        <section key={kind} className={`rounded-xl border bg-card p-4 shadow-sm ${kind === recommended ? "ring-2 ring-primary" : ""}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">
              {PROMPT_LABELS[kind]}
              {kind === recommended && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Next step</span>}
            </h2>
            <CopyButton text={agentPrompt(kind, b)} label="Copy prompt" variant={kind === recommended ? "default" : "outline"} />
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{agentPrompt(kind, b)}</pre>
        </section>
      ))}
    </div>
  );
}
```

`app/b/[slug]/briefs/page.tsx`:
```tsx
import { Placeholder } from "@/components/workspace/placeholder";

export default function BriefsPage() {
  return <Placeholder title="Briefs" body="Daily and weekly briefs summarizing activity, approvals, and tracker movement arrive in the next slice." />;
}
```

`app/b/[slug]/calendar/page.tsx`:
```tsx
import { Placeholder } from "@/components/workspace/placeholder";

export default function CalendarPage() {
  return <Placeholder title="Calendar" body="A content and campaign calendar built from plan items arrives in the next slice." />;
}
```

- [ ] **Step 6: Verify in the browser**

Run: `pnpm build && pnpm dev`. Expected:
- **MCP** button opens the dialog; Create token shows a one-time `hm_…` token and fills it into the Claude Desktop config; the token appears under "Your tokens" and Revoke marks it revoked.
- **Browser Automation** shows the steps and copies prompts.
- `/b/superthriftdeals-org/analytics` shows a Health line across the imported SuperThrift audits and six category lines.
- `/b/test-brand/agent` highlights the recommended next prompt.
- Briefs and Calendar show "Coming next".
- From Git Bash, prove the endpoint rejects anonymous calls: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/mcp -H "Content-Type: application/json" -d '{}'` → `401`.

- [ ] **Step 7: Commit**

```bash
git add app components
git commit -m "feat(ui): analytics trends and tracker verdicts, agent prompts, MCP and browser automation dialogs"
```

### Task 19: End-to-end test, docs, deployment, and the live Claude Desktop check

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/workspace.spec.ts`, `README.md`
- Modify: `.gitignore` (add `tests/e2e/.state.json`)

**Interfaces:**
- Consumes: the whole app; `resetDb`, `createTestUser` (Task 5/6); `createApiToken` (Task 11); test ids and labels from Tasks 15–18.

- [ ] **Step 1: Playwright config** — `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";
import { loadEnv } from "vite";

const env = loadEnv("test", process.cwd(), "");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm dev --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-unused",
    },
  },
});
```

- [ ] **Step 2: Global setup** — `tests/e2e/global-setup.ts`

```ts
import { writeFileSync } from "node:fs";
import { loadEnv } from "vite";

export default async function globalSetup() {
  Object.assign(process.env, loadEnv("test", process.cwd(), ""));
  const { resetDb, createTestUser } = await import("../helpers/db");
  const { createApiToken } = await import("@/lib/services/tokens");
  const { sql } = await import("@/lib/data/db");
  await resetDb();
  const actor = await createTestUser(process.env.AUTH_BYPASS_EMAIL);
  const { token } = await createApiToken(actor.userId, "e2e");
  writeFileSync("tests/e2e/.state.json", JSON.stringify({ token }));
  await sql.end();
}
```
Append `tests/e2e/.state.json` to `.gitignore`.

- [ ] **Step 3: Write the end-to-end test** — `tests/e2e/workspace.spec.ts`

```ts
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";

const { token } = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as { token: string };
const CATEGORIES = ["ai_visibility", "geo", "seo", "website_content", "social", "paid_ads"];

async function connect(baseURL: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return {
    async call(name: string, args: Record<string, unknown>) {
      const r = await client.callTool({ name, arguments: args });
      const body = JSON.parse((r.content as { text: string }[])[0].text);
      if (r.isError) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
      return body;
    },
    close: () => client.close(),
  };
}

test("rejects MCP calls without a token", async ({ request }) => {
  const res = await request.post("/api/mcp", { data: {}, headers: { "Content-Type": "application/json" } });
  expect(res.status()).toBe(401);
});

test("add brand → agent audits and plans over MCP → approve → verdict → preview", async ({ page, baseURL }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add brand" }).click();
  await page.getByLabel("Brand name").fill("E2E Roofing");
  await page.getByLabel("Website").fill("e2e-roofing.example");
  await page.getByRole("button", { name: "Create brand" }).click();
  await expect(page).toHaveURL(/\/b\/e2e-roofing\/plan/);
  await expect(page.getByText("No audit yet")).toBeVisible();

  const mcp = await connect(baseURL!);
  const scores = (n: number) => CATEGORIES.map((category) => ({ category, score: n }));
  await mcp.call("record_audit", { brand: "e2e-roofing", audited_at: "2026-09-01", scores: scores(40), request_id: "e2e-a1" });
  await mcp.call("record_audit", { brand: "e2e-roofing", audited_at: "2026-09-20", scores: scores(52), request_id: "e2e-a2" });
  await mcp.call("create_plan_version", {
    brand: "e2e-roofing",
    request_id: "e2e-p1",
    plan: { objective: "Get roofing leads", primary_channel: "SEO" },
    items: [
      { title: "Launch $500 search test", funnel_stage: "acquisition", priority: 1, needs_approval: true },
      { title: "Publish Flowood page", funnel_stage: "acquisition", priority: 2 },
    ],
  });
  await mcp.call("write_file", {
    brand: "e2e-roofing",
    path: "deliverables/hello.md",
    content: "---\nname: hello\n---\n# Hello preview\n\n| col | value |\n|---|---|\n| leads | 42 |\n",
  });

  await page.reload();
  await expect(page.getByTestId("health-score")).toHaveText("52");
  await expect(page.getByTestId("health-delta")).toContainText("+12");
  await page.getByRole("button", { name: "Approve Launch $500 search test" }).click();
  await expect(page.getByTestId("status-Launch $500 search test")).toHaveText("Approved");

  const next = await mcp.call("get_next_plan_item", { brand: "e2e-roofing" });
  expect(next.item.title).toBe("Launch $500 search test");
  const done = await mcp.call("update_plan_item", {
    item_id: next.item.id,
    status: "done",
    tracker: { kpi: "Leads", direction: "up", baseline_value: 4, baseline_at: "2026-08-01", source: "GA4", window_days: 14 },
  });
  await mcp.call("add_checkin", { tracker_id: done.item.tracker.id, value: 9, observed_at: "2026-08-20", source: "GA4" });
  await mcp.close();

  await page.goto("/b/e2e-roofing/analytics");
  await expect(page.getByRole("row", { name: /Leads/ })).toContainText("positive");

  await page.goto("/b/e2e-roofing/plan?pane=assets&scope=brand&file=deliverables/hello.md");
  await expect(page.getByRole("heading", { name: "Hello preview" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "42" })).toBeVisible();
});
```

- [ ] **Step 4: Run the E2E suite**

Local Supabase must be running (`pnpm dlx supabase status`).
Run: `pnpm e2e`
Expected: 2 passed. On failure, open the trace: `pnpm exec playwright show-trace test-results/**/trace.zip`.

- [ ] **Step 5: Write the README** — `README.md`

````markdown
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
````

- [ ] **Step 6: Run everything and commit**

Run: `pnpm lint && pnpm test && pnpm build && pnpm e2e`
Expected: lint clean, all unit and integration tests pass, build succeeds, 2 E2E tests pass.

```bash
git add -A
git commit -m "test(e2e): full marketing loop over UI and MCP; docs: setup and deployment"
```

- [ ] **Step 7: Deploy a preview and run the live check** (manual, with the user)

1. Follow README "Production" steps 1–4 with the user; they create the Supabase project, Google OAuth client, and Vercel project (these need their accounts).
2. Push the branch and open the Vercel preview URL. Sign in with an allowlisted Google account. Expected: lands on the empty state or the first brand. Sign in with a non-allowlisted account. Expected: "That Google account isn't on the Five Hughes team list."
3. In the app, add a brand named "Live Check" with a real test domain, open **MCP**, create a token, and install the config in Claude Desktop.
4. In Claude Desktop, paste the Agent tab's **Onboard**, then **Audit**, then **Build the plan** prompts. Expected: onboarding answers saved, `BRAND.md` and an `audits/…-full-audit.md` file appear in Assets, the Health score appears in the top bar, and the Plan tab shows the funnel and items with approval-required items marked.
5. Approve one item in the app and paste **Work the next plan item**. Expected: the item moves to Done with a tracker showing "measuring until …".
6. Record the outcome (what worked, anything that failed with the exact error) in `docs/superpowers/live-check-2026-10.md` and commit it.


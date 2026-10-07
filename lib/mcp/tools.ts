import { z } from "zod";
import { FUNNEL_STAGES } from "@/lib/domain/funnel";
import { SERVICES } from "@/lib/domain/integrations";
import { METRIC_SOURCES } from "@/lib/domain/metrics";
import { missingOnboardingQuestions } from "@/lib/domain/questions";
import { CATEGORIES } from "@/lib/domain/scoring";
import { logActivity } from "@/lib/services/activity";
import { recordAudit } from "@/lib/services/audits";
import { getBrandBySlug, listBrands, saveOnboarding } from "@/lib/services/brands";
import { getBrandContext, getPlanQuestions } from "@/lib/services/context";
import { NotFoundError } from "@/lib/services/errors";
import { fileDownloadUrl, listFiles, readFile, writeFile } from "@/lib/services/files";
import { upsertIntegration } from "@/lib/services/integrations";
import { syncBrandMetrics } from "@/lib/services/metrics";
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
  source: z
    .string()
    .describe(
      "Where the number comes from, e.g. GA4, GSC, Google Ads. Use exactly ga4:sessions, ga4:users, ga4:key_events, gsc:clicks, gsc:impressions, gsc:ctr or gsc:position and the app checks in automatically after each sync_metrics (set baseline_value to the same measure over the window_days before baseline_at: summed for ga4:sessions, ga4:users, ga4:key_events, gsc:clicks and gsc:impressions; for gsc:ctr use total clicks divided by total impressions, and for gsc:position the impressions-weighted average position).",
    ),
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
    name: "sync_metrics",
    description:
      "Pull the latest Google Analytics 4 and Search Console metrics for a brand into the app (daily data for the Analytics tab). Trackers whose source is ga4:<metric> or gsc:<metric> are checked in automatically. Returns one result per source: ok, skipped (not connected or no identifier), or error with the exact reason.",
    input: {
      brand: brandArg,
      source: z.enum(METRIC_SOURCES).optional().describe("Only this source. Omit for both ga4 and gsc."),
      days: z.number().int().min(1).max(400).optional().describe("How many days back to pull. Omit for the default (90 on the first sync, otherwise a rolling 7 days, longer if the last sync was more than 7 days ago)."),
    },
    handler: async ({ brand, source, days }, { actor }) => ({ results: await syncBrandMetrics({ brandSlug: brand, source, days, actor }) }),
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

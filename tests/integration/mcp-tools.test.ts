import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { METRICS } from "@/lib/domain/metrics";
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
        "sync_metrics",
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

  it("documents every auto-check-in tracker source from the metrics catalog on start_tracker", () => {
    const canonical = METRICS.filter((m) => !m.dimensional).map((m) => `${m.source}:${m.id}`);
    expect(canonical).toHaveLength(7);
    const description = findTool("start_tracker").input.source.description ?? "";
    for (const entry of canonical) expect(description, entry).toContain(entry);
  });

  it("tells agents how to compute ratio and weighted baselines for gsc:ctr and gsc:position", () => {
    const description = findTool("start_tracker").input.source.description ?? "";
    expect(description).toContain("impressions-weighted");
    expect(description).toContain("total clicks");
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

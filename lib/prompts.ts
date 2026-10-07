export type PromptKind = "onboard" | "audit" | "plan" | "execute" | "checkin" | "sync";

export const PROMPT_LABELS: Record<PromptKind, string> = {
  onboard: "Onboard the brand",
  audit: "Run an audit",
  plan: "Build the plan",
  execute: "Work the next plan item",
  checkin: "Check in on trackers",
  sync: "Sync analytics",
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
   If Google Analytics or Search Console is connected for this brand, set the tracker source to exactly one of ga4:sessions, ga4:users, ga4:key_events, gsc:clicks, gsc:impressions, gsc:ctr, gsc:position so the app checks in automatically, and make baseline_value that same measure summed (or, for gsc:ctr and gsc:position, computed) over the window_days before baseline_at.
If the work needs something published, spent, or changed live, stop and tell me — I approve it in the app.`;
    case "checkin":
      return `${intro}

Check in on impact:
1. Call sync_metrics for this brand. Trackers whose source is ga4:<metric> or gsc:<metric> are checked in automatically.
2. For every other tracker whose verdict is pending, get the current KPI value from its source (Google Ads, the site, or another tool).
3. Call add_checkin with the value, observed_at, and source.
4. Report each verdict (positive, neutral, negative, or still measuring).
If the latest audit is more than 30 days old, recommend rerunning the audit.`;
    case "sync":
      return `${intro}

Pull the latest analytics for this brand:
1. Call sync_metrics with brand "${b.slug}" and no other arguments.
2. For any source that comes back "error" or "skipped", tell me the exact message so I can fix the connection. Do not retry more than once.
3. Call get_brand_context again and report every tracker whose source starts with ga4: or gsc: with its latest value and verdict.
Trackers with any other source still need add_checkin from you.`;
  }
}

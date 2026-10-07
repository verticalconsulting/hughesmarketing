import { describe, expect, it } from "vitest";
import { METRICS, parseTrackerSource } from "./domain/metrics";
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
    expect(agentPrompt("execute", brand)).toContain("ga4:sessions");
    expect(agentPrompt("checkin", brand)).toContain("sync_metrics");
    expect(agentPrompt("sync", brand)).toContain('sync_metrics with brand "roofcoms-com"');
    expect(Object.keys(PROMPT_LABELS)).toEqual(["onboard", "audit", "plan", "execute", "checkin", "sync"]);
  });

  it("lists every auto-check-in tracker source from the metrics catalog in the execute prompt", () => {
    const canonical = METRICS.filter((m) => !m.dimensional).map((m) => `${m.source}:${m.id}`);
    expect(canonical).toHaveLength(7);
    const prompt = agentPrompt("execute", brand);
    // gsc:ctr and gsc:position are also mentioned later in the prompt, so check the instruction's own list too.
    expect(prompt).toContain(`exactly one of ${canonical.join(", ")} so`);
    for (const entry of canonical) {
      expect(prompt, entry).toContain(entry);
      const [source, metric] = entry.split(":");
      expect(parseTrackerSource(entry)).toEqual({ source, metric });
    }
  });
});

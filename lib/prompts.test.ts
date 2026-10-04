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

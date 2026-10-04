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

import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { FORBIDDEN_PROPERTY } from "./fake-google";

// The leading "z" makes this run after workspace.spec.ts, which expects an empty database.
const { token } = JSON.parse(readFileSync("tests/e2e/.state.json", "utf8")) as { token: string };

test.beforeAll(async () => {
  const { sql } = await import("@/lib/data/db");
  const { createTestUser } = await import("../helpers/db");
  const { createBrand } = await import("@/lib/services/brands");
  const { upsertIntegration } = await import("@/lib/services/integrations");
  const actor = await createTestUser("metrics-e2e@test.local");
  await createBrand({ name: "E2E Metrics", domain: "e2e-metrics.example", actor });
  await createBrand({ name: "E2E Broken", domain: "e2e-broken.example", actor });
  const connect = (brandSlug: string, service: "ga4" | "gsc", identifiers: Record<string, string>) =>
    upsertIntegration({ brandSlug, service, status: "connected", identifiers, actor });
  await connect("e2e-metrics", "ga4", { property_id: "515827425" });
  await connect("e2e-metrics", "gsc", { site_url: "sc-domain:e2e-metrics.example" });
  await connect("e2e-broken", "ga4", { property_id: FORBIDDEN_PROPERTY });
  await connect("e2e-broken", "gsc", { site_url: "sc-domain:e2e-broken.example" });
  await sql.end();
});

test("Sync now pulls GA4 and Search Console into the Analytics tab", async ({ page }) => {
  await page.goto("/b/e2e-metrics/plan?pane=integrations");
  await expect(page.getByText("Never synced")).toHaveCount(2);

  await page.getByRole("button", { name: "Sync Google Analytics 4 now" }).click();
  await expect(page.getByText("Google Analytics 4 synced (270 rows)")).toBeVisible();
  await page.getByRole("button", { name: "Sync Google Search Console now" }).click();
  await expect(page.getByText("Google Search Console synced (720 rows)")).toBeVisible();

  await page.goto("/b/e2e-metrics/analytics");
  await expect(page.getByRole("heading", { name: "Traffic (GA4)" })).toBeVisible();
  await expect(page.getByTestId("traffic-chart")).toBeVisible();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("1,800");
  await expect(page.getByTestId("gsc-impressions")).toHaveText("36,000");
  await expect(page.getByTestId("gsc-ctr")).toHaveText("5.0%");
  await expect(page.getByTestId("gsc-position")).toHaveText("8.5");
  await expect(page.getByRole("cell", { name: "roof repair flowood" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "/services" })).toBeVisible();

  await page.getByRole("link", { name: "30 days" }).click();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("600");
});

test("a forbidden property shows its exact reason and does not block Search Console (via MCP)", async ({ page, baseURL }) => {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
  );
  const r = await client.callTool({ name: "sync_metrics", arguments: { brand: "e2e-broken" } });
  await client.close();
  const body = JSON.parse((r.content as { text: string }[])[0].text) as { results: { source: string; status: string; message?: string }[] };
  expect(body.results.map((x) => [x.source, x.status])).toEqual([["ga4", "error"], ["gsc", "ok"]]);
  expect(body.results[0].message).toContain("does not have access to GA4 property 403403");

  await page.goto("/b/e2e-broken/analytics");
  await expect(page.getByRole("alert").filter({ hasText: "does not have access" })).toBeVisible();
  await expect(page.getByTestId("gsc-clicks")).toHaveText("1,800");
});

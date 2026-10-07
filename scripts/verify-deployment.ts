// Smoke-checks a deployed instance. Exits non-zero if any check fails.
// Usage: pnpm tsx scripts/verify-deployment.ts https://your-app.vercel.app
// Optional: MCP_TOKEN=hm_... also checks the authenticated MCP tool list.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base) {
  console.error("Usage: pnpm tsx scripts/verify-deployment.ts <base-url>");
  process.exit(2);
}

type Check = { name: string; run: () => Promise<string | null> }; // null = pass, string = why it failed

const checks: Check[] = [
  {
    name: "login page is public and offers Google sign-in",
    run: async () => {
      const res = await fetch(`${base}/login`, { redirect: "manual" });
      if (res.status === 401) return "got 401 - Vercel Deployment Protection is on; use a bypass token or disable it for previews";
      if (res.status !== 200) return `expected 200, got ${res.status}`;
      return (await res.text()).includes("Continue with Google") ? null : "page loaded but has no Google sign-in button";
    },
  },
  {
    name: "workspace requires sign-in (auth bypass is OFF)",
    run: async () => {
      const res = await fetch(`${base}/b/anything/plan`, { redirect: "manual" });
      if (res.status === 401) return "got 401 - Vercel Deployment Protection is on";
      // A 200 or a 404 (the made-up brand does not exist) both mean the page was reached without signing in.
      if (res.status === 200 || res.status === 404) {
        return `workspace reachable WITHOUT sign-in (got ${res.status}) - ALLOW_AUTH_BYPASS may be set; remove it immediately`;
      }
      const where = res.headers.get("location") ?? "";
      return res.status >= 300 && res.status < 400 && where.includes("/login") ? null : `expected redirect to /login, got ${res.status} ${where}`;
    },
  },
  {
    name: "MCP endpoint rejects calls without a token",
    run: async () => {
      const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return res.status === 401 ? null : `expected 401, got ${res.status}`;
    },
  },
  {
    name: "MCP endpoint rejects a wrong token",
    run: async () => {
      const res = await fetch(`${base}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer hm_not_a_real_token" },
        body: "{}",
      });
      return res.status === 401 ? null : `expected 401, got ${res.status}`;
    },
  },
  {
    name: "no public response leaks service-account key material",
    run: async () => {
      for (const path of ["/login", "/api/mcp"]) {
        const res = await fetch(`${base}${path}`, { redirect: "manual" });
        const text = await res.text();
        if (/private_key|BEGIN (RSA )?PRIVATE KEY/.test(text)) return `${path} response contains key material`;
      }
      return null;
    },
  },
];

if (process.env.MCP_TOKEN) {
  checks.push({
    name: "MCP endpoint lists all 18 tools with a valid token",
    run: async () => {
      const client = new Client({ name: "verify-deployment", version: "1.0.0" });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL("/api/mcp", base), {
            requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` } },
          }),
        );
        const { tools } = await client.listTools();
        return tools.length === 18 ? null : `expected 18 tools, got ${tools.length}`;
      } catch (e) {
        return `could not connect: ${(e as Error).message}`;
      } finally {
        await client.close().catch(() => {});
      }
    },
  });
}

let failed = 0;
for (const check of checks) {
  let problem: string | null;
  try {
    problem = await check.run();
  } catch (e) {
    problem = `request failed: ${(e as Error).message}`;
  }
  console.log(`${problem === null ? "PASS" : "FAIL"}  ${check.name}${problem ? `\n      ${problem}` : ""}`);
  if (problem !== null) failed++;
}
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);

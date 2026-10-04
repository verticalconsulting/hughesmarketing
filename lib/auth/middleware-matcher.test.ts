import { describe, expect, it } from "vitest";
import { config } from "../../middleware";

// The matcher lists the paths middleware RUNS on, so a path that does not match skips the session check.
const runsOn = (p: string) => new RegExp(`^${config.matcher[0]}$`).test(p);

describe("middleware matcher", () => {
  it("protects app pages and routes that merely start with an exempt name", () => {
    for (const p of ["/", "/b/e2e-roofing/plan", "/authorize", "/loginhelp", "/auth-admin", "/api/mcpx"]) {
      expect(runsOn(p), p).toBe(true);
    }
  });

  it("leaves login, the auth callback, MCP, and static assets public", () => {
    for (const p of ["/login", "/auth/callback", "/api/mcp", "/_next/static/chunk.js", "/favicon.ico"]) {
      expect(runsOn(p), p).toBe(false);
    }
  });
});

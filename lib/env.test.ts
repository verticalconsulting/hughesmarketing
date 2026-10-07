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

  it("treats GOOGLE_SERVICE_ACCOUNT_JSON as optional so existing deployments keep working", () => {
    expect(parseEnv({ DATABASE_URL: "postgresql://x" }).GOOGLE_SERVICE_ACCOUNT_JSON).toBeUndefined();
    expect(parseEnv({ DATABASE_URL: "postgresql://x", GOOGLE_SERVICE_ACCOUNT_JSON: "{}" }).GOOGLE_SERVICE_ACCOUNT_JSON).toBe("{}");
  });
});

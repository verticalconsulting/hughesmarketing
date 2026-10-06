import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors";
import { apiBase, parseServiceAccount } from "./google-auth";

afterEach(() => vi.unstubAllEnvs());

function failure(raw: string | undefined): ConnectorError {
  try {
    parseServiceAccount(raw);
  } catch (e) {
    return e as ConnectorError;
  }
  throw new Error("expected parseServiceAccount to throw");
}

describe("parseServiceAccount", () => {
  it("returns the client email and private key", () => {
    const sa = parseServiceAccount(JSON.stringify({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: "KEY", other: 1 }));
    expect(sa).toEqual({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: "KEY" });
  });

  it("explains an unset value", () => {
    for (const raw of [undefined, "", "   "]) {
      const e = failure(raw);
      expect(e).toBeInstanceOf(ConnectorError);
      expect(e.code).toBe("not_configured");
      expect(e.message).toMatch(/not configured/i);
    }
  });

  it("explains invalid JSON (for example a pretty-printed paste) without echoing any of it", () => {
    // A truncated paste: valid-looking start, no closing brace.
    const e = failure('{\n  "client_email": "a@b.c",\n  "private_key": "SECRETVALUE"\n');
    expect(e.code).toBe("not_configured");
    expect(e.message).toMatch(/one line/i);
    expect(e.message).not.toContain("SECRETVALUE");
    expect(String(e.stack)).not.toContain("SECRETVALUE");
  });

  it("explains a key file that lacks client_email or private_key without echoing it", () => {
    const e = failure(JSON.stringify({ client_email: "a@b.c", note: "SECRETVALUE" }));
    expect(e.code).toBe("not_configured");
    expect(e.message).toMatch(/client_email and private_key/);
    expect(e.message).not.toContain("SECRETVALUE");
  });
});

describe("apiBase", () => {
  it("uses the real base by default", () => {
    expect(apiBase("https://analyticsdata.googleapis.com/")).toBe("https://analyticsdata.googleapis.com");
  });

  it("uses the test override outside production", () => {
    vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://127.0.0.1:3199/");
    expect(apiBase("https://analyticsdata.googleapis.com")).toBe("http://127.0.0.1:3199");
  });

  it("ignores the test override in production", () => {
    vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://127.0.0.1:3199");
    vi.stubEnv("NODE_ENV", "production");
    expect(apiBase("https://analyticsdata.googleapis.com")).toBe("https://analyticsdata.googleapis.com");
  });
});

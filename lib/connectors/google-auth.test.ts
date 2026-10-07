const getAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock("google-auth-library", () => ({
  JWT: class {
    getAccessToken = getAccessTokenMock;
  },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sync@proj.iam.gserviceaccount.com", private_key: "KEY" }),
  }),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("getAccessToken", () => {
  beforeEach(() => {
    getAccessTokenMock.mockReset();
  });

  it("rejects with response.status 400 as permission_denied without leaking secrets", async () => {
    const { getAccessToken } = await import("./google-auth");
    const err = Object.assign(new Error("invalid_grant SECRET-KEY-MATERIAL"), { response: { status: 400 } });
    getAccessTokenMock.mockRejectedValue(err);

    try {
      await getAccessToken("ga4");
      throw new Error("expected to throw");
    } catch (e) {
      const cerr = e as ConnectorError;
      expect(cerr.code).toBe("permission_denied");
      expect(cerr.message).not.toContain("SECRET-KEY-MATERIAL");
      expect(String(cerr.stack)).not.toContain("SECRET-KEY-MATERIAL");
    }
  });

  it("rejects with response.status 503 as unavailable without leaking secrets", async () => {
    const { getAccessToken } = await import("./google-auth");
    const err = Object.assign(new Error("Service unavailable SECRET-KEY-MATERIAL"), { response: { status: 503 } });
    getAccessTokenMock.mockRejectedValue(err);

    try {
      await getAccessToken("ga4");
      throw new Error("expected to throw");
    } catch (e) {
      const cerr = e as ConnectorError;
      expect(cerr.code).toBe("unavailable");
      expect(cerr.message).not.toContain("SECRET-KEY-MATERIAL");
      expect(String(cerr.stack)).not.toContain("SECRET-KEY-MATERIAL");
    }
  });

  it("rejects with response.status 429 as quota without leaking secrets", async () => {
    const { getAccessToken } = await import("./google-auth");
    const err = Object.assign(new Error("Too many requests SECRET-KEY-MATERIAL"), { response: { status: 429 } });
    getAccessTokenMock.mockRejectedValue(err);

    try {
      await getAccessToken("ga4");
      throw new Error("expected to throw");
    } catch (e) {
      const cerr = e as ConnectorError;
      expect(cerr.code).toBe("quota");
      expect(cerr.message).not.toContain("SECRET-KEY-MATERIAL");
      expect(String(cerr.stack)).not.toContain("SECRET-KEY-MATERIAL");
    }
  });

  it("rejects with plain error (no status) as unavailable without leaking secrets", async () => {
    const { getAccessToken } = await import("./google-auth");
    getAccessTokenMock.mockRejectedValue(new Error("socket hang up SECRET-KEY-MATERIAL"));

    try {
      await getAccessToken("ga4");
      throw new Error("expected to throw");
    } catch (e) {
      const cerr = e as ConnectorError;
      expect(cerr.code).toBe("unavailable");
      expect(cerr.message).not.toContain("SECRET-KEY-MATERIAL");
      expect(String(cerr.stack)).not.toContain("SECRET-KEY-MATERIAL");
    }
  });

  it("rejects with top-level status 401 as permission_denied", async () => {
    const { getAccessToken } = await import("./google-auth");
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    getAccessTokenMock.mockRejectedValue(err);

    try {
      await getAccessToken("ga4");
      throw new Error("expected to throw");
    } catch (e) {
      const cerr = e as ConnectorError;
      expect(cerr.code).toBe("permission_denied");
    }
  });

  it("resolves with token on success", async () => {
    const { getAccessToken } = await import("./google-auth");
    getAccessTokenMock.mockResolvedValue({ token: "tok-123" });

    const token = await getAccessToken("ga4");
    expect(token).toBe("tok-123");
  });
});

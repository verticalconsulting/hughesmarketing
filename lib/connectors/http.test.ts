import { describe, expect, it } from "vitest";
import { ConnectorError } from "./errors";
import { postJson } from "./http";

const base = { url: "https://example.test/x", token: "SECRET-TOKEN", body: { a: 1 }, what: "GA4 property 515827425", sleep: async () => {} };
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

async function failure(p: Promise<unknown>): Promise<ConnectorError> {
  try {
    await p;
  } catch (e) {
    return e as ConnectorError;
  }
  throw new Error("expected a rejection");
}

describe("postJson", () => {
  it("posts JSON with a bearer token and returns the parsed body", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const out = await postJson<{ ok: boolean }>({
      ...base,
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init! };
        return res(200, { ok: true });
      },
    });
    expect(out).toEqual({ ok: true });
    expect(seen?.url).toBe("https://example.test/x");
    expect((seen?.init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-TOKEN");
    expect(seen?.init.body).toBe('{"a":1}');
  });

  it("maps 403 to permission_denied naming the service account and the target, and never leaks the token", async () => {
    const e = await failure(postJson({ ...base, serviceAccountEmail: "sync@proj.iam.gserviceaccount.com", fetchImpl: async () => res(403, { error: "SECRET-BODY" }) }));
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("sync@proj.iam.gserviceaccount.com");
    expect(e.message).toContain("GA4 property 515827425");
    expect(e.message).not.toContain("SECRET-TOKEN");
    expect(e.message).not.toContain("SECRET-BODY");
  });

  it("maps 404 and 400 to not_found and bad_identifier", async () => {
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(404) }))).code).toBe("not_found");
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(400) }))).code).toBe("bad_identifier");
  });

  it("retries once on 429 and succeeds", async () => {
    let calls = 0;
    const out = await postJson<{ ok: boolean }>({ ...base, fetchImpl: async () => (++calls === 1 ? res(429) : res(200, { ok: true })) });
    expect(out).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("gives up after one retry: quota for 429, unavailable for 5xx and network errors", async () => {
    let calls = 0;
    const quota = await failure(postJson({ ...base, fetchImpl: async () => (calls++, res(429)) }));
    expect(quota.code).toBe("quota");
    expect(calls).toBe(2);
    expect((await failure(postJson({ ...base, fetchImpl: async () => res(503) }))).code).toBe("unavailable");
    expect((await failure(postJson({ ...base, fetchImpl: async () => { throw new TypeError("fetch failed"); } }))).code).toBe("unavailable");
  });

  it("does not retry a 403", async () => {
    let calls = 0;
    await failure(postJson({ ...base, fetchImpl: async () => (calls++, res(403)) }));
    expect(calls).toBe(1);
  });

  it("maps 200 with non-JSON body to unavailable without leaking the body", async () => {
    const e = await failure(postJson({ ...base, fetchImpl: async () => new Response("<html>SECRET-BODY</html>", { status: 200 }) }));
    expect(e.code).toBe("unavailable");
    expect(e.message).toContain("unreadable response");
    expect(e.message).not.toContain("SECRET-BODY");
    expect(String(e.stack)).not.toContain("SECRET-BODY");
  });
});

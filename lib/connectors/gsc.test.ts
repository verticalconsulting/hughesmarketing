import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GSC_ROW_LIMIT, gscConnector, parseDailyRows, topDimension } from "./gsc";

const row = (keys: string[], clicks: number, impressions = 100) => ({ keys, clicks, impressions, ctr: clicks / impressions, position: 8 });

beforeEach(() => vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://fake-google"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseDailyRows", () => {
  it("emits clicks, impressions, ctr, and position per date", () => {
    expect(parseDailyRows([{ keys: ["2026-10-03"], clicks: 5, impressions: 100, ctr: 0.05, position: 7.5 }])).toEqual([
      { metric: "clicks", date: "2026-10-03", dimension: "", value: 5 },
      { metric: "impressions", date: "2026-10-03", dimension: "", value: 100 },
      { metric: "ctr", date: "2026-10-03", dimension: "", value: 0.05 },
      { metric: "position", date: "2026-10-03", dimension: "", value: 7.5 },
    ]);
  });
});

describe("topDimension", () => {
  it("keeps only the top N labels by total clicks, with all of their per-day rows", () => {
    const rows = [
      row(["2026-10-01", "roof repair"], 5),
      row(["2026-10-02", "roof repair"], 5),
      row(["2026-10-01", "roofers near me"], 7),
      row(["2026-10-01", "shingles"], 1),
    ];
    const out = topDimension(rows, "query_clicks", 2);
    expect(out).toEqual([
      { metric: "query_clicks", date: "2026-10-01", dimension: "query:roof repair", value: 5 },
      { metric: "query_clicks", date: "2026-10-02", dimension: "query:roof repair", value: 5 },
      { metric: "query_clicks", date: "2026-10-01", dimension: "query:roofers near me", value: 7 },
    ]);
  });

  it("prefixes pages with page: and keeps the full URL so hosts do not collide", () => {
    const out = topDimension([row(["2026-10-01", "https://a.com/x"], 3), row(["2026-10-01", "https://b.com/x"], 2)], "page_clicks", 5);
    expect(out.map((p) => p.dimension)).toEqual(["page:https://a.com/x", "page:https://b.com/x"]);
  });

  it("breaks ties by label so results are deterministic", () => {
    const out = topDimension([row(["d", "b"], 1), row(["d", "a"], 1)], "query_clicks", 1);
    expect(out.map((p) => p.dimension)).toEqual(["query:a"]);
  });
});

describe("gscConnector", () => {
  function stubGsc(handler: (body: Record<string, unknown>, url: string) => unknown) {
    const fn = vi.fn(async (url: string, init: RequestInit) => new Response(JSON.stringify(handler(JSON.parse(String(init.body)), url)), { status: 200 }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("makes a daily, a query, and a page request against the percent-encoded site and combines the results", async () => {
    const fetchMock = stubGsc((body) => {
      const dims = body.dimensions as string[];
      if (dims.join() === "date") return { rows: [{ keys: ["2026-10-03"], clicks: 5, impressions: 100, ctr: 0.05, position: 7 }] };
      if (dims.join() === "date,query") return { rows: [row(["2026-10-03", "roof repair"], 3)] };
      return { rows: [row(["2026-10-03", "https://example.com/"], 4)] };
    });
    const points = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fake-google/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(JSON.parse(String(init.body))).toMatchObject({ startDate: "2026-10-01", endDate: "2026-10-04", dimensions: ["date"], rowLimit: GSC_ROW_LIMIT, startRow: 0 });
    expect(points.map((p) => p.metric)).toEqual(["clicks", "impressions", "ctr", "position", "query_clicks", "page_clicks"]);
  });

  it("falls back to the importer's legacy `site` identifier and normalizes a bare origin", async () => {
    const fetchMock = stubGsc(() => ({}));
    await gscConnector({ identifiers: { site: "https://example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain("/sites/https%3A%2F%2Fexample.com%2F/");
  });

  it("returns no points for a site with no search data", async () => {
    stubGsc(() => ({}));
    expect(await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" })).toEqual([]);
  });

  it("pages through a full 25,000-row response using startRow", async () => {
    const full = Array.from({ length: GSC_ROW_LIMIT }, (_, i) => ({ keys: [`2026-10-01`], clicks: 1, impressions: 1, ctr: 1, position: 1, i }));
    const startRows: number[] = [];
    stubGsc((body) => {
      if ((body.dimensions as string[]).join() !== "date") return {};
      startRows.push(body.startRow as number);
      return { rows: body.startRow === 0 ? full : [{ keys: ["2026-10-02"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] };
    });
    const points = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect(startRows).toEqual([0, GSC_ROW_LIMIT]);
    expect(points.filter((p) => p.metric === "clicks")).toHaveLength(GSC_ROW_LIMIT + 1);
  });

  it("rejects a missing or malformed site before making any request", async () => {
    const fetchMock = stubGsc(() => ({}));
    for (const identifiers of [{}, { site_url: "example.com" }, { site_url: "ftp://example.com/" }] as Record<string, string>[]) {
      await expect(gscConnector({ identifiers, from: "2026-10-01", to: "2026-10-04" })).rejects.toMatchObject({ code: "bad_identifier" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps dimension result sets at 4 pages (100,000 rows) without error", async () => {
    const fullPage = Array.from({ length: GSC_ROW_LIMIT }, (_, i) => ({ keys: [`2026-10-01`, `query${i}`], clicks: 1, impressions: 1, ctr: 1, position: 1 }));
    const queryStartRows: number[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const dims = (body.dimensions as string[]).join();
      if (dims === "date,query") {
        queryStartRows.push(body.startRow as number);
        return new Response(JSON.stringify({ rows: fullPage }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const points = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" });
    expect(queryStartRows).toEqual([0, GSC_ROW_LIMIT, GSC_ROW_LIMIT * 2, GSC_ROW_LIMIT * 3]);
    expect(points).toBeDefined();
  });

  it("surfaces a 403 as permission_denied naming the site", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const e = await gscConnector({ identifiers: { site_url: "sc-domain:example.com" }, from: "2026-10-01", to: "2026-10-04" }).catch((x) => x);
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("sc-domain:example.com");
  });
});

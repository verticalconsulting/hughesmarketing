import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectorError } from "./errors";
import { ga4Connector, parseRunReport } from "./ga4";

// Response shape follows the GA4 Data API runReport reference (dimension "date" = YYYYMMDD).
const report = {
  rows: [
    { dimensionValues: [{ value: "20261003" }], metricValues: [{ value: "120" }, { value: "95" }, { value: "4" }] },
    { dimensionValues: [{ value: "20261004" }], metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }] },
  ],
};

beforeEach(() => vi.stubEnv("GOOGLE_API_BASE_OVERRIDE", "http://fake-google"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const stubFetch = (status: number, body: unknown) => {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
};

describe("parseRunReport", () => {
  it("turns each row into one point per metric with ISO dates", () => {
    expect(parseRunReport(report)).toEqual([
      { metric: "sessions", date: "2026-10-03", dimension: "", value: 120 },
      { metric: "users", date: "2026-10-03", dimension: "", value: 95 },
      { metric: "key_events", date: "2026-10-03", dimension: "", value: 4 },
      { metric: "sessions", date: "2026-10-04", dimension: "", value: 0 },
      { metric: "users", date: "2026-10-04", dimension: "", value: 0 },
      { metric: "key_events", date: "2026-10-04", dimension: "", value: 0 },
    ]);
  });

  it("returns nothing for a property with no traffic (GA4 omits the rows key entirely)", () => {
    expect(parseRunReport({})).toEqual([]);
  });

  it("skips malformed rows and non-numeric values instead of failing the sync", () => {
    const rows = [
      { dimensionValues: [{ value: "not-a-date" }], metricValues: [{ value: "1" }] },
      { dimensionValues: [{ value: "20261003" }], metricValues: [{ value: "12" }, { value: "oops" }, { value: "3" }] },
    ];
    expect(parseRunReport({ rows }).map((p) => p.metric)).toEqual(["sessions", "key_events"]);
  });
});

describe("ga4Connector", () => {
  it("requests the date range with the three metrics for the property", async () => {
    const fetchMock = stubFetch(200, report);
    const points = await ga4Connector({ identifiers: { property_id: "properties/515827425" }, from: "2026-10-01", to: "2026-10-04" });
    expect(points).toHaveLength(6);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fake-google/v1beta/properties/515827425:runReport");
    expect(JSON.parse(String(init.body))).toEqual({
      dateRanges: [{ startDate: "2026-10-01", endDate: "2026-10-04" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "keyEvents" }],
      limit: 1000,
    });
  });

  it("rejects a malformed property id before making any request", async () => {
    const fetchMock = stubFetch(200, report);
    for (const property_id of ["UA-123-1", "", "abc"]) {
      await expect(ga4Connector({ identifiers: { property_id }, from: "2026-10-01", to: "2026-10-04" })).rejects.toMatchObject({
        code: "bad_identifier",
      });
    }
    await expect(ga4Connector({ identifiers: {}, from: "2026-10-01", to: "2026-10-04" })).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 403 as permission_denied naming the property", async () => {
    stubFetch(403, { error: { message: "nope" } });
    const e = await ga4Connector({ identifiers: { property_id: "515827425" }, from: "2026-10-01", to: "2026-10-04" }).catch((x) => x);
    expect(e.code).toBe("permission_denied");
    expect(e.message).toContain("GA4 property 515827425");
  });
});

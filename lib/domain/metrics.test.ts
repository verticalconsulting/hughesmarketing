import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregateWindow,
  defaultSyncDays,
  endOfDay,
  getMetric,
  mergeSeries,
  nextSyncedFrom,
  pageLabel,
  parsePropertyId,
  parseSiteUrl,
  parseTrackerSource,
  requiredMetrics,
  siteIdentifier,
  syncRange,
  windowRange,
  type Series,
} from "./metrics";

const s = (...pairs: [string, number][]): Series => pairs.map(([date, value]) => ({ date, value }));
const gsc = (id: string) => getMetric("gsc", id)!;
const ga4 = (id: string) => getMetric("ga4", id)!;

describe("metric catalog", () => {
  it("knows each metric's source, direction, and whether it is dimensional", () => {
    expect(getMetric("ga4", "sessions")).toMatchObject({ aggregation: "sum", direction: "up", dimensional: false });
    expect(getMetric("gsc", "position")).toMatchObject({ aggregation: "weighted_position", direction: "down" });
    expect(getMetric("gsc", "query_clicks")?.dimensional).toBe(true);
    expect(getMetric("ga4", "clicks")).toBeUndefined();
  });
});

describe("parseTrackerSource", () => {
  it("accepts source:metric for daily-total metrics, case-insensitively", () => {
    expect(parseTrackerSource("ga4:sessions")).toEqual({ source: "ga4", metric: "sessions" });
    expect(parseTrackerSource(" GSC:CTR ")).toEqual({ source: "gsc", metric: "ctr" });
  });

  it("rejects free text, unknown metrics, dimensional metrics, and the auto suffix", () => {
    for (const bad of ["GA4", "Google Ads", "ga4:bounce_rate", "gsc:query_clicks", "ga4:sessions (auto)", ""]) {
      expect(parseTrackerSource(bad)).toBeNull();
    }
  });
});

describe("aggregateWindow", () => {
  it("sums count metrics and treats an empty window as zero (a zero-traffic site is not an error)", () => {
    expect(aggregateWindow(ga4("sessions"), { sessions: s(["2026-10-01", 10], ["2026-10-02", 5]) })).toBe(15);
    expect(aggregateWindow(ga4("sessions"), { sessions: [] })).toBe(0);
    expect(aggregateWindow(ga4("sessions"), {})).toBe(0);
  });

  it("recomputes CTR from total clicks over total impressions, not by averaging daily CTR", () => {
    const series = {
      clicks: s(["d1", 9], ["d2", 9]),
      impressions: s(["d1", 900], ["d2", 100]),
      ctr: s(["d1", 0.01], ["d2", 0.09]),
    };
    expect(aggregateWindow(gsc("ctr"), series)).toBeCloseTo(0.018);
  });

  it("returns null for CTR and position when there are no impressions", () => {
    expect(aggregateWindow(gsc("ctr"), { clicks: [], impressions: [] })).toBeNull();
    expect(aggregateWindow(gsc("position"), { position: s(["d1", 3]), impressions: [] })).toBeNull();
  });

  it("weights average position by impressions and ignores days without an impressions row", () => {
    const series = {
      position: s(["d1", 2], ["d2", 10], ["d3", 99]),
      impressions: s(["d1", 900], ["d2", 100]),
    };
    expect(aggregateWindow(gsc("position"), series)).toBeCloseTo(2.8);
  });

  it("lists the metrics each aggregation needs", () => {
    expect(requiredMetrics(ga4("sessions"))).toEqual(["sessions"]);
    expect(requiredMetrics(gsc("ctr"))).toEqual(["clicks", "impressions"]);
    expect(requiredMetrics(gsc("position"))).toEqual(["position", "impressions"]);
  });
});

describe("date ranges", () => {
  it("ends the sync range at yesterday (UTC)", () => {
    expect(syncRange(new Date("2026-10-05T12:00:00Z"), 7)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(syncRange(new Date("2026-10-05T00:00:00Z"), 1)).toEqual({ from: "2026-10-04", to: "2026-10-04" });
    expect(syncRange(new Date("2026-10-05T12:00:00Z"), 90)).toEqual({ from: "2026-07-07", to: "2026-10-04" });
  });

  it("covers windowDays days ending at `to`", () => {
    expect(windowRange("2026-10-04", 30)).toEqual({ from: "2026-09-05", to: "2026-10-04" });
    expect(windowRange("2026-10-04", 1)).toEqual({ from: "2026-10-04", to: "2026-10-04" });
  });

  it("adds days across month boundaries and finds the end of a day", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(endOfDay("2026-10-04").toISOString()).toBe("2026-10-04T23:59:59.999Z");
  });
});

describe("defaultSyncDays", () => {
  const now = new Date("2026-10-05T12:00:00Z");

  it("backfills 90 days on the first sync", () => {
    expect(defaultSyncDays({ firstSync: true, lastSyncedAt: null, now })).toBe(90);
  });

  it("re-pulls a rolling 7 days after a recent sync", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2026-10-05T11:00:00Z"), now })).toBe(7);
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: null, now })).toBe(7);
  });

  it("reaches back over a gap longer than the rolling window so no days are missed", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2026-09-15T12:00:00Z"), now })).toBe(21);
  });

  it("never exceeds 400 days", () => {
    expect(defaultSyncDays({ firstSync: false, lastSyncedAt: new Date("2025-01-01T00:00:00Z"), now })).toBe(400);
  });
});

describe("nextSyncedFrom", () => {
  // The previous sync ran on 2026-10-05, so it covered through 2026-10-04.
  const lastSyncedAt = new Date("2026-10-05T12:00:00Z");

  it("starts at this range on the first sync", () => {
    expect(nextSyncedFrom({ syncedFrom: null, lastSyncedAt: null, from: "2026-07-07" })).toBe("2026-07-07");
    expect(nextSyncedFrom({ syncedFrom: "2026-07-07", lastSyncedAt: null, from: "2026-09-28" })).toBe("2026-09-28");
  });

  it("keeps the old start after a rolling sync right behind the last one", () => {
    expect(nextSyncedFrom({ syncedFrom: "2026-07-07", lastSyncedAt, from: "2026-09-28" })).toBe("2026-07-07");
  });

  it("keeps the old start when the range begins exactly on the day of the last sync", () => {
    expect(nextSyncedFrom({ syncedFrom: "2026-07-07", lastSyncedAt, from: "2026-10-05" })).toBe("2026-07-07");
  });

  it("resets to this range when it starts one day later than that, leaving a gap", () => {
    expect(nextSyncedFrom({ syncedFrom: "2026-07-07", lastSyncedAt, from: "2026-10-06" })).toBe("2026-10-06");
  });

  it("uses this range when it reaches back further than the old start", () => {
    expect(nextSyncedFrom({ syncedFrom: "2026-09-01", lastSyncedAt, from: "2026-07-07" })).toBe("2026-07-07");
  });
});

describe("identifiers", () => {
  it("accepts the GA4 property id formats people paste", () => {
    expect(parsePropertyId("515827425")).toBe("515827425");
    expect(parsePropertyId(" properties/515827425 ")).toBe("515827425");
    for (const bad of ["UA-123456-1", "12", "abc", "", undefined]) expect(parsePropertyId(bad)).toBeNull();
  });

  it("accepts sc-domain and URL-prefix Search Console sites and normalizes a bare origin", () => {
    expect(parseSiteUrl("sc-domain:example.com")).toBe("sc-domain:example.com");
    expect(parseSiteUrl("https://example.com")).toBe("https://example.com/");
    expect(parseSiteUrl("https://example.com/blog/")).toBe("https://example.com/blog/");
    for (const bad of ["example.com", "ftp://example.com/", "sc-domain:bad host", "", undefined]) {
      expect(parseSiteUrl(bad)).toBeNull();
    }
  });

  it("reads the site from site_url, falling back to the importer's legacy `site` key", () => {
    expect(siteIdentifier({ site_url: "a", site: "b" })).toBe("a");
    expect(siteIdentifier({ site: "b" })).toBe("b");
    expect(siteIdentifier({})).toBeUndefined();
  });

  it("treats an empty site_url as unset so the legacy `site` key still applies", () => {
    expect(siteIdentifier({ site_url: "", site: "b" })).toBe("b");
    expect(siteIdentifier({ site_url: "" })).toBeUndefined();
  });
});

describe("mergeSeries", () => {
  it("joins metrics by date in date order, optionally zero-filling missing values", () => {
    const series = { sessions: s(["2026-10-02", 5], ["2026-10-01", 3]), users: s(["2026-10-01", 2]) };
    expect(mergeSeries(series, { zeroFill: true })).toEqual([
      { date: "2026-10-01", sessions: 3, users: 2 },
      { date: "2026-10-02", sessions: 5, users: 0 },
    ]);
    expect(mergeSeries(series)[1]).toEqual({ date: "2026-10-02", sessions: 5 });
  });
});

describe("pageLabel", () => {
  it("shows the path and query of a URL, and leaves non-URLs alone", () => {
    expect(pageLabel("https://x.com/a/b?x=1")).toBe("/a/b?x=1");
    expect(pageLabel("https://x.com/")).toBe("/");
    expect(pageLabel("not a url")).toBe("not a url");
  });
});

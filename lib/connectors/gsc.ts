import { parseSiteUrl, siteIdentifier } from "@/lib/domain/metrics";
import { ConnectorError } from "./errors";
import { apiBase, getAccessToken, serviceAccountEmail } from "./google-auth";
import { postJson } from "./http";
import type { Connector, MetricPointInput } from "./types";

export const GSC_ROW_LIMIT = 25_000;
const MAX_PAGES = 4; // 100,000 rows per dimension set is far beyond what 400 days of top queries needs
const TOP_N = 100;

type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
type GscResponse = { rows?: GscRow[] };

export function parseDailyRows(rows: GscRow[]): MetricPointInput[] {
  const out: MetricPointInput[] = [];
  for (const r of rows) {
    const date = r.keys?.[0];
    if (!date) continue;
    out.push(
      { metric: "clicks", date, dimension: "", value: r.clicks },
      { metric: "impressions", date, dimension: "", value: r.impressions },
      { metric: "ctr", date, dimension: "", value: r.ctr },
      { metric: "position", date, dimension: "", value: r.position },
    );
  }
  return out;
}

/** Rows are keyed [date, label]. Keep the `n` labels with the most total clicks and every per-day row for them. */
export function topDimension(rows: GscRow[], metric: "query_clicks" | "page_clicks", n = TOP_N): MetricPointInput[] {
  const prefix = metric === "query_clicks" ? "query" : "page";
  const totals = new Map<string, number>();
  for (const r of rows) {
    const label = r.keys?.[1];
    if (label) totals.set(label, (totals.get(label) ?? 0) + r.clicks);
  }
  const keep = new Set(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([label]) => label),
  );
  const out: MetricPointInput[] = [];
  for (const r of rows) {
    const [date, label] = r.keys ?? [];
    if (date && label && keep.has(label)) out.push({ metric, date, dimension: `${prefix}:${label}`, value: r.clicks });
  }
  return out;
}

async function query(siteUrl: string, token: string, body: Record<string, unknown>): Promise<GscRow[]> {
  const rows: GscRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await postJson<GscResponse>({
      url: `${apiBase("https://searchconsole.googleapis.com")}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      token,
      body: { ...body, rowLimit: GSC_ROW_LIMIT, startRow: page * GSC_ROW_LIMIT },
      what: `Search Console site ${siteUrl}`,
      serviceAccountEmail: serviceAccountEmail(),
    });
    const got = res.rows ?? [];
    rows.push(...got);
    if (got.length < GSC_ROW_LIMIT) break;
  }
  return rows;
}

export const gscConnector: Connector = async ({ identifiers, from, to }) => {
  const siteUrl = parseSiteUrl(siteIdentifier(identifiers));
  if (!siteUrl) {
    throw new ConnectorError(
      "bad_identifier",
      `Search Console site_url "${siteIdentifier(identifiers) ?? ""}" must be sc-domain:example.com or a full URL like https://example.com/.`,
    );
  }
  const token = await getAccessToken("gsc");
  const range = { startDate: from, endDate: to };
  const daily = await query(siteUrl, token, { ...range, dimensions: ["date"] });
  const byQuery = await query(siteUrl, token, { ...range, dimensions: ["date", "query"] });
  const byPage = await query(siteUrl, token, { ...range, dimensions: ["date", "page"] });
  return [...parseDailyRows(daily), ...topDimension(byQuery, "query_clicks"), ...topDimension(byPage, "page_clicks")];
};

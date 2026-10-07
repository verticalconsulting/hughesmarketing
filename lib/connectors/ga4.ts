import { parsePropertyId } from "@/lib/domain/metrics";
import { ConnectorError } from "./errors";
import { apiBase, getAccessToken, serviceAccountEmail } from "./google-auth";
import { postJson } from "./http";
import type { Connector, MetricPointInput } from "./types";

// Order matters: parseRunReport reads metricValues by index.
const GA4_METRICS = [
  { api: "sessions", id: "sessions" },
  { api: "activeUsers", id: "users" },
  { api: "keyEvents", id: "key_events" },
] as const;

type RunReportResponse = {
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
};

export function parseRunReport(res: RunReportResponse): MetricPointInput[] {
  const out: MetricPointInput[] = [];
  for (const row of res.rows ?? []) {
    const raw = row.dimensionValues?.[0]?.value;
    if (!raw || !/^\d{8}$/.test(raw)) continue;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    GA4_METRICS.forEach((m, i) => {
      const n = Number(row.metricValues?.[i]?.value);
      if (Number.isFinite(n)) out.push({ metric: m.id, date, dimension: "", value: n });
    });
  }
  return out;
}

export const ga4Connector: Connector = async ({ identifiers, from, to }) => {
  const propertyId = parsePropertyId(identifiers.property_id);
  if (!propertyId) {
    throw new ConnectorError(
      "bad_identifier",
      `GA4 property_id "${identifiers.property_id ?? ""}" must be the numeric property ID (digits only, from Admin → Property details).`,
    );
  }
  const token = await getAccessToken("ga4");
  const body = await postJson<RunReportResponse>({
    url: `${apiBase("https://analyticsdata.googleapis.com")}/v1beta/properties/${propertyId}:runReport`,
    token,
    // At most 400 days of one-row-per-day data, so a single page always suffices.
    body: {
      dateRanges: [{ startDate: from, endDate: to }],
      dimensions: [{ name: "date" }],
      metrics: GA4_METRICS.map((m) => ({ name: m.api })),
      limit: 1000,
    },
    what: `GA4 property ${propertyId}`,
    serviceAccountEmail: serviceAccountEmail(),
  });
  return parseRunReport(body);
};

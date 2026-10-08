import { createServer, type Server } from "node:http";

export const FAKE_GOOGLE_PORT = 3199;
/** A GA4 property id the fake answers with 403, to exercise the error path. */
export const FORBIDDEN_PROPERTY = "403403";

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function startFakeGoogle(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const body = raw ? JSON.parse(raw) : {};
      const url = req.url ?? "";

      const ga4 = /^\/v1beta\/properties\/(\d+):runReport$/.exec(url);
      if (req.method === "POST" && ga4) {
        if (ga4[1] === FORBIDDEN_PROPERTY) return send(403, { error: { message: "forbidden" } });
        const range = body.dateRanges[0];
        return send(200, {
          rows: days(range.startDate, range.endDate).map((d) => ({
            dimensionValues: [{ value: d.replaceAll("-", "") }],
            metricValues: [{ value: "100" }, { value: "80" }, { value: "5" }],
          })),
        });
      }

      if (req.method === "POST" && /^\/webmasters\/v3\/sites\/.+\/searchAnalytics\/query$/.test(url)) {
        const dims: string[] = body.dimensions;
        const range = days(body.startDate, body.endDate);
        if (dims.join() === "date") {
          return send(200, { rows: range.map((d) => ({ keys: [d], clicks: 20, impressions: 400, ctr: 0.05, position: 8.5 })) });
        }
        const labels: [string, number][] =
          dims[1] === "query"
            ? [["roof repair flowood", 12], ["roofers near me", 8]]
            : [["https://e2e-metrics.example/", 15], ["https://e2e-metrics.example/services", 5]];
        return send(200, {
          rows: range.flatMap((d) => labels.map(([label, clicks]) => ({ keys: [d, label], clicks, impressions: 200, ctr: 0.05, position: 8.5 }))),
        });
      }
      send(404, { error: "unknown route" });
    });
  });
  return new Promise((resolve) => server.listen(FAKE_GOOGLE_PORT, "127.0.0.1", () => resolve(server)));
}

import { ConnectorError } from "./errors";

export type PostJsonOptions = {
  url: string;
  token: string;
  body: unknown;
  /** Human description of the target for error messages, e.g. "GA4 property 515827425". */
  what: string;
  serviceAccountEmail?: string | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

function mapStatus(status: number, o: PostJsonOptions): ConnectorError {
  if (status === 401 || status === 403) {
    const who = o.serviceAccountEmail ? `The service account ${o.serviceAccountEmail}` : "The service account";
    return new ConnectorError("permission_denied", `${who} does not have access to ${o.what}. Add it as a Viewer there.`);
  }
  if (status === 404) return new ConnectorError("not_found", `Google could not find ${o.what}. Check the identifier.`);
  if (status === 400) return new ConnectorError("bad_identifier", `Google rejected the request for ${o.what}. Check the identifier.`);
  if (status === 429) return new ConnectorError("quota", `Google API quota exceeded while reading ${o.what}. Try again later.`);
  return new ConnectorError("unavailable", `Google returned an error (${status}) while reading ${o.what}. Try again later.`);
}

/** POST JSON, retrying once (after a pause) on 429, 5xx, and network failures. Never puts the token or response body in an error. */
export async function postJson<T>(o: PostJsonOptions): Promise<T> {
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(o.url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
        body: JSON.stringify(o.body),
      });
    } catch {
      if (attempt === 0) {
        await sleep(1000);
        continue;
      }
      throw new ConnectorError("unavailable", `Could not reach Google while reading ${o.what}. Try again later.`);
    }
    if (res.ok) {
      try {
        return (await res.json()) as T;
      } catch {
        // Never forward parse errors that can contain the response body
        throw new ConnectorError("unavailable", `Google returned an unreadable response while reading ${o.what}. Try again later.`);
      }
    }
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await sleep(1000);
      continue;
    }
    throw mapStatus(res.status, o);
  }
}

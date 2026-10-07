import { JWT } from "google-auth-library";
import { getEnv } from "@/lib/env";
import { ConnectorError } from "./errors";

export const SCOPES = {
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export type ServiceAccount = { client_email: string; private_key: string };

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw?.trim()) {
    throw new ConnectorError("not_configured", "Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_JSON is not set).");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Deliberately no detail from the parser: its message can quote part of the value.
    throw new ConnectorError("not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the key file's contents on one line.");
  }
  const o = json as Record<string, unknown> | null;
  if (typeof o?.client_email !== "string" || typeof o?.private_key !== "string") {
    throw new ConnectorError("not_configured", "GOOGLE_SERVICE_ACCOUNT_JSON must contain client_email and private_key.");
  }
  return { client_email: o.client_email, private_key: o.private_key };
}

/** Test-only hook: GOOGLE_API_BASE_OVERRIDE points the connectors at a local fake Google. Ignored in production. */
export const usingFakeGoogle = (): boolean => process.env.NODE_ENV !== "production" && !!process.env.GOOGLE_API_BASE_OVERRIDE;

export function apiBase(defaultBase: string): string {
  const override = usingFakeGoogle() ? process.env.GOOGLE_API_BASE_OVERRIDE : undefined;
  return (override ?? defaultBase).replace(/\/+$/, "");
}

const clients = new Map<string, JWT>();

export async function getAccessToken(source: keyof typeof SCOPES): Promise<string> {
  if (usingFakeGoogle()) return "fake-token";
  const account = parseServiceAccount(getEnv().GOOGLE_SERVICE_ACCOUNT_JSON);
  let client = clients.get(source);
  if (!client) {
    client = new JWT({ email: account.client_email, key: account.private_key, scopes: [SCOPES[source]] });
    clients.set(source, client);
  }
  try {
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("empty token");
    return token;
  } catch (e) {
    // The library's error can include request details; extract only the status code if present
    const status = (e as { response?: { status?: unknown }; status?: unknown })?.response?.status ?? (e as { status?: unknown })?.status;
    const statusNum = typeof status === "number" ? status : undefined;

    if (!statusNum || statusNum >= 500) {
      // Network failure or server error
      throw new ConnectorError("unavailable", "Could not reach Google to sign in the service account. Try again later.");
    }
    if (statusNum === 429) {
      throw new ConnectorError("quota", "Google rate-limited the service account sign-in. Try again later.");
    }
    // All other statuses (400, 401, 403, etc.) indicate permission/credential issues
    throw new ConnectorError("permission_denied", "Google rejected the service account credentials. Check GOOGLE_SERVICE_ACCOUNT_JSON.");
  }
}

/** The service account's public email, safe to show in messages. Null when not configured. */
export function serviceAccountEmail(): string | null {
  try {
    return parseServiceAccount(getEnv().GOOGLE_SERVICE_ACCOUNT_JSON).client_email;
  } catch {
    return null;
  }
}

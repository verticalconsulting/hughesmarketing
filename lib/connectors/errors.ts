export type ConnectorErrorCode = "not_configured" | "permission_denied" | "not_found" | "bad_identifier" | "quota" | "unavailable";

/** Messages are shown to the team and recorded on the integration. They never contain tokens, keys, or response bodies. */
export class ConnectorError extends Error {
  constructor(
    public code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

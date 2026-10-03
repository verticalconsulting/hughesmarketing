import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Actor } from "@/lib/services/actor";
import { verifyApiToken } from "@/lib/services/tokens";

export async function authenticateBearer(bearer: string | undefined): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  const t = await verifyApiToken(bearer);
  if (!t) return undefined;
  return {
    token: bearer,
    clientId: t.tokenId,
    scopes: ["workspace"],
    extra: { userId: t.userId, label: `${t.name} (${t.email})` },
  };
}

export function actorFromAuth(info: AuthInfo | undefined): Actor {
  const userId = info?.extra?.userId;
  const label = info?.extra?.label;
  if (typeof userId !== "string" || typeof label !== "string") throw new Error("Unauthenticated MCP request");
  return { kind: "token", userId, label };
}

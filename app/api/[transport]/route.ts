import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { authenticateBearer } from "@/lib/mcp/auth";
import { registerTools } from "@/lib/mcp/register";

export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => registerTools(server),
  { serverInfo: { name: "hughes-marketing", version: "1.0.0" } },
  { basePath: "/api", maxDuration: 60, disableSse: true },
);

const authed = withMcpAuth(handler, (_req, bearer) => authenticateBearer(bearer), { required: true });

export { authed as DELETE, authed as GET, authed as POST };

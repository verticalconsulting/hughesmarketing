import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { actorFromAuth } from "./auth";
import { runTool } from "./run";
import { tools } from "./tools";

export function registerTools(server: McpServer): void {
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.input, async (args, extra) => runTool(tool, args, actorFromAuth(extra.authInfo)));
  }
}

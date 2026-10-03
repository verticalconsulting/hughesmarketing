import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, ZodError } from "zod";
import type { Actor } from "@/lib/services/actor";
import { DomainError } from "@/lib/services/errors";

export type ToolDef<S extends z.ZodRawShape> = {
  name: string;
  description: string;
  input: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: { actor: Actor }) => Promise<unknown>;
};
// Type-erased form so tools with different input shapes can live in one array;
// runTool validates args against `input` before the handler is called.
export type AnyTool = {
  name: string;
  description: string;
  input: z.ZodRawShape;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: { actor: Actor }) => Promise<unknown>;
};

export const defineTool = <S extends z.ZodRawShape>(t: ToolDef<S>): ToolDef<S> => t;

const text = (value: unknown) => [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];

export async function runTool(tool: AnyTool, rawArgs: unknown, actor: Actor): Promise<CallToolResult> {
  try {
    const args = z.object(tool.input).parse(rawArgs ?? {});
    const result = await tool.handler(args, { actor });
    return { content: text(result) };
  } catch (e) {
    if (e instanceof ZodError) {
      return {
        isError: true,
        content: text({ error: "validation", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }),
      };
    }
    if (e instanceof DomainError) {
      return { isError: true, content: text({ error: e.code, message: e.message, ...e.details }) };
    }
    throw e;
  }
}

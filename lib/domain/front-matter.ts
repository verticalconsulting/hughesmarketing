import { parse } from "yaml";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontMatter(src: string): { data: Record<string, unknown> | null; body: string } {
  const m = FM.exec(src);
  if (!m) return { data: null, body: src };
  try {
    const data = parse(m[1]);
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { data: null, body: src };
    return { data: data as Record<string, unknown>, body: src.slice(m[0].length) };
  } catch {
    return { data: null, body: src };
  }
}

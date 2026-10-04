export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathError";
  }
}

export function normalizePath(p: string): string {
  const trimmed = p.trim().replace(/\\/g, "/");
  if (trimmed.endsWith("/")) throw new PathError(`Path must name a file, not a folder: "${p}"`);
  const parts: string[] = [];
  for (const seg of trimmed.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") throw new PathError(`Path may not contain "..": "${p}"`);
    parts.push(seg);
  }
  if (parts.length === 0) throw new PathError("Path is empty");
  return parts.join("/");
}

import type { FileEntry, MoveReason } from "./types";

export const TOPIC_FOLDERS = [
  "ai-answer-foundation",
  "ai-visibility",
  "geo-technical-fixes",
  "mobile-lead-path",
  "paid-search",
  "seo",
] as const;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const ISO_DATE = /(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/;
const ISO_DATE_ALL = /(?<!\d)20\d{2}-\d{2}-\d{2}(?!\d)/g;
const LONG_DATE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2}),\\s+(20\\d{2})\\b`, "i");
const DATE_LINE = /prepared|date|generated|created/i;
const RUN_ID_NAME = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-(.+)\.[^.]+$/i;
const pad = (n: number) => String(n).padStart(2, "0");

export type DateHint = { date: string; source: "content" | "mtime" };

export function extractDate(head: string, mtimeMs: number): DateHint {
  for (const line of head.split(/\r?\n/)) {
    if (!DATE_LINE.test(line)) continue;
    const iso = line.match(ISO_DATE);
    if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, source: "content" };
    const long = line.match(LONG_DATE);
    if (long) {
      const month = MONTHS.indexOf(long[1].toLowerCase()) + 1;
      return { date: `${long[3]}-${pad(month)}-${pad(Number(long[2]))}`, source: "content" };
    }
  }
  return { date: new Date(mtimeMs).toISOString().slice(0, 10), source: "mtime" };
}

export function localServicePagesDate(files: FileEntry[]): string | null {
  const inFolder = files.filter((f) => f.path.startsWith("local-service-pages/"));
  const readme = inFolder.find((f) => f.path === "local-service-pages/README.md");
  const fromReadme = readme?.head.match(ISO_DATE);
  if (fromReadme) return `${fromReadme[1]}-${fromReadme[2]}-${fromReadme[3]}`;
  const dates = inFolder.flatMap((f) => f.path.match(ISO_DATE_ALL) ?? []).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export type Route = { to: string; reason: MoveReason; note?: string };
export type RouteContext = { localServicePagesDate: string | null };

/** Where one file belongs. Paths are relative to the client folder. Null means it is already in place. */
export function routeFile(file: FileEntry, ctx: RouteContext): Route | null {
  const parts = file.path.split("/");
  const top = parts[0];
  const rest = parts.slice(1);
  if (rest.length === 0) return null;

  if ((TOPIC_FOLDERS as readonly string[]).includes(top)) {
    return { to: `resources/${file.path}`, reason: "topic-folder" };
  }

  if (top === "local-service-pages") {
    const name = rest.join("/");
    const dated = ctx.localServicePagesDate ? `local-service-pages-${ctx.localServicePagesDate}` : "local-service-pages";
    if (rest.length > 1 || name === "README.md") return { to: `resources/${dated}/${name}`, reason: "local-service-pages" };
    if (name.startsWith("keyword-to-page-map")) return { to: `seo-page-map/${name}`, reason: "local-service-pages" };
    return { to: `content-drafts/${name}`, reason: "local-service-pages" };
  }

  if (top === "workflow-results") {
    const m = rest.length === 1 ? rest[0].match(RUN_ID_NAME) : null;
    if (!m) return { to: `resources/workflow-results/${rest.join("/")}`, reason: "workflow-results" };
    const { date, source } = extractDate(file.head, file.mtimeMs);
    return {
      to: `resources/workflow-results/${m[1]}/${date}/${rest[0]}`,
      reason: "workflow-results",
      note: source === "mtime" ? `no date in the file; used its modified time (${date})` : undefined,
    };
  }

  return null;
}

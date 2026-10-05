import type { StaleReference } from "./scan";
import type { ClientPlan, FileEntry, Move } from "./types";

/**
 * Client-relative folders that will have no files left once these moves run. Moves are applied in order, so a file
 * renamed inside its folder, or moved on twice, is counted where it finally lands. Folders are left in place, never removed.
 */
export function emptiedFolders(files: FileEntry[], moves: Move[], client: string): string[] {
  const prefix = `${client}/`;
  const final = new Set(files.map((f) => f.path));
  const candidates = new Set<string>();
  for (const m of moves) {
    if (!m.from.startsWith(prefix)) continue;
    const from = m.from.slice(prefix.length);
    final.delete(from);
    if (m.to.startsWith(prefix)) final.add(m.to.slice(prefix.length));
    const parts = from.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) candidates.add(parts.slice(0, i).join("/"));
  }
  const remaining = [...final];
  return [...candidates].filter((dir) => !remaining.some((p) => p.startsWith(`${dir}/`))).sort();
}

export type ReportInput = {
  generatedAt: string;
  plans: ClientPlan[];
  stale: Record<string, StaleReference[]>;
  emptied: Record<string, string[]>;
};

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function formatReport(input: ReportInput): string {
  const mandatory = input.plans.reduce((n, p) => n + p.moves.filter((m) => !m.optional).length, 0);
  const optional = input.plans.reduce((n, p) => n + p.moves.filter((m) => m.optional).length, 0);
  const conflicts = input.plans.reduce((n, p) => n + p.conflicts.length, 0);

  const lines: string[] = [
    "# Drive restructure: dry run",
    "",
    `Generated: ${input.generatedAt}`,
    "",
    `Totals: ${mandatory} moves, ${optional} optional renames, ${conflicts} conflicts`,
    "",
    "Nothing has been moved. Optional renames only apply with `--include-optional`. Stale references are listed, never edited.",
    "",
  ];

  for (const plan of input.plans) {
    lines.push(`## ${plan.client}`, "");
    const stale = input.stale[plan.client] ?? [];
    const emptied = input.emptied[plan.client] ?? [];
    if (!plan.moves.length && !plan.conflicts.length && !plan.notes.length) {
      lines.push("No changes needed.", "");
      continue;
    }
    if (plan.moves.length) {
      lines.push("### Moves", "", "| Reason | From | To | Detail |", "|---|---|---|---|");
      for (const m of plan.moves) {
        const reason = m.optional ? `${m.reason} (optional)` : m.reason;
        lines.push(`| ${reason} | ${cell(m.from)} | ${cell(m.to)} | ${cell(m.detail ?? "")} |`);
      }
      lines.push("");
    }
    if (plan.conflicts.length) {
      lines.push("### Conflicts (left alone, your decision)", "");
      for (const c of plan.conflicts) lines.push(`- ${c.kind}: \`${c.path}\`: ${c.detail}`);
      lines.push("");
    }
    if (plan.notes.length) {
      lines.push("### Notes", "");
      for (const n of plan.notes) lines.push(`- \`${n.path}\`: ${n.message}`);
      lines.push("");
    }
    if (emptied.length) {
      lines.push("### Folders left empty after the moves", "");
      for (const dir of emptied) lines.push(`- ${dir}/`);
      lines.push("");
    }
    if (stale.length) {
      lines.push("### Files that still mention an old path (not edited)", "");
      for (const s of stale) lines.push(`- \`${s.file}\`: ${s.mentions.map((t) => `\`${t}\``).join(", ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

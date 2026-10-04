export function parsePlanHeader(md: string) {
  const field = (label: string): string | null => {
    const m = new RegExp(`^${label}:\\s*(.+?)\\s*$`, "mi").exec(md);
    return m ? m[1] : null;
  };
  const num = (s: string | null): number | null => {
    if (!s) return null;
    const m = /-?[\d,]+(?:\.\d+)?/.exec(s);
    return m ? Number(m[0].replace(/,/g, "")) : null;
  };
  // No `m` flag: `$` must mean end of document so multi-paragraph summaries are kept whole.
  const summaryMatch = /(?:^|\n)##\s+Summary[ \t]*\r?\n+([\s\S]*?)(?=\r?\n##\s|$)/.exec(md);
  const version = num(field("Version"));
  return {
    version: version === null ? null : Math.trunc(version),
    objective: field("Objective"),
    primaryChannel: field("Primary focus"),
    secondaryChannels: (field("Secondary focuses") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    monthlyBudget: num(field("Monthly budget")),
    weeklyHours: num(field("Weekly bandwidth")),
    timeline: field("Timeline horizon"),
    summary: summaryMatch ? summaryMatch[1].trim() || null : null,
  };
}

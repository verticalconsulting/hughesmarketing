import type { TrackerSummary } from "@/lib/services/trackers";

type T = Pick<TrackerSummary, "verdict" | "changePct" | "changeAbs" | "windowEndsAt">;

export function VerdictBadge({ tracker }: { tracker: T }) {
  const change =
    tracker.changePct !== null
      ? `${tracker.changePct >= 0 ? "+" : ""}${tracker.changePct.toFixed(1)}%`
      : tracker.changeAbs !== null
        ? `${tracker.changeAbs >= 0 ? "+" : ""}${tracker.changeAbs}`
        : "";
  switch (tracker.verdict) {
    case "positive":
      return <span className="rounded-full bg-band-green/15 px-2 py-0.5 text-xs font-medium text-band-green">▲ positive {change}</span>;
    case "negative":
      return <span className="rounded-full bg-band-red/15 px-2 py-0.5 text-xs font-medium text-band-red">▼ negative {change}</span>;
    case "neutral":
      return <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">● neutral {change}</span>;
    default:
      return (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          measuring until {tracker.windowEndsAt.toLocaleDateString()}
        </span>
      );
  }
}

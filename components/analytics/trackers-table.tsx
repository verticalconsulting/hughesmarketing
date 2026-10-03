import { VerdictBadge } from "@/components/plan/verdict-badge";
import type { TrackerSummary } from "@/lib/services/trackers";

export function TrackersTable({ trackers }: { trackers: TrackerSummary[] }) {
  if (trackers.length === 0)
    return <p className="text-sm text-muted-foreground">No trackers yet. Completing a plan item creates one with a baseline.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="p-2">Plan item</th>
            <th className="p-2">KPI</th>
            <th className="p-2 text-right">Baseline</th>
            <th className="p-2 text-right">Latest</th>
            <th className="p-2">Verdict</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {trackers.map((t) => (
            <tr key={t.id}>
              <td className="p-2">{t.itemTitle}</td>
              <td className="p-2">
                {t.kpi}
                <span className="block text-xs text-muted-foreground">{t.direction === "up" ? "higher is better" : "lower is better"}</span>
              </td>
              <td className="p-2 text-right tabular-nums">{t.baselineValue}</td>
              <td className="p-2 text-right tabular-nums">{t.latest ?? "—"}</td>
              <td className="p-2">
                <VerdictBadge tracker={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

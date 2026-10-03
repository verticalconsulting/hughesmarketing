import { band, CATEGORY_LABELS, type Category } from "@/lib/domain/scoring";
import type { AuditWithScores } from "@/lib/services/audits";

const BAR = { red: "bg-band-red", amber: "bg-band-amber", green: "bg-band-green" } as const;

export function WhereYouStand({ audit }: { audit: AuditWithScores }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <h2 className="font-semibold">Where you stand</h2>
      <p className="text-xs text-muted-foreground">
        Channel health from the audit on {audit.auditedAt.toLocaleDateString()}
        {audit.partial && " (partial audit — not counted in Health)"}, with each target.
      </p>
      <ul className="mt-4 space-y-3">
        {audit.scores.map((s) => (
          <li key={s.category}>
            <div className="flex justify-between text-sm">
              <span className="font-medium">{CATEGORY_LABELS[s.category as Category] ?? s.category}</span>
              <span className="tabular-nums text-muted-foreground">
                {s.score}
                {s.target !== null && <> → <span className="font-semibold text-foreground">{s.target}</span></>}
              </span>
            </div>
            <div className="relative mt-1 h-2 rounded-full bg-muted">
              <div className={`h-2 rounded-full ${BAR[band(s.score)]}`} style={{ width: `${s.score}%` }} />
              {s.target !== null && <div className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground/60" style={{ left: `${s.target}%` }} />}
            </div>
            {s.evidence && <p className="mt-1 text-xs text-muted-foreground">{s.evidence}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

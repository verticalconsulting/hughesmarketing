import { band } from "@/lib/domain/scoring";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

const TEXT = { red: "text-band-red", amber: "text-band-amber", green: "text-band-green" } as const;

export function HealthCard({ health, delta, history }: { health: number | null; delta: number | null; history: number[] }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-center">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Marketing health</div>
        <div data-testid="health-score" className={cn("font-display text-5xl font-semibold", health === null ? "text-muted-foreground" : TEXT[band(health)])}>
          {health ?? "—"}
        </div>
        <div data-testid="health-delta" className="text-xs text-muted-foreground">
          {delta === null ? "first audit" : (
            <span className={delta >= 0 ? "text-band-green" : "text-band-red"}>
              {delta >= 0 ? "▲ +" : "▼ "}
              {delta} since last audit
            </span>
          )}
        </div>
      </div>
      <Sparkline values={history} />
    </div>
  );
}

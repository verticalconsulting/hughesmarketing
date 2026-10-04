import { Activity } from "lucide-react";
import { band } from "@/lib/domain/scoring";
import { cn } from "@/lib/utils";

const BAND_CLASS = {
  red: "bg-band-red/10 text-band-red",
  amber: "bg-band-amber/10 text-band-amber",
  green: "bg-band-green/10 text-band-green",
} as const;

export function HealthPill({ health, delta }: { health: number | null; delta: number | null }) {
  const cls = health === null ? "bg-muted text-muted-foreground" : BAND_CLASS[band(health)];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", cls)}>
      <Activity className="size-3.5" />
      Health {health ?? "—"}
      {delta !== null && delta !== 0 && (
        <span className={delta > 0 ? "text-band-green" : "text-band-red"}>
          {delta > 0 ? "▲" : "▼"}
          {Math.abs(delta)}
        </span>
      )}
    </span>
  );
}

import type { PlanView } from "@/lib/services/plans";

export function ChannelProgress({ plan }: { plan: PlanView }) {
  const total = plan.items.length;
  const done = plan.items.filter((i) => i.status === "done").length;
  const active = plan.items.filter((i) => i.status === "active" || i.status === "approved").length;
  const blocked = plan.items.filter((i) => i.status === "blocked").length;
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  const chips = [
    plan.monthlyBudget !== null && `Budget: $${plan.monthlyBudget.toLocaleString()}/mo`,
    plan.weeklyHours !== null && `Bandwidth: ${plan.weeklyHours} h/wk`,
    plan.timeline && `Timeline: ${plan.timeline.replace("_", " ")}`,
    ...plan.secondaryChannels.map((c) => `+ ${c}`),
  ].filter(Boolean) as string[];
  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm">
        <span>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Primary channel</span>{" "}
          <span className="font-semibold">{plan.primaryChannel ?? "Not set"}</span>
        </span>
        <span className="text-muted-foreground">
          {done} of {total} items complete
        </span>
      </div>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${done} done, ${active} active, ${blocked} blocked of ${total}`}>
        <div className="bg-band-green" style={{ width: `${pct(done)}%` }} />
        <div className="bg-primary" style={{ width: `${pct(active)}%` }} />
        <div className="bg-band-red" style={{ width: `${pct(blocked)}%` }} />
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-band-green" /> Completed {done}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Active {active}</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-band-red" /> Blocked {blocked}</span>
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-md border bg-background px-2 py-1 text-xs">{c}</span>
          ))}
        </div>
      )}
    </section>
  );
}

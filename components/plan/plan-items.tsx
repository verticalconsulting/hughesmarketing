"use client";
import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { decidePlanItemAction } from "@/app/actions/plans";
import { Button } from "@/components/ui/button";
import { FUNNEL_META } from "@/lib/domain/funnel";
import type { PlanItemView } from "@/lib/services/plans";
import { cn } from "@/lib/utils";
import { VerdictBadge } from "./verdict-badge";

const STATUS: Record<PlanItemView["status"], { label: string; cls: string }> = {
  planned: { label: "Planned", cls: "bg-muted text-muted-foreground" },
  active: { label: "Active", cls: "bg-chart-2/15 text-chart-2" },
  needs_approval: { label: "Needs approval", cls: "bg-band-amber/15 text-band-amber" },
  approved: { label: "Approved", cls: "bg-primary/15 text-primary" },
  done: { label: "Done", cls: "bg-band-green/15 text-band-green" },
  blocked: { label: "Blocked", cls: "bg-band-red/15 text-band-red" },
  declined: { label: "Declined", cls: "bg-muted text-muted-foreground line-through" },
};

export function PlanItems({ items }: { items: PlanItemView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (id: string, decision: "approve" | "decline") =>
    start(async () => {
      const r = await decidePlanItemAction(id, decision);
      if (r.ok) toast.success(decision === "approve" ? "Approved — the agent can start it now" : "Declined");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <section id="approvals" className="space-y-2">
      <h2 className="font-semibold">Plan items</h2>
      {items.length === 0 && <p className="text-sm text-muted-foreground">This plan has no items yet. Use “Rebuild plan” to have the agent add them.</p>}
      <ul className="divide-y rounded-xl border bg-card shadow-sm">
        {items.map((item) => {
          const tracker = item.tracker
            ? {
                verdict: item.tracker.verdict,
                changePct: item.tracker.changePct,
                changeAbs: null,
                windowEndsAt: new Date(item.tracker.baselineAt.getTime() + item.tracker.windowDays * 86_400_000),
              }
            : null;
          return (
            <li key={item.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: FUNNEL_META[item.funnelStage].color }} title={FUNNEL_META[item.funnelStage].label} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{item.title}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {item.channel && <span>{item.channel}</span>}
                  {item.expectedKpi && <span>KPI: {item.expectedKpi}</span>}
                  {item.files.length > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Paperclip className="size-3" /> {item.files.length}
                    </span>
                  )}
                  {tracker && <VerdictBadge tracker={tracker} />}
                </div>
              </div>
              <span data-testid={`status-${item.title}`} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[item.status].cls)}>
                {STATUS[item.status].label}
              </span>
              {item.status === "needs_approval" && (
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} aria-label={`Approve ${item.title}`} onClick={() => decide(item.id, "approve")}>
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending} aria-label={`Decline ${item.title}`} onClick={() => decide(item.id, "decline")}>
                    Decline
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

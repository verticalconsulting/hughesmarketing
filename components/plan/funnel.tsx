import { FUNNEL_META, FUNNEL_STAGES } from "@/lib/domain/funnel";
import type { PlanItemView } from "@/lib/services/plans";

export function Funnel({ items }: { items: PlanItemView[] }) {
  const addressed = FUNNEL_STAGES.filter((s) => items.some((i) => i.funnelStage === s)).length;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Growth funnel</h2>
        <span className="text-xs text-muted-foreground">{addressed} of 5 stages addressed</span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {FUNNEL_STAGES.map((stage) => {
          const meta = FUNNEL_META[stage];
          const list = items.filter((i) => i.funnelStage === stage);
          const done = list.filter((i) => i.status === "done").length;
          return (
            <div key={stage} className="rounded-lg border bg-card p-3 shadow-sm" style={{ borderTop: `3px solid ${meta.color}` }}>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span className="size-2 rounded-full" style={{ background: meta.color }} /> {meta.label}
              </div>
              <div className="text-xs text-muted-foreground">{meta.hint}</div>
              <div className="mt-2 text-xs">
                {list.length === 0 ? (
                  <span className="text-muted-foreground">Not yet addressed</span>
                ) : (
                  <>
                    <span className="font-semibold">{list.length} items</span> · {done} done
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

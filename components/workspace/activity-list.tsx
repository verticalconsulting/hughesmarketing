"use client";
import {
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  MessageSquare,
  Plug,
  TrendingUp,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { groupByRecency } from "@/lib/domain/dates";
import type { ActivityRow } from "@/lib/services/activity";

const KIND: Record<ActivityRow["kind"], { icon: LucideIcon; cls: string }> = {
  brand: { icon: Building2, cls: "text-primary" },
  chat: { icon: MessageSquare, cls: "text-chart-2" },
  workflow: { icon: Workflow, cls: "text-funnel-retention" },
  audit: { icon: Gauge, cls: "text-band-amber" },
  plan: { icon: ClipboardList, cls: "text-funnel-activation" },
  approval: { icon: CheckCircle2, cls: "text-band-green" },
  file: { icon: FileText, cls: "text-muted-foreground" },
  tracker: { icon: TrendingUp, cls: "text-chart-5" },
  integration: { icon: Plug, cls: "text-chart-2" },
};

export function ActivityList({ items }: { items: ActivityRow[] }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const filtered = q ? items.filter((i) => i.summary.toLowerCase().includes(q.toLowerCase())) : items;
    return groupByRecency(filtered, new Date());
  }, [items, q]);
  const sections = [
    ["Today", groups.today],
    ["Previous 7 Days", groups.last7],
    ["Previous 14 Days", groups.last14],
    ["Older", groups.older],
  ] as const;
  return (
    <div className="space-y-4">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity…" className="h-8" />
      {sections.map(([title, list]) =>
        list.length === 0 ? null : (
          <section key={title}>
            <h3 className="mb-1 px-1 text-xs font-medium text-muted-foreground">{title}</h3>
            <ul className="space-y-0.5">
              {list.map((a) => {
                const { icon: Icon, cls } = KIND[a.kind];
                return (
                  <li key={a.id} title={`${a.actorLabel} · ${a.createdAt.toLocaleString()}`} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${cls}`} />
                    <span className="line-clamp-2">{a.summary}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}
      {items.length === 0 && <p className="px-1 text-sm text-muted-foreground">No activity yet.</p>}
    </div>
  );
}

import { cn } from "@/lib/utils";

const STAGES = {
  onboarding: { label: "Onboarding", cls: "bg-chart-2/15 text-chart-2" },
  audited: { label: "Audited", cls: "bg-chart-4/15 text-chart-4" },
  planned: { label: "Planned", cls: "bg-primary/15 text-primary" },
  executing: { label: "Executing", cls: "bg-chart-6/15 text-chart-6" },
} as const;

export function StageBadge({ stage }: { stage: keyof typeof STAGES }) {
  const s = STAGES[stage];
  return <span className={cn("hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline", s.cls)}>{s.label}</span>;
}

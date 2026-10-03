import { FileText, Gauge, Sparkles } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/workspace/copy-button";
import { agentPrompt } from "@/lib/prompts";
import type { PlanView } from "@/lib/services/plans";

export function PlanHeader({
  plan,
  brand,
  latestAuditPath,
}: {
  plan: PlanView;
  brand: { name: string; slug: string; domain: string | null };
  latestAuditPath: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-band-green/15 px-2 py-0.5 font-medium text-band-green">{plan.status}</span>
        <span className="text-muted-foreground">Version {plan.version}</span>
        <span className="text-muted-foreground">Updated {plan.updatedAt.toLocaleDateString()}</span>
      </div>
      <h1 className="font-display text-3xl font-semibold">Marketing Plan</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">{plan.summary ?? plan.objective}</p>
      <div className="flex flex-wrap gap-2">
        {latestAuditPath && (
          <Button asChild variant="outline" size="sm">
            <Link href={`?pane=assets&file=${encodeURIComponent(latestAuditPath)}`}>
              <Gauge className="size-4" /> View audit
            </Link>
          </Button>
        )}
        <CopyButton text={agentPrompt("audit", brand)} label="Rerun audit" />
        <CopyButton text={agentPrompt("plan", brand)} label="Rebuild plan" />
        <CopyButton text={agentPrompt("execute", brand)} label="Edit with agent" variant="default" />
        {plan.planFilePath && (
          <Button asChild variant="ghost" size="sm">
            <Link href={`?pane=assets&file=${encodeURIComponent(plan.planFilePath)}`}>
              <FileText className="size-4" /> View plan file
            </Link>
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Sparkles className="size-3" /> Buttons copy a ready prompt for Claude Desktop.
      </p>
    </div>
  );
}

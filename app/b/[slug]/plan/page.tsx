import { ClipboardList, Gauge } from "lucide-react";
import { ChannelProgress } from "@/components/plan/channel-progress";
import { Funnel } from "@/components/plan/funnel";
import { HealthCard } from "@/components/plan/health-card";
import { PlanHeader } from "@/components/plan/plan-header";
import { PlanItems } from "@/components/plan/plan-items";
import { WhereYouStand } from "@/components/plan/where-you-stand";
import { CopyButton } from "@/components/workspace/copy-button";
import { isPartial, summarizeHealth } from "@/lib/domain/scoring";
import { agentPrompt } from "@/lib/prompts";
import { listAudits } from "@/lib/services/audits";
import { getBrandBySlug } from "@/lib/services/brands";
import { getActivePlan } from "@/lib/services/plans";

function EmptyState({ icon: Icon, title, body, prompt }: { icon: typeof Gauge; title: string; body: string; prompt: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-8 text-center">
      <Icon className="mx-auto size-8 text-primary" />
      <h2 className="mt-3 font-display text-xl">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
      <div className="mt-4 flex justify-center">
        <CopyButton text={prompt} label="Copy prompt for Claude Desktop" variant="default" />
      </div>
    </div>
  );
}

export default async function PlanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const [audits, plan] = await Promise.all([listAudits(brand.id), getActivePlan(brand.id)]);
  const { health, delta } = summarizeHealth(audits);
  const history = audits.filter((a) => a.health !== null && !isPartial(a.coverage)).map((a) => a.health!).reverse();
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {audits.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No audit yet"
          body={`Onboard ${brand.name} and run the first audit. The Health score, funnel, and plan appear here once the agent records results.`}
          prompt={`${agentPrompt("onboard", b)}\n\nWhen onboarding is done:\n\n${agentPrompt("audit", b)}`}
        />
      ) : !plan ? (
        <>
          <div className="flex justify-end">
            <HealthCard health={health} delta={delta} history={history} />
          </div>
          <EmptyState icon={ClipboardList} title="No plan yet" body="The audit is in. Have the agent ask its plan questions and build the plan." prompt={agentPrompt("plan", b)} />
          <WhereYouStand audit={audits[0]} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <PlanHeader plan={plan} brand={b} latestAuditPath={audits[0]?.reportPath ?? null} />
            <HealthCard health={health} delta={delta} history={history} />
          </div>
          <ChannelProgress plan={plan} />
          <Funnel items={plan.items} />
          <WhereYouStand audit={audits[0]} />
          <PlanItems items={plan.items} />
        </>
      )}
    </div>
  );
}

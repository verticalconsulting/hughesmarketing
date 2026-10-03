import { Bot } from "lucide-react";
import { CopyButton } from "@/components/workspace/copy-button";
import { agentPrompt, PROMPT_LABELS, type PromptKind } from "@/lib/prompts";
import { getBrandBySlug } from "@/lib/services/brands";

const NEXT_FOR_STAGE: Record<string, PromptKind> = { onboarding: "onboard", audited: "plan", planned: "execute", executing: "execute" };

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };
  const recommended = NEXT_FOR_STAGE[brand.stage];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
          <Bot className="size-5" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-semibold">Agent</h1>
          <p className="text-sm text-muted-foreground">Connect Claude Desktop with the MCP button, then paste one of these prompts.</p>
        </div>
      </div>
      {(Object.keys(PROMPT_LABELS) as PromptKind[]).map((kind) => (
        <section key={kind} className={`rounded-xl border bg-card p-4 shadow-sm ${kind === recommended ? "ring-2 ring-primary" : ""}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">
              {PROMPT_LABELS[kind]}
              {kind === recommended && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Next step</span>}
            </h2>
            <CopyButton text={agentPrompt(kind, b)} label="Copy prompt" variant={kind === recommended ? "default" : "outline"} />
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{agentPrompt(kind, b)}</pre>
        </section>
      ))}
    </div>
  );
}

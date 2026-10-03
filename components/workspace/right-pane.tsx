"use client";
import { Folder, Lock, Mail, Plug, Sparkles, Workflow } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { AssetsPane } from "./assets-pane";
import { IntegrationsPane } from "./integrations-pane";
import { Placeholder } from "./placeholder";
import { SkillsPane } from "./skills-pane";

const PANES = [
  { key: "assets", label: "Assets", icon: Folder },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "skills", label: "Skills", icon: Sparkles },
  { key: "workflows", label: "Workflows", icon: Workflow },
  { key: "permissions", label: "Permissions", icon: Lock },
  { key: "email", label: "Email", icon: Mail },
] as const;
type PaneKey = (typeof PANES)[number]["key"];

export function RightPane({ brandSlug }: { brandSlug: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pane = (PANES.find((p) => p.key === params.get("pane"))?.key ?? "assets") as PaneKey;
  const scope = params.get("scope") === "shared" ? "shared" : "brand";
  const file = params.get("file");

  const go = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-card">
      <nav aria-label="Tools" className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
        {PANES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ pane: key })}
            aria-current={pane === key ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
              pane === key && "bg-secondary text-secondary-foreground",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {pane === "assets" && (
          <AssetsPane brandSlug={brandSlug} scope={scope} file={file} onOpen={(s, p) => go({ pane: "assets", scope: s, file: p })} />
        )}
        {pane === "integrations" && <IntegrationsPane brandSlug={brandSlug} />}
        {pane === "skills" && <SkillsPane onOpen={(p) => go({ pane: "assets", scope: "shared", file: p })} />}
        {pane === "workflows" && <Placeholder title="Workflows" body="Saved, repeatable agent workflows per brand (audit refresh, weekly check-ins) arrive in the next slice." />}
        {pane === "permissions" && <Placeholder title="Permissions" body="Per-action approval rules and agent scopes arrive in a later slice. Today every outward-facing plan item needs approval in the Plan tab." />}
        {pane === "email" && <Placeholder title="Email" body="Sending and drafting email from the workspace arrives in a later slice." />}
      </div>
    </div>
  );
}

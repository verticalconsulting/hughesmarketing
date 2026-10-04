"use client";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { agentPrompt } from "@/lib/prompts";
import type { BrandSummary } from "@/lib/services/brands";
import { CopyButton } from "./copy-button";

export function BrowserDialog({ brand }: { brand: BrandSummary }) {
  const b = { name: brand.name, slug: brand.slug, domain: brand.domain };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Globe className="size-4" /> <span className="hidden md:inline">Browser Automation</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Browser automation</DialogTitle>
          <DialogDescription>
            The agent browses with your own signed-in Chrome, so it can read GA4, Search Console, Google Ads, and site admin pages you are logged into.
          </DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Install the <strong>Claude in Chrome</strong> extension and sign in with the same Claude account as Claude Desktop.</li>
          <li>In Claude Desktop, enable the Chrome connector, then connect the workspace with the <strong>MCP</strong> button.</li>
          <li>Copy a prompt below and paste it into Claude Desktop. The agent asks before any action that publishes, spends, or changes a live site.</li>
          <li>OpenClaw: use its built-in browser tool with the same prompts.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={agentPrompt("onboard", b)} label="Onboard with browser" />
          <CopyButton text={agentPrompt("audit", b)} label="Audit with browser" />
          <CopyButton text={agentPrompt("checkin", b)} label="Pull KPI check-ins" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

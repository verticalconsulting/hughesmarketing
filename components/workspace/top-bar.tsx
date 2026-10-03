import Link from "next/link";
import type { BrandSummary } from "@/lib/services/brands";
import { BrandSwitcher } from "./brand-switcher";
import { BrowserDialog } from "./browser-dialog";
import { HealthPill } from "./health-pill";
import { McpDialog } from "./mcp-dialog";
import { StageBadge } from "./stage-badge";
import { TabNav } from "./tab-nav";

export function TopBar({ brands, current, origin }: { brands: BrandSummary[]; current: BrandSummary; origin: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
      <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">H</span>
        <span className="hidden xl:inline">Five Hughes LLC</span>
      </Link>
      <span className="text-muted-foreground">/</span>
      <BrandSwitcher brands={brands} current={current} />
      <HealthPill health={current.health} delta={current.delta} />
      <StageBadge stage={current.stage} />
      <div className="mx-auto">
        <TabNav slug={current.slug} />
      </div>
      <div className="flex items-center gap-2">
        <BrowserDialog brand={current} />
        <McpDialog origin={origin} />
      </div>
    </header>
  );
}

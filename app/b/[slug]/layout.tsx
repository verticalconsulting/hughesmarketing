import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Sidebar } from "@/components/workspace/sidebar";
import { TopBar } from "@/components/workspace/top-bar";
import { WorkspacePanels } from "@/components/workspace/workspace-panels";
import { requireUser } from "@/lib/auth/session";
import { gettingStarted } from "@/lib/domain/checklist";
import { listActivity } from "@/lib/services/activity";
import { listBrands } from "@/lib/services/brands";
import { getBrandContext } from "@/lib/services/context";
import { NotFoundError } from "@/lib/services/errors";
import { countPendingApprovals } from "@/lib/services/plans";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const ctx = await getBrandContext(slug).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [brands, pending] = await Promise.all([listBrands(), countPendingApprovals()]);
  const current = brands.find((b) => b.slug === slug)!;
  const activity = await listActivity({ brandId: current.id, limit: 80 });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const steps = gettingStarted({
    onboardingMissing: ctx.onboarding.missing.length,
    auditCount: ctx.latestAudit ? 1 : 0,
    hasPlan: ctx.activePlan !== null,
    doneItems: ctx.activePlan?.items.filter((i) => i.status === "done").length ?? 0,
    decidedVerdicts: ctx.trackers.filter((t) => t.verdict !== "pending").length,
  });
  return (
    <div className="flex h-dvh flex-col">
      <TopBar brands={brands} current={current} origin={origin} />
      <div className="flex min-h-0 flex-1">
        <Sidebar user={user} slug={slug} activity={activity} pending={pending} steps={steps} />
        <WorkspacePanels brandSlug={slug}>{children}</WorkspacePanels>
      </div>
    </div>
  );
}

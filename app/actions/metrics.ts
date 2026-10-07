"use server";
import { revalidatePath } from "next/cache";
import { attempt } from "@/lib/action-result";
import { actorFor, requireUser } from "@/lib/auth/session";
import type { MetricSource } from "@/lib/domain/metrics";
import { syncBrandMetrics } from "@/lib/services/metrics";

export async function syncMetricsAction(input: { brandSlug: string; source: MetricSource }) {
  const user = await requireUser();
  const r = await attempt(() => syncBrandMetrics({ brandSlug: input.brandSlug, source: input.source, actor: actorFor(user) }));
  revalidatePath("/b", "layout");
  return r;
}

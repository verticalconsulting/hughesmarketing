"use server";
import { revalidatePath } from "next/cache";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import type { Service } from "@/lib/domain/integrations";
import { getBrandBySlug } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

export async function listIntegrationsAction(brandSlug: string) {
  await requireUser();
  return listIntegrations((await getBrandBySlug(brandSlug)).id);
}

export async function saveIntegrationAction(input: {
  brandSlug: string;
  service: Service;
  status: "connected" | "not_connected" | "error";
  identifiersText: string;
  notes: string;
}) {
  const user = await requireUser();
  const identifiers = Object.fromEntries(
    input.identifiersText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const r = await attempt(async () => {
    await upsertIntegration({
      brandSlug: input.brandSlug,
      service: input.service,
      status: input.status,
      identifiers,
      notes: input.notes || null,
      actor: actorFor(user),
    });
    return null;
  });
  revalidatePath("/b", "layout");
  return r;
}

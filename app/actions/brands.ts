"use server";
import { redirect } from "next/navigation";
import { actorFor, requireUser } from "@/lib/auth/session";
import { attempt } from "@/lib/action-result";
import { createBrand } from "@/lib/services/brands";

export async function createBrandAction(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const r = await attempt(() =>
    createBrand({
      name: String(formData.get("name") ?? ""),
      domain: String(formData.get("domain") ?? "").trim() || null,
      actor: actorFor(user),
    }),
  );
  if (!r.ok) return { error: r.error };
  redirect(`/b/${r.data.slug}/plan`);
}

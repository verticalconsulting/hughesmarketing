import { eq } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { integrations } from "@/lib/data/schema";
import { SERVICE_LABELS, SERVICES, type Service } from "@/lib/domain/integrations";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";

export async function upsertIntegration(input: {
  brandSlug: string;
  service: Service;
  status: "connected" | "not_connected" | "error";
  identifiers?: Record<string, string>;
  notes?: string | null;
  actor: Actor;
}) {
  if (!SERVICES.includes(input.service)) throw new ValidationError(`Unknown service "${input.service}"`, "service");
  const brand = await getBrandBySlug(input.brandSlug);
  const values = {
    brandId: brand.id,
    service: input.service,
    status: input.status,
    identifiers: input.identifiers ?? {},
    notes: input.notes ?? null,
    verifiedAt: new Date(),
  };
  const [row] = await db
    .insert(integrations)
    .values(values)
    .onConflictDoUpdate({
      target: [integrations.brandId, integrations.service],
      set: { status: values.status, identifiers: values.identifiers, notes: values.notes, verifiedAt: values.verifiedAt },
    })
    .returning();
  await logActivity({
    brandId: brand.id,
    actor: input.actor,
    kind: "integration",
    summary: `${SERVICE_LABELS[input.service]}: ${input.status.replace("_", " ")}`,
    refType: "integration",
    refId: row.id,
  });
  return row;
}

export async function listIntegrations(brandId: string) {
  return db.select().from(integrations).where(eq(integrations.brandId, brandId)).orderBy(integrations.service);
}

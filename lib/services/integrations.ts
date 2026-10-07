import { and, eq } from "drizzle-orm";
import { db } from "@/lib/data/db";
import { integrations, metricPoints } from "@/lib/data/schema";
import { SERVICE_LABELS, SERVICES, type Service } from "@/lib/domain/integrations";
import { parsePropertyId, parseSiteUrl, siteIdentifier, type MetricSource } from "@/lib/domain/metrics";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";

/** The normalised data-source identifier (GA4 property / Search Console site), or "" when none is set. Other services have none. */
function syncIdentifier(service: Service, identifiers: Record<string, string> | undefined): string {
  if (!identifiers) return "";
  if (service === "ga4") {
    const raw = identifiers.property_id ?? "";
    return parsePropertyId(raw) ?? raw.trim();
  }
  if (service === "gsc") {
    const raw = siteIdentifier(identifiers) ?? "";
    return parseSiteUrl(raw) ?? raw.trim();
  }
  return "";
}

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
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ identifiers: integrations.identifiers })
      .from(integrations)
      .where(and(eq(integrations.brandId, brand.id), eq(integrations.service, input.service)))
      .limit(1);
    const before = syncIdentifier(input.service, existing?.identifiers);
    const after = syncIdentifier(input.service, input.identifiers);
    // Pointing a source at a different property/site makes its stored metrics and sync state meaningless. Omitted or
    // empty identifiers are not a re-point (an agent sending only a status must not wipe data), nor is a first-time set.
    const repointed = (input.service === "ga4" || input.service === "gsc") && before !== "" && after !== "" && before !== after;

    const [row] = await tx
      .insert(integrations)
      .values(values)
      .onConflictDoUpdate({
        target: [integrations.brandId, integrations.service],
        set: {
          status: values.status,
          identifiers: values.identifiers,
          notes: values.notes,
          verifiedAt: values.verifiedAt,
          ...(repointed ? { syncedFrom: null, lastSyncedAt: null, lastSyncError: null } : {}),
        },
      })
      .returning();
    if (repointed) {
      await tx.delete(metricPoints).where(and(eq(metricPoints.brandId, brand.id), eq(metricPoints.source, input.service as MetricSource)));
    }
    await logActivity(
      {
        brandId: brand.id,
        actor: input.actor,
        kind: "integration",
        summary: `${SERVICE_LABELS[input.service]}: ${input.status.replace("_", " ")}`,
        refType: "integration",
        refId: row.id,
      },
      tx,
    );
    if (repointed) {
      await logActivity(
        {
          brandId: brand.id,
          actor: input.actor,
          kind: "integration",
          summary: `${SERVICE_LABELS[input.service]}: identifier changed — cleared synced metrics; the next sync re-pulls from scratch`,
          refType: "integration",
          refId: row.id,
        },
        tx,
      );
    }
    return row;
  });
}

export async function listIntegrations(brandId: string) {
  return db.select().from(integrations).where(eq(integrations.brandId, brandId)).orderBy(integrations.service);
}

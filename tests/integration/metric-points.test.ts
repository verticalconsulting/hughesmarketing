import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { db, sql } from "@/lib/data/db";
import { brands, integrations, metricPoints } from "@/lib/data/schema";
import { createBrand } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

const point = (brandId: string, over: Partial<typeof metricPoints.$inferInsert> = {}) => ({
  brandId,
  source: "ga4",
  metric: "sessions",
  date: "2026-10-01",
  value: 10,
  ...over,
});

describe("metric_points", () => {
  it("allows one row per brand, source, metric, date, and dimension", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await db.insert(metricPoints).values(point(b.id));
    await expect(db.insert(metricPoints).values(point(b.id, { value: 11 }))).rejects.toThrow();
    // A different dimension or date is a different row.
    await db.insert(metricPoints).values([point(b.id, { dimension: "query:roof" }), point(b.id, { date: "2026-10-02" })]);
    expect(await db.select().from(metricPoints)).toHaveLength(3);
  });

  it("defaults the dimension to an empty string and stores the date as YYYY-MM-DD", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    const [row] = await db.insert(metricPoints).values(point(b.id)).returning();
    expect(row.dimension).toBe("");
    expect(row.date).toBe("2026-10-01");
  });

  it("has row-level security enabled, like every other table", async () => {
    const rows = await sql`select relrowsecurity from pg_class where relname = 'metric_points'`;
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("is deleted with its brand", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await db.insert(metricPoints).values(point(b.id));
    await db.delete(brands).where(eq(brands.id, b.id));
    expect(await db.select().from(metricPoints)).toHaveLength(0);
  });
});

describe("integrations sync columns", () => {
  it("start empty and survive an upsert", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "Roof Co", actor });
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const [row] = await listIntegrations(b.id);
    expect(row.lastSyncedAt).toBeNull();
    expect(row.lastSyncError).toBeNull();
    expect(row.syncedFrom).toBeNull();
    await db
      .update(integrations)
      .set({ lastSyncedAt: new Date("2026-10-04T00:00:00Z"), lastSyncError: "x", syncedFrom: "2026-07-07" })
      .where(eq(integrations.id, row.id));
    await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const [after] = await listIntegrations(b.id);
    expect(after.lastSyncedAt).toEqual(new Date("2026-10-04T00:00:00Z"));
    expect(after.lastSyncError).toBe("x");
    expect(after.syncedFrom).toBe("2026-07-07");
  });
});

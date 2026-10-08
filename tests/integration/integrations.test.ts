import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import type { Connector, Connectors } from "@/lib/connectors/types";
import { db } from "@/lib/data/db";
import { integrations, metricPoints } from "@/lib/data/schema";
import { addDays } from "@/lib/domain/metrics";
import { listActivity } from "@/lib/services/activity";
import { createBrand } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";
import { syncBrandMetrics } from "@/lib/services/metrics";

describe("integrations", () => {
  it("upserts one record per brand and service", async () => {
    const actor = await createTestUser();
    const b = await createBrand({ name: "SuperThrift", actor });
    await upsertIntegration({ brandSlug: "superthrift", service: "ga4", status: "not_connected", actor });
    await upsertIntegration({ brandSlug: "superthrift", service: "ga4", status: "connected", identifiers: { property_id: "515827425" }, actor });
    const list = await listIntegrations(b.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ service: "ga4", status: "connected", identifiers: { property_id: "515827425" } });
    expect(list[0].verifiedAt).toBeInstanceOf(Date);
  });

  describe("re-pointing a data source", () => {
    const NOW = new Date("2026-10-05T12:00:00Z");
    const FIRST_FROM = "2026-07-07"; // 90 days ending 2026-10-04
    const TO = "2026-10-04";
    const days = (from: string, to: string) => {
      const out: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
      return out;
    };
    const ranges: { source: string; from: string; to: string }[] = [];
    const fake =
      (source: string, metric: string): Connector =>
      async ({ from, to }) => {
        ranges.push({ source, from, to });
        return days(from, to).map((date) => ({ metric, date, dimension: "", value: 5 }));
      };
    const connectors: Connectors = { ga4: fake("ga4", "sessions"), gsc: fake("gsc", "clicks") };
    const GA4 = { property_id: "515827425" };
    const GSC = { site_url: "https://example.com" };

    async function seed() {
      const actor = await createTestUser();
      const a = await createBrand({ name: "Roof Co", actor });
      const b = await createBrand({ name: "Other Co", actor });
      for (const slug of ["roof-co", "other-co"]) {
        await upsertIntegration({ brandSlug: slug, service: "ga4", status: "connected", identifiers: GA4, actor });
      }
      await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: GSC, actor });
      await syncBrandMetrics({ brandSlug: "roof-co", actor, now: NOW, connectors });
      await syncBrandMetrics({ brandSlug: "other-co", actor, now: NOW, connectors, source: "ga4" });
      ranges.length = 0;
      return { actor, a, b };
    }
    const count = async (brandId: string, source: string) =>
      (await db.select().from(metricPoints).where(and(eq(metricPoints.brandId, brandId), eq(metricPoints.source, source)))).length;
    const state = async (brandId: string, service: string) => {
      const row = (await listIntegrations(brandId)).find((i) => i.service === service)!;
      return { syncedFrom: row.syncedFrom, lastSyncedAt: row.lastSyncedAt, lastSyncError: row.lastSyncError };
    };
    const synced = { syncedFrom: FIRST_FROM, lastSyncedAt: NOW, lastSyncError: null };
    const reset = { syncedFrom: null, lastSyncedAt: null, lastSyncError: null };
    const clearedNotices = async (brandId: string) =>
      (await listActivity({ brandId })).filter((r) => r.summary.includes("identifier changed")).map((r) => r.summary);

    it("clears that source's metrics and sync state when the GA4 property changes, leaving everything else alone", async () => {
      const { actor, a, b } = await seed();
      expect(await count(a.id, "ga4")).toBe(90);
      expect(await state(a.id, "ga4")).toEqual(synced);
      await db.update(integrations).set({ lastSyncError: "old error" }).where(and(eq(integrations.brandId, a.id), eq(integrations.service, "ga4")));

      const row = await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "999888777" }, actor });

      expect(row).toMatchObject({ service: "ga4", status: "connected", identifiers: { property_id: "999888777" } });
      expect(await count(a.id, "ga4")).toBe(0);
      expect(await state(a.id, "ga4")).toEqual(reset);
      expect(await count(a.id, "gsc")).toBeGreaterThan(0);
      expect(await state(a.id, "gsc")).toEqual(synced);
      expect(await count(b.id, "ga4")).toBe(90);
      expect(await state(b.id, "ga4")).toEqual(synced);

      expect((await listActivity({ brandId: a.id })).map((r) => r.summary)).toContain("Google Analytics 4: connected");
      expect(await clearedNotices(a.id)).toEqual([
        "Google Analytics 4: identifier changed — cleared synced metrics; the next sync re-pulls from scratch",
      ]);
      expect(await clearedNotices(b.id)).toEqual([]);
    });

    it("re-backfills the full 90 days on the next sync after a re-point", async () => {
      const { actor, a } = await seed();
      await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "999888777" }, actor });

      const [r] = await syncBrandMetrics({ brandSlug: "roof-co", actor, now: NOW, connectors, source: "ga4" });

      expect(r).toMatchObject({ source: "ga4", status: "ok", from: addDays(TO, -89), to: TO, rows: 90 });
      expect(ranges).toEqual([{ source: "ga4", from: addDays(TO, -89), to: TO }]);
      expect(await count(a.id, "ga4")).toBe(90);
      expect(await state(a.id, "ga4")).toEqual(synced);
    });

    it("does nothing when the same identifier is written in a different format", async () => {
      const { actor, a } = await seed();
      await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: { property_id: "properties/515827425" }, actor });
      await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: { site_url: "https://example.com/" }, actor });
      expect(await count(a.id, "ga4")).toBe(90);
      expect(await count(a.id, "gsc")).toBeGreaterThan(0);
      expect(await state(a.id, "ga4")).toEqual(synced);
      expect(await state(a.id, "gsc")).toEqual(synced);
      expect(await clearedNotices(a.id)).toEqual([]);
    });

    it("does nothing when the upsert carries no identifiers (a status-only call)", async () => {
      const { actor, a } = await seed();
      await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "error", actor });
      await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "error", identifiers: {}, actor });
      expect(await count(a.id, "ga4")).toBe(90);
      expect(await count(a.id, "gsc")).toBeGreaterThan(0);
      expect(await state(a.id, "ga4")).toEqual(synced);
      expect(await state(a.id, "gsc")).toEqual(synced);
      expect(await clearedNotices(a.id)).toEqual([]);
    });

    it("does not delete anything on a first-time set of the identifier", async () => {
      const actor = await createTestUser();
      const brand = await createBrand({ name: "Roof Co", actor });
      await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "not_connected", actor });
      await db.insert(metricPoints).values({ brandId: brand.id, source: "ga4", metric: "sessions", date: "2026-10-01", dimension: "", value: 3 });
      await upsertIntegration({ brandSlug: "roof-co", service: "ga4", status: "connected", identifiers: GA4, actor });
      expect(await count(brand.id, "ga4")).toBe(1);
      expect(await clearedNotices(brand.id)).toEqual([]);
    });

    it("resets only Search Console when the site changes", async () => {
      const { actor, a, b } = await seed();
      await upsertIntegration({ brandSlug: "roof-co", service: "gsc", status: "connected", identifiers: { site_url: "sc-domain:example.org" }, actor });
      expect(await count(a.id, "gsc")).toBe(0);
      expect(await state(a.id, "gsc")).toEqual(reset);
      expect(await count(a.id, "ga4")).toBe(90);
      expect(await state(a.id, "ga4")).toEqual(synced);
      expect(await count(b.id, "ga4")).toBe(90);
      expect(await clearedNotices(a.id)).toEqual([
        "Google Search Console: identifier changed — cleared synced metrics; the next sync re-pulls from scratch",
      ]);
    });
  });
});

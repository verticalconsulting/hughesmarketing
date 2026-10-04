import { describe, expect, it } from "vitest";
import { createTestUser } from "../helpers/db";
import { createBrand } from "@/lib/services/brands";
import { listIntegrations, upsertIntegration } from "@/lib/services/integrations";

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
});

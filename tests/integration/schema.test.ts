import { describe, expect, it } from "vitest";
import { db } from "@/lib/data/db";
import { brands, companies, files } from "@/lib/data/schema";

describe("schema", () => {
  it("enforces one shared file per path even though brand_id is null", async () => {
    await db.insert(files).values({ brandId: null, path: "skills/a/SKILL.md", contentType: "text/markdown", size: 1, currentVersion: 1 });
    await expect(
      db.insert(files).values({ brandId: null, path: "skills/a/SKILL.md", contentType: "text/markdown", size: 1, currentVersion: 1 }),
    ).rejects.toThrow();
  });

  it("allows the same path under different brands", async () => {
    const [company] = await db.select().from(companies);
    const [a, b] = await db
      .insert(brands)
      .values([
        { companyId: company.id, name: "A", slug: "a", color: "#000000" },
        { companyId: company.id, name: "B", slug: "b", color: "#000000" },
      ])
      .returning();
    await db.insert(files).values([
      { brandId: a.id, path: "BRAND.md", contentType: "text/markdown", size: 1, currentVersion: 1 },
      { brandId: b.id, path: "BRAND.md", contentType: "text/markdown", size: 1, currentVersion: 1 },
    ]);
    expect(await db.select().from(files)).toHaveLength(2);
  });
});

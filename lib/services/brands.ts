import { desc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { audits, brands, companies } from "@/lib/data/schema";
import { missingOnboardingQuestions } from "@/lib/domain/questions";
import { summarizeHealth } from "@/lib/domain/scoring";
import { closeMatches, colorForSlug, normalizeDomain, slugify } from "@/lib/domain/text";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { ConflictError, NotFoundError, ValidationError } from "./errors";

export const STAGE_ORDER = ["onboarding", "audited", "planned", "executing"] as const;
export type Stage = (typeof STAGE_ORDER)[number];
export type Brand = typeof brands.$inferSelect;
export type BrandSummary = {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  stage: Stage;
  color: string;
  health: number | null;
  delta: number | null;
  latestAuditAt: Date | null;
};

export async function createBrand(input: { name: string; slug?: string; domain?: string | null; actor: Actor }): Promise<Brand> {
  const name = input.name.trim();
  if (!name) throw new ValidationError("Brand name is required", "name");
  const slug = slugify(input.slug ?? name);
  if (!slug) throw new ValidationError("Brand name must contain letters or numbers", "name");
  const [company] = await db.select().from(companies).limit(1);
  if (!company) throw new NotFoundError("No company is configured; run the database migrations");
  const existing = await db.query.brands.findFirst({ where: eq(brands.slug, slug) });
  if (existing) throw new ConflictError(`Brand "${slug}" already exists`, { slug });
  const [brand] = await db
    .insert(brands)
    .values({
      companyId: company.id,
      name,
      slug,
      domain: input.domain ? normalizeDomain(input.domain) : null,
      color: colorForSlug(slug),
    })
    .returning();
  await logActivity({ brandId: brand.id, actor: input.actor, kind: "brand", summary: `Added brand ${name}`, refType: "brand", refId: brand.id });
  return brand;
}

export async function getBrandBySlug(slug: string): Promise<Brand> {
  const brand = await db.query.brands.findFirst({ where: eq(brands.slug, slug) });
  if (brand) return brand;
  const all = await db.select({ slug: brands.slug }).from(brands);
  throw new NotFoundError(`Brand "${slug}" not found`, closeMatches(slug, all.map((b) => b.slug)));
}

export async function ensureBrand(input: { name: string; slug: string; domain?: string | null; actor: Actor }): Promise<Brand> {
  const existing = await db.query.brands.findFirst({ where: eq(brands.slug, slugify(input.slug)) });
  return existing ?? createBrand(input);
}

export async function listBrands(): Promise<BrandSummary[]> {
  const rows = await db.select().from(brands).orderBy(brands.name);
  return Promise.all(
    rows.map(async (b) => {
      const list = await db
        .select({ health: audits.health, coverage: audits.coverage, auditedAt: audits.auditedAt })
        .from(audits)
        .where(eq(audits.brandId, b.id))
        .orderBy(desc(audits.auditedAt));
      const { health, delta } = summarizeHealth(list);
      return {
        id: b.id,
        name: b.name,
        slug: b.slug,
        domain: b.domain,
        stage: b.stage,
        color: b.color,
        health,
        delta,
        latestAuditAt: list[0]?.auditedAt ?? null,
      };
    }),
  );
}

export async function saveOnboarding(
  slug: string,
  answers: Record<string, unknown>,
  actor: Actor,
): Promise<{ brand: Brand; missing: string[] }> {
  const brand = await getBrandBySlug(slug);
  const merged = { ...brand.onboarding, ...answers };
  const [updated] = await db.update(brands).set({ onboarding: merged }).where(eq(brands.id, brand.id)).returning();
  await logActivity({
    brandId: brand.id,
    actor,
    kind: "brand",
    summary: `Saved onboarding answers: ${Object.keys(answers).join(", ")}`,
  });
  return { brand: updated, missing: missingOnboardingQuestions(merged).map((q) => q.key) };
}

export async function advanceStage(brandId: string, target: Stage, tx: DbOrTx = db): Promise<void> {
  const [b] = await tx.select({ stage: brands.stage }).from(brands).where(eq(brands.id, brandId));
  if (!b) throw new NotFoundError(`Brand ${brandId} not found`);
  if (STAGE_ORDER.indexOf(target) > STAGE_ORDER.indexOf(b.stage)) {
    await tx.update(brands).set({ stage: target }).where(eq(brands.id, brandId));
  }
}

import { desc, eq, inArray } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/data/db";
import { audits, auditScores, brands, files, scoringConfig } from "@/lib/data/schema";
import {
  CATEGORIES,
  computeHealth,
  DEFAULT_WEIGHTS,
  isPartial,
  summarizeHealth,
  type Category,
  type CategoryScores,
  type Weights,
} from "@/lib/domain/scoring";
import type { Actor } from "./actor";
import { logActivity } from "./activity";
import { advanceStage, getBrandBySlug } from "./brands";
import { ValidationError } from "./errors";
import { findFileId } from "./files";

export type AuditScoreInput = { category: Category; score: number; target?: number | null; evidence?: string | null };
export type RecordAuditResult = {
  auditId: string;
  health: number | null;
  coverage: number;
  partial: boolean;
  delta: number | null;
  duplicate: boolean;
};
export type AuditWithScores = {
  id: string;
  auditedAt: Date;
  health: number | null;
  coverage: number;
  partial: boolean;
  reportPath: string | null;
  scores: { category: string; score: number; target: number | null; evidence: string | null }[];
};

export async function getWeights(): Promise<Weights> {
  const [row] = await db.select().from(scoringConfig).limit(1);
  if (!row) return DEFAULT_WEIGHTS;
  return { ...DEFAULT_WEIGHTS, ...(row.weights as Partial<Weights>) };
}

async function deltaFor(brandId: string, auditId: string): Promise<number | null> {
  const list = await db
    .select({ id: audits.id, health: audits.health, coverage: audits.coverage })
    .from(audits)
    .where(eq(audits.brandId, brandId))
    .orderBy(desc(audits.auditedAt), desc(audits.createdAt));
  const idx = list.findIndex((a) => a.id === auditId);
  if (idx < 0 || isPartial(list[idx].coverage)) return null;
  return summarizeHealth(list.slice(idx)).delta;
}

export async function recordAudit(input: {
  brandSlug: string;
  auditedAt?: Date;
  reportPath?: string;
  scores: AuditScoreInput[];
  requestId?: string;
  actor: Actor;
}): Promise<RecordAuditResult> {
  const brand = await getBrandBySlug(input.brandSlug);

  const findPrior = async (executor: DbOrTx) => {
    if (!input.requestId) return null;
    const [prior] = await executor.select().from(audits).where(eq(audits.requestId, input.requestId));
    return prior ?? null;
  };
  const duplicateResult = async (prior: typeof audits.$inferSelect): Promise<RecordAuditResult> => ({
    auditId: prior.id,
    health: prior.health,
    coverage: prior.coverage,
    partial: isPartial(prior.coverage),
    delta: await deltaFor(prior.brandId, prior.id),
    duplicate: true,
  });
  const early = await findPrior(db);
  if (early) return duplicateResult(early);

  if (input.scores.length === 0) throw new ValidationError("At least one category score is required", "scores");
  const map: CategoryScores = {};
  for (const s of input.scores) {
    if (!CATEGORIES.includes(s.category)) throw new ValidationError(`Unknown category "${s.category}"`, "scores");
    if (map[s.category] !== undefined) throw new ValidationError(`Duplicate category "${s.category}"`, "scores");
    map[s.category] = s.score;
  }

  let result;
  try {
    result = computeHealth(map, await getWeights());
  } catch (e) {
    if (e instanceof RangeError) throw new ValidationError(e.message, "scores");
    throw e;
  }

  const fileId = input.reportPath ? await findFileId(brand.id, input.reportPath) : null;

  const created = await db.transaction(async (tx): Promise<{ prior: typeof audits.$inferSelect } | { auditId: string }> => {
    // Serialize per brand so a retry racing the original call finds the original's request id.
    await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brand.id)).for("update");
    const raced = await findPrior(tx);
    if (raced) return { prior: raced };
    const [audit] = await tx
      .insert(audits)
      .values({
        brandId: brand.id,
        auditedAt: input.auditedAt ?? new Date(),
        fileId,
        health: result.health,
        coverage: result.coverage,
        requestId: input.requestId ?? null,
      })
      .returning({ id: audits.id });
    await tx.insert(auditScores).values(
      input.scores.map((s) => ({
        auditId: audit.id,
        category: s.category,
        score: Math.round(s.score),
        target: s.target ?? null,
        evidence: s.evidence ?? null,
      })),
    );
    await advanceStage(brand.id, "audited", tx);
    await logActivity(
      {
        brandId: brand.id,
        actor: input.actor,
        kind: "audit",
        summary: `Audit recorded: health ${result.health ?? "n/a"}${result.partial ? " (partial)" : ""}`,
        refType: "audit",
        refId: audit.id,
      },
      tx,
    );
    return { auditId: audit.id };
  });

  if ("prior" in created) return duplicateResult(created.prior);
  return { auditId: created.auditId, ...result, delta: await deltaFor(brand.id, created.auditId), duplicate: false };
}

export async function listAudits(brandId: string): Promise<AuditWithScores[]> {
  const rows = await db
    .select({
      id: audits.id,
      auditedAt: audits.auditedAt,
      health: audits.health,
      coverage: audits.coverage,
      reportPath: files.path,
    })
    .from(audits)
    .leftJoin(files, eq(files.id, audits.fileId))
    .where(eq(audits.brandId, brandId))
    .orderBy(desc(audits.auditedAt), desc(audits.createdAt));
  if (rows.length === 0) return [];
  const scores = await db
    .select()
    .from(auditScores)
    .where(inArray(auditScores.auditId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    ...r,
    partial: isPartial(r.coverage),
    scores: scores
      .filter((s) => s.auditId === r.id)
      .map((s) => ({ category: s.category, score: s.score, target: s.target, evidence: s.evidence })),
  }));
}

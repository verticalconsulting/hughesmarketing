import { readdir, readFile as readFs } from "node:fs/promises";
import path from "node:path";
import { normalizeDomain } from "@/lib/domain/text";
import type { Actor } from "@/lib/services/actor";
import { recordAudit } from "@/lib/services/audits";
import { ensureBrand } from "@/lib/services/brands";
import { createPlanVersion } from "@/lib/services/plans";
import { upsertIntegration } from "@/lib/services/integrations";
import { writeFile } from "@/lib/services/files";
import { auditDateFromFilename, parseAuditMarkdown } from "./parse-audit";
import { parseIntegrations } from "./parse-integrations";
import { parsePlanHeader } from "./parse-plan";

const SHARED_FOLDER = "Hughes Files";
const EXCLUDED_FOLDERS = new Set(["_Personal-Automations", "_Duplicates-to-delete"]);
const EXCLUDED_FILES = new Set(["desktop.ini", "Thumbs.db"]);

const BRAND_OVERRIDES: Record<string, { name: string; domain: string }> = {
  "Mercyhouseatc.com": { name: "Mercy House ATC", domain: "mercyhouseatc.com" },
  "Mercyhouseatc.com-vehicledonation": { name: "Mercy House Vehicle Donation", domain: "vehicledonationms.com" },
  "Superthriftdeals.org": { name: "SuperThrift", domain: "superthriftdeals.org" },
  "Bradleybrowninc.com": { name: "Bradley Brown Inc.", domain: "bradleybrowninc.com" },
  "Midstatewelding.com": { name: "Mid-State Welding", domain: "midstatewelding.com" },
  "Myelitegutters.com": { name: "Elite Gutters", domain: "myelitegutters.com" },
  "Roofcoms.com": { name: "Roof Co", domain: "roofcoms.com" },
};

export type ImportReport = {
  brands: string[];
  written: number;
  unchanged: number;
  skipped: string[];
  failed: { path: string; error: string }[];
  audits: number;
  plans: number;
  integrations: number;
};

async function walk(dir: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || EXCLUDED_FILES.has(entry.name)) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

export async function runImport(root: string, actor: Actor): Promise<ImportReport> {
  const report: ImportReport = { brands: [], written: 0, unchanged: 0, skipped: [], failed: [], audits: 0, plans: 0, integrations: 0 };

  const importFiles = async (dir: string, brandId: string | null) => {
    for (const rel of await walk(dir)) {
      try {
        const bytes = new Uint8Array(await readFs(path.join(dir, rel)));
        const r = await writeFile({ brandId, path: rel, content: bytes, actor, quiet: true });
        if (r.unchanged) report.unchanged++;
        else report.written++;
      } catch (e) {
        report.failed.push({ path: path.join(dir, rel), error: (e as Error).message });
      }
    }
  };

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      report.skipped.push(entry.name);
      continue;
    }
    if (entry.name.startsWith(".")) continue;
    if (EXCLUDED_FOLDERS.has(entry.name)) {
      report.skipped.push(entry.name);
      continue;
    }
    const dir = path.join(root, entry.name);
    if (entry.name === SHARED_FOLDER) {
      await importFiles(dir, null);
      continue;
    }

    const override = BRAND_OVERRIDES[entry.name];
    const brand = await ensureBrand({
      name: override?.name ?? entry.name,
      slug: entry.name,
      domain: override?.domain ?? (entry.name.includes(".") ? normalizeDomain(entry.name) : null),
      actor,
    });
    report.brands.push(brand.slug);
    await importFiles(dir, brand.id);

    const auditsDir = path.join(dir, "audits");
    const auditFiles = (await readdir(auditsDir).catch(() => [] as string[])).filter((f) => f.endsWith("-audit.md")).sort();
    for (const name of auditFiles) {
      try {
        const scores = parseAuditMarkdown(await readFs(path.join(auditsDir, name), "utf8"));
        if (scores.length === 0) continue;
        const r = await recordAudit({
          brandSlug: brand.slug,
          auditedAt: auditDateFromFilename(name) ?? undefined,
          reportPath: `audits/${name}`,
          scores: scores.map((s) => ({ category: s.category, score: s.score, evidence: s.evidence })),
          requestId: `import:${brand.slug}:audits/${name}`,
          actor,
        });
        if (!r.duplicate) report.audits++;
      } catch (e) {
        report.failed.push({ path: path.join(auditsDir, name), error: (e as Error).message });
      }
    }

    // One bad plan or integration must not abort the brands after it: record it and keep going.
    const planMd = await readFs(path.join(dir, "PLAN.md"), "utf8").catch(() => null);
    if (planMd) {
      try {
        const h = parsePlanHeader(planMd);
        if (h.objective) {
          const r = await createPlanVersion({
            brandSlug: brand.slug,
            requestId: `import:${brand.slug}:PLAN.md`,
            plan: {
              objective: h.objective,
              primaryChannel: h.primaryChannel,
              secondaryChannels: h.secondaryChannels,
              monthlyBudget: h.monthlyBudget,
              weeklyHours: h.weeklyHours,
              timeline: h.timeline,
              summary: h.summary,
              planFilePath: "PLAN.md",
            },
            items: [],
            actor,
          });
          if (!r.duplicate) report.plans++;
        }
      } catch (e) {
        report.failed.push({ path: path.join(dir, "PLAN.md"), error: (e as Error).message });
      }
    }

    const integrationsMd = await readFs(path.join(dir, "INTEGRATIONS.md"), "utf8").catch(() => null);
    if (integrationsMd) {
      for (const i of parseIntegrations(integrationsMd)) {
        try {
          await upsertIntegration({ brandSlug: brand.slug, service: i.service, status: "connected", identifiers: i.identifiers, actor });
          report.integrations++;
        } catch (e) {
          report.failed.push({ path: `${path.join(dir, "INTEGRATIONS.md")} (${i.service})`, error: (e as Error).message });
        }
      }
    }
  }
  return report;
}

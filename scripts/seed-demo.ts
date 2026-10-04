import { sql } from "@/lib/data/db";
import { CATEGORIES } from "@/lib/domain/scoring";
import { recordAudit } from "@/lib/services/audits";
import { createPlanVersion } from "@/lib/services/plans";
import { upsertUserByEmail } from "@/lib/services/users";

const email = process.env.AUTH_BYPASS_EMAIL;
if (!email) throw new Error("Set AUTH_BYPASS_EMAIL in .env.local");
const u = await upsertUserByEmail({ email });
const actor = { kind: "user" as const, userId: u.id, label: u.email };
const scores = (n: number) => CATEGORIES.map((category) => ({ category, score: n, target: 80 }));

await recordAudit({ brandSlug: "test-brand", auditedAt: new Date("2026-09-01"), scores: scores(40), requestId: "demo-a1", actor });
await recordAudit({ brandSlug: "test-brand", auditedAt: new Date("2026-09-20"), scores: scores(52), requestId: "demo-a2", actor });
await createPlanVersion({
  brandSlug: "test-brand",
  requestId: "demo-p1",
  plan: { objective: "More leads", primaryChannel: "SEO", monthlyBudget: 500, timeline: "90_day" },
  items: [
    { title: "Launch $500 search test", funnelStage: "acquisition", priority: 1, needsApproval: true },
    { title: "Publish FAQ page", funnelStage: "activation", priority: 2 },
  ],
  actor,
});
console.log("Seeded test-brand");
await sql.end();

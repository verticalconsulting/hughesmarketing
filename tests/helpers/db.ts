import { db, sql } from "@/lib/data/db";
import { users } from "@/lib/data/schema";
import type { Actor } from "@/lib/services/actor";

export async function resetDb(): Promise<void> {
  await sql`TRUNCATE metric_points, activities, tracker_checkins, trackers, plan_item_files, plan_items, plans,
    audit_scores, audits, file_versions, files, integrations, brands, api_tokens, users,
    companies, scoring_config RESTART IDENTITY CASCADE`;
  await sql`INSERT INTO companies (name) VALUES ('Five Hughes LLC')`;
  const weights = JSON.stringify({
    ai_visibility: 20,
    geo: 15,
    seo: 20,
    website_content: 20,
    social: 10,
    paid_ads: 15,
  });
  await sql`INSERT INTO scoring_config (weights) VALUES (${weights}::jsonb)`;
}

export async function createTestUser(email = "tester@test.local"): Promise<Actor> {
  const [u] = await db.insert(users).values({ email, name: "Tester" }).returning();
  return { kind: "user", userId: u.id, label: email };
}

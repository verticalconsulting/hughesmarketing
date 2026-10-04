ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "file_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_item_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trackers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracker_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scoring_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO "companies" ("name") SELECT 'Five Hughes LLC' WHERE NOT EXISTS (SELECT 1 FROM "companies");--> statement-breakpoint
INSERT INTO "scoring_config" ("weights") SELECT '{"ai_visibility":20,"geo":15,"seo":20,"website_content":20,"social":10,"paid_ads":15}'::jsonb WHERE NOT EXISTS (SELECT 1 FROM "scoring_config");

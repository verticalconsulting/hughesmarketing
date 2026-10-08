CREATE TABLE "metric_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"date" date NOT NULL,
	"dimension" text DEFAULT '' NOT NULL,
	"value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_points_key" UNIQUE("brand_id","source","metric","date","dimension")
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "synced_from" date;--> statement-breakpoint
ALTER TABLE "metric_points" ADD CONSTRAINT "metric_points_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "metric_points_lookup" ON "metric_points" USING btree ("brand_id","source","metric","date");
--> statement-breakpoint
ALTER TABLE "metric_points" ENABLE ROW LEVEL SECURITY;

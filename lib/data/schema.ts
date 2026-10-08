import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const stageEnum = pgEnum("brand_stage", ["onboarding", "audited", "planned", "executing"]);
export const funnelEnum = pgEnum("funnel_stage", ["acquisition", "activation", "retention", "referral", "revenue"]);
export const itemStatusEnum = pgEnum("plan_item_status", [
  "planned",
  "active",
  "needs_approval",
  "approved",
  "done",
  "blocked",
  "declined",
]);
export const planStatusEnum = pgEnum("plan_status", ["active", "archived"]);
export const directionEnum = pgEnum("kpi_direction", ["up", "down"]);
export const verdictEnum = pgEnum("verdict", ["pending", "positive", "neutral", "negative"]);
export const integrationStatusEnum = pgEnum("integration_status", ["connected", "not_connected", "error"]);
export const activityKindEnum = pgEnum("activity_kind", [
  "brand",
  "chat",
  "workflow",
  "audit",
  "plan",
  "approval",
  "file",
  "tracker",
  "integration",
]);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  ...timestamps,
});

export const apiTokens = pgTable("api_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps,
});

export const brands = pgTable("brands", {
  id: id(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  domain: text("domain"),
  stage: stageEnum("stage").notNull().default("onboarding"),
  onboarding: jsonb("onboarding").$type<Record<string, unknown>>().notNull().default({}),
  color: text("color").notNull(),
  ...timestamps,
});

export const files = pgTable(
  "files",
  {
    id: id(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    currentVersion: integer("current_version").notNull(),
    ...timestamps,
  },
  (t) => [unique("files_brand_path").on(t.brandId, t.path).nullsNotDistinct()],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: id(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    size: integer("size").notNull(),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("file_versions_file_version").on(t.fileId, t.version)],
);

export const audits = pgTable("audits", {
  id: id(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  auditedAt: timestamp("audited_at", { withTimezone: true }).notNull(),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  health: integer("health"),
  coverage: real("coverage").notNull(),
  requestId: text("request_id").unique(),
  ...timestamps,
});

export const auditScores = pgTable("audit_scores", {
  id: id(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => audits.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  score: integer("score").notNull(),
  target: integer("target"),
  evidence: text("evidence"),
});

export const plans = pgTable("plans", {
  id: id(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: planStatusEnum("status").notNull().default("active"),
  objective: text("objective").notNull(),
  primaryChannel: text("primary_channel"),
  secondaryChannels: text("secondary_channels").array().notNull().default([]),
  monthlyBudget: real("monthly_budget"),
  weeklyHours: real("weekly_hours"),
  timeline: text("timeline"),
  summary: text("summary"),
  sourceAuditId: uuid("source_audit_id").references(() => audits.id, { onDelete: "set null" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  requestId: text("request_id").unique(),
  ...timestamps,
});

export const planItems = pgTable("plan_items", {
  id: id(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  funnelStage: funnelEnum("funnel_stage").notNull(),
  channel: text("channel"),
  priority: integer("priority").notNull().default(100),
  status: itemStatusEnum("status").notNull(),
  expectedKpi: text("expected_kpi"),
  needsApproval: boolean("needs_approval").notNull().default(false),
  approvalNote: text("approval_note"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  notes: text("notes"),
  ...timestamps,
});

export const planItemFiles = pgTable(
  "plan_item_files",
  {
    planItemId: uuid("plan_item_id")
      .notNull()
      .references(() => planItems.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.planItemId, t.fileId] })],
);

export const trackers = pgTable("trackers", {
  id: id(),
  planItemId: uuid("plan_item_id")
    .notNull()
    .unique()
    .references(() => planItems.id, { onDelete: "cascade" }),
  kpi: text("kpi").notNull(),
  unit: text("unit"),
  direction: directionEnum("direction").notNull(),
  baselineValue: real("baseline_value").notNull(),
  baselineAt: timestamp("baseline_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  windowDays: integer("window_days").notNull(),
  thresholdPct: real("threshold_pct").notNull().default(5),
  verdict: verdictEnum("verdict").notNull().default("pending"),
  verdictAt: timestamp("verdict_at", { withTimezone: true }),
  changePct: real("change_pct"),
  ...timestamps,
});

export const trackerCheckins = pgTable("tracker_checkins", {
  id: id(),
  trackerId: uuid("tracker_id")
    .notNull()
    .references(() => trackers.id, { onDelete: "cascade" }),
  value: real("value").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    status: integrationStatusEnum("status").notNull(),
    identifiers: jsonb("identifiers").$type<Record<string, string>>().notNull().default({}),
    notes: text("notes"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    syncedFrom: date("synced_from", { mode: "string" }),
    ...timestamps,
  },
  (t) => [unique("integrations_brand_service").on(t.brandId, t.service)],
);

export const metricPoints = pgTable(
  "metric_points",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    metric: text("metric").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    dimension: text("dimension").notNull().default(""),
    value: doublePrecision("value").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("metric_points_key").on(t.brandId, t.source, t.metric, t.date, t.dimension),
    index("metric_points_lookup").on(t.brandId, t.source, t.metric, t.date),
  ],
);

export const activities = pgTable("activities", {
  id: id(),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
  actorKind: text("actor_kind").notNull(),
  actorLabel: text("actor_label").notNull(),
  kind: activityKindEnum("kind").notNull(),
  summary: text("summary").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scoringConfig = pgTable("scoring_config", {
  id: id(),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  ...timestamps,
});

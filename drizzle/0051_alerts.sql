CREATE TYPE "public"."alert_kind" AS ENUM('low_stock', 'cash_difference', 'reconciliation_divergent', 'queue_abandonment', 'target_at_risk');--> statement-breakpoint
CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"organization_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"is_enabled" boolean NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"threshold" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_rules_organization_id_kind_pk" PRIMARY KEY("organization_id","kind"),
	CONSTRAINT "alert_rules_threshold" CHECK ("alert_rules"."threshold" is null or "alert_rules"."threshold" >= 0)
);
--> statement-breakpoint
ALTER TABLE "alert_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"store_id" uuid,
	"severity" "alert_severity" NOT NULL,
	"title" varchar(160) NOT NULL,
	"detail" varchar(500) NOT NULL,
	"status" "alert_status" DEFAULT 'open' NOT NULL,
	"assigned_membership_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "alerts_resolution" CHECK (("alerts"."status" = 'resolved') = ("alerts"."resolved_at" is not null and "alerts"."resolution_note" is not null))
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_assignee_fk" FOREIGN KEY ("organization_id","assigned_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_open_dedupe_key" ON "alerts" USING btree ("organization_id","dedupe_key") WHERE "alerts"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("organization_id","status","store_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alert_rules" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alerts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
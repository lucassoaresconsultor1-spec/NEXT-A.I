CREATE TYPE "public"."divergence_kind" AS ENUM('status_mismatch', 'amount_mismatch', 'unreachable');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('not_configured', 'no_payments', 'reconciled', 'divergent');--> statement-breakpoint
CREATE TABLE "daily_closings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"version" integer NOT NULL,
	"sale_count" integer NOT NULL,
	"sales_cents" bigint NOT NULL,
	"cancelled_cents" bigint NOT NULL,
	"returned_cents" bigint NOT NULL,
	"cash_cents" bigint NOT NULL,
	"card_external_cents" bigint NOT NULL,
	"pix_cents" bigint NOT NULL,
	"card_provider_cents" bigint NOT NULL,
	"cash_difference_cents" bigint NOT NULL,
	"reconciliation" "reconciliation_status" NOT NULL,
	"reconciled_count" integer NOT NULL,
	"divergent_count" integer NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "daily_closings_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "daily_closings_version_key" UNIQUE("organization_id","store_id","day","version"),
	CONSTRAINT "daily_closings_counts" CHECK ("daily_closings"."version" >= 1 and "daily_closings"."sale_count" >= 0 and "daily_closings"."reconciled_count" >= 0 and "daily_closings"."divergent_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_closings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_divergences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"closing_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"provider_reference" varchar(120) NOT NULL,
	"kind" "divergence_kind" NOT NULL,
	"our_status" varchar(16) NOT NULL,
	"provider_status" varchar(16),
	"our_cents" bigint NOT NULL,
	"provider_cents" bigint,
	CONSTRAINT "reconciliation_divergences_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_divergences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_closings" ADD CONSTRAINT "daily_closings_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_divergences" ADD CONSTRAINT "reconciliation_divergences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_divergences" ADD CONSTRAINT "reconciliation_divergences_closing_fk" FOREIGN KEY ("organization_id","closing_id") REFERENCES "public"."daily_closings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_divergences" ADD CONSTRAINT "reconciliation_divergences_intent_fk" FOREIGN KEY ("organization_id","intent_id") REFERENCES "public"."payment_intents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_closings_day_idx" ON "daily_closings" USING btree ("organization_id","day");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "daily_closings" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "daily_closings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "reconciliation_divergences" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "reconciliation_divergences" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
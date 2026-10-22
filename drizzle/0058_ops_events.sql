CREATE TYPE "public"."ops_event_kind" AS ENUM('error', 'slow_transaction');--> statement-breakpoint
CREATE TABLE "ops_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ops_event_kind" NOT NULL,
	"organization_id" uuid,
	"name" varchar(120) NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops_events" ADD CONSTRAINT "ops_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ops_events_created_idx" ON "ops_events" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "ops_insert" ON "ops_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "ops_platform_read" ON "ops_events" AS PERMISSIVE FOR SELECT TO public USING (coalesce(current_setting('app.platform', true), '') = 'on');
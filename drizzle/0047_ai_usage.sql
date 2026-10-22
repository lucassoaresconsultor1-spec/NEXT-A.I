CREATE TYPE "public"."ai_usage_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"feature" varchar(24) NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model" varchar(80) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint,
	"duration_ms" integer NOT NULL,
	"status" "ai_usage_status" NOT NULL,
	"error_kind" varchar(24),
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ai_usage_records_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_usage_records_tokens" CHECK ("ai_usage_records"."input_tokens" >= 0 and "ai_usage_records"."output_tokens" >= 0 and "ai_usage_records"."duration_ms" >= 0),
	CONSTRAINT "ai_usage_records_error" CHECK (("ai_usage_records"."status" = 'error') = ("ai_usage_records"."error_kind" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai_usage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_records_org_created_idx" ON "ai_usage_records" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "ai_usage_records" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "ai_usage_records" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
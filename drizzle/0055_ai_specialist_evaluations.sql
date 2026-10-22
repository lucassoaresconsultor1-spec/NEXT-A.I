CREATE TABLE "ai_specialist_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"specialist" varchar(24) NOT NULL,
	"cases" integer NOT NULL,
	"central_passed" integer NOT NULL,
	"specialist_passed" integer NOT NULL,
	"central_tokens" integer NOT NULL,
	"specialist_tokens" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ai_specialist_evaluations_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "ai_specialist_evaluations_counts" CHECK ("ai_specialist_evaluations"."cases" > 0 and "ai_specialist_evaluations"."central_passed" between 0 and "ai_specialist_evaluations"."cases" and "ai_specialist_evaluations"."specialist_passed" between 0 and "ai_specialist_evaluations"."cases")
);
--> statement-breakpoint
ALTER TABLE "ai_specialist_evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_specialist_evaluations" ADD CONSTRAINT "ai_specialist_evaluations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_specialist_evaluations" ADD CONSTRAINT "ai_specialist_evaluations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_specialist_evaluations_latest_idx" ON "ai_specialist_evaluations" USING btree ("organization_id","specialist","created_at");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "ai_specialist_evaluations" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "ai_specialist_evaluations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
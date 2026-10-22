CREATE TYPE "public"."report_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_kind" AS ENUM('sales_by_period', 'sales_by_store', 'sales_by_salesperson', 'expenses', 'daily_closings');--> statement-breakpoint
CREATE TYPE "public"."report_period" AS ENUM('yesterday', 'last_7_days', 'month_to_date', 'last_month');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('done', 'failed');--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"store_id" uuid,
	"group_by" varchar(8),
	"status" "report_run_status" NOT NULL,
	"row_count" integer NOT NULL,
	"content" text,
	"failure_reason" varchar(240),
	"schedule_id" uuid,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "report_runs_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "report_runs_status_fields" CHECK (("report_runs"."status" = 'done') = ("report_runs"."content" is not null) and ("report_runs"."status" = 'failed') = ("report_runs"."failure_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "report_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"period" "report_period" NOT NULL,
	"frequency" "report_frequency" NOT NULL,
	"hour" integer NOT NULL,
	"store_id" uuid,
	"group_by" varchar(8),
	"owner_membership_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"delivery" varchar(16) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_schedules_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "report_schedules_hour" CHECK ("report_schedules"."hour" between 0 and 23)
);
--> statement-breakpoint
ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_schedule_fk" FOREIGN KEY ("organization_id","schedule_id") REFERENCES "public"."report_schedules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_owner_fk" FOREIGN KEY ("organization_id","owner_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_runs_org_created_idx" ON "report_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("next_run_at") WHERE "report_schedules"."is_active";--> statement-breakpoint
CREATE POLICY "tenant_read" ON "report_runs" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "report_runs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "report_schedules" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
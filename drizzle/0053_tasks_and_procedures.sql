CREATE TYPE "public"."task_event_kind" AS ENUM('created', 'status_changed', 'assigned', 'comment');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_source" AS ENUM('manual', 'alert', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" varchar(20000) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "task_event_kind" NOT NULL,
	"text" varchar(1000),
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "task_events_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "task_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid,
	"title" varchar(160) NOT NULL,
	"description" varchar(2000),
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"assignee_membership_id" uuid,
	"source" "task_source" NOT NULL,
	"alert_id" uuid,
	"conversation_id" uuid,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "tasks_source" CHECK (("tasks"."source" = 'alert') = ("tasks"."alert_id" is not null) and ("tasks"."source" = 'assistant') = ("tasks"."conversation_id" is not null)),
	CONSTRAINT "tasks_closed" CHECK (("tasks"."status" in ('done', 'cancelled')) = ("tasks"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_fk" FOREIGN KEY ("organization_id","assignee_membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_alert_fk" FOREIGN KEY ("organization_id","alert_id") REFERENCES "public"."alerts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_conversation_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."ai_conversations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_org_title_idx" ON "procedures" USING btree ("organization_id",lower("title"));--> statement-breakpoint
CREATE INDEX "task_events_task_idx" ON "task_events" USING btree ("organization_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("organization_id","status","store_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("organization_id","assignee_membership_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedures" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "task_events" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "task_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tasks" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
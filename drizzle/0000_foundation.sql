CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."auth_event_type" AS ENUM('login_succeeded', 'login_failed', 'login_throttled', 'logout', 'signup', 'password_changed');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."store_access" AS ENUM('all', 'regions', 'stores');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(240),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"legal_name" varchar(160),
	"document" varchar(14),
	"plan_key" varchar(32) NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_document_unique" UNIQUE("document")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "plan_features" (
	"plan_key" varchar(32) NOT NULL,
	"feature" varchar(64) NOT NULL,
	CONSTRAINT "plan_features_plan_key_feature_pk" PRIMARY KEY("plan_key","feature")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text NOT NULL,
	"max_stores" integer,
	"max_members" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"region_id" uuid,
	"code" varchar(16) NOT NULL,
	"name" varchar(120) NOT NULL,
	"document" varchar(14),
	"phone" varchar(11),
	"email" varchar(254),
	"postal_code" varchar(8),
	"street" varchar(160),
	"number" varchar(16),
	"complement" varchar(80),
	"district" varchar(80),
	"city" varchar(80),
	"state" varchar(2),
	"timezone" varchar(64),
	"status" "store_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "stores_org_code_key" UNIQUE("organization_id","code")
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "auth_event_type" NOT NULL,
	"user_id" uuid,
	"subject_digest" varchar(64),
	"ip_digest" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"key" varchar(96) PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid,
	"active_store_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "membership_regions" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	CONSTRAINT "membership_regions_membership_id_region_id_pk" PRIMARY KEY("membership_id","region_id")
);
--> statement-breakpoint
ALTER TABLE "membership_regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_stores" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "membership_stores_membership_id_store_id_pk" PRIMARY KEY("membership_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "membership_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"store_access" "store_access" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "memberships_org_user_key" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" varchar(64) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(48) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(240),
	"is_system" boolean DEFAULT false NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "roles_org_key_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(64) NOT NULL,
	"entity_type" varchar(48) NOT NULL,
	"entity_id" uuid,
	"store_id" uuid,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_key_plans_key_fk" FOREIGN KEY ("plan_key") REFERENCES "public"."plans"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_region_fk" FOREIGN KEY ("organization_id","region_id") REFERENCES "public"."regions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_store_id_stores_id_fk" FOREIGN KEY ("active_store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_regions" ADD CONSTRAINT "membership_regions_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_regions" ADD CONSTRAINT "membership_regions_region_fk" FOREIGN KEY ("organization_id","region_id") REFERENCES "public"."regions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_stores" ADD CONSTRAINT "membership_stores_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_stores" ADD CONSTRAINT "membership_stores_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_name_idx" ON "departments" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "regions_org_name_idx" ON "regions" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "stores_org_region_idx" ON "stores" USING btree ("organization_id","region_id");--> statement-breakpoint
CREATE INDEX "stores_org_status_idx" ON "stores" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "auth_events_user_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "membership_regions_region_idx" ON "membership_regions" USING btree ("organization_id","region_id");--> statement-breakpoint
CREATE INDEX "membership_stores_store_idx" ON "membership_stores" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_org_entity_idx" ON "audit_logs" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "departments" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "organization_read" ON "organizations" AS PERMISSIVE FOR SELECT TO public USING (id = nullif(current_setting('app.organization_id', true), '')::uuid or coalesce(current_setting('app.platform', true), '') = 'on' or id in (select m.organization_id from organization_memberships m
    where m.user_id = nullif(current_setting('app.user_id', true), '')::uuid and m.status = 'active'));--> statement-breakpoint
CREATE POLICY "organization_insert" ON "organizations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid or coalesce(current_setting('app.platform', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "organization_update" ON "organizations" AS PERMISSIVE FOR UPDATE TO public USING (id = nullif(current_setting('app.organization_id', true), '')::uuid or coalesce(current_setting('app.platform', true), '') = 'on') WITH CHECK (id = nullif(current_setting('app.organization_id', true), '')::uuid or coalesce(current_setting('app.platform', true), '') = 'on');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "regions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stores" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_regions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "membership_stores" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_read" ON "organization_memberships" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid or user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_insert" ON "organization_memberships" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_update" ON "organization_memberships" AS PERMISSIVE FOR UPDATE TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "membership_delete" ON "organization_memberships" AS PERMISSIVE FOR DELETE TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "role_permissions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "roles" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "audit_logs" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "audit_logs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
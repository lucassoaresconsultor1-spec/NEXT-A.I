CREATE TYPE "public"."device_credential_kind" AS ENUM('pairing', 'device');--> statement-breakpoint
CREATE TYPE "public"."queue_device_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "salesperson_departments" (
	"organization_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "salesperson_departments_organization_id_salesperson_id_department_id_pk" PRIMARY KEY("organization_id","salesperson_id","department_id")
);
--> statement-breakpoint
ALTER TABLE "salesperson_departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"hash" varchar(64) PRIMARY KEY NOT NULL,
	"kind" "device_credential_kind" NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_credentials_pairing_expiry" CHECK (("device_credentials"."kind" = 'pairing') = ("device_credentials"."expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "queue_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"status" "queue_device_status" DEFAULT 'pending' NOT NULL,
	"paired_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_devices_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "queue_devices_status_fields" CHECK (("queue_devices"."status" = 'active') = ("queue_devices"."paired_at" is not null and "queue_devices"."revoked_at" is null) and ("queue_devices"."status" = 'revoked') = ("queue_devices"."revoked_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "queue_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "queue_pins" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"pin_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_pins_organization_id_membership_id_pk" PRIMARY KEY("organization_id","membership_id")
);
--> statement-breakpoint
ALTER TABLE "queue_pins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "salesperson_departments" ADD CONSTRAINT "salesperson_departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_departments" ADD CONSTRAINT "salesperson_departments_salesperson_fk" FOREIGN KEY ("organization_id","salesperson_id") REFERENCES "public"."salespeople"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_departments" ADD CONSTRAINT "salesperson_departments_department_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_devices" ADD CONSTRAINT "queue_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_devices" ADD CONSTRAINT "queue_devices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_devices" ADD CONSTRAINT "queue_devices_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_pins" ADD CONSTRAINT "queue_pins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_pins" ADD CONSTRAINT "queue_pins_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_credentials_device_idx" ON "device_credentials" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "queue_devices_store_idx" ON "queue_devices" USING btree ("organization_id","store_id");--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_department_fk" FOREIGN KEY ("organization_id","department_id") REFERENCES "public"."departments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "salesperson_departments" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "queue_devices" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "queue_pins" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
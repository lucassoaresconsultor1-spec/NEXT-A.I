CREATE TYPE "public"."customer_requirement" AS ENUM('none', 'optional', 'required');--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"customer_requirement" "customer_requirement" DEFAULT 'optional' NOT NULL,
	"max_discount_bps" integer DEFAULT 0 NOT NULL,
	"receipt_header" varchar(240),
	"receipt_footer" varchar(240),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_settings_discount_range" CHECK ("organization_settings"."max_discount_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_settings" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_requirement" "customer_requirement",
	"max_discount_bps" integer,
	"receipt_header" varchar(240),
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_organization_id_store_id_pk" PRIMARY KEY("organization_id","store_id"),
	CONSTRAINT "store_settings_discount_range" CHECK ("store_settings"."max_discount_bps" is null or "store_settings"."max_discount_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "store_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "organization_settings" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_settings" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
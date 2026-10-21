CREATE TYPE "public"."sales_target_scope" AS ENUM('organization', 'region', 'store', 'salesperson');--> statement-breakpoint
CREATE TABLE "sales_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" "sales_target_scope" NOT NULL,
	"region_id" uuid,
	"store_id" uuid,
	"salesperson_id" uuid,
	"month" varchar(7) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"version" integer NOT NULL,
	"reason" varchar(240),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sales_targets_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sales_targets_scope_fields" CHECK (("sales_targets"."scope" = 'organization' and "sales_targets"."region_id" is null and "sales_targets"."store_id" is null and "sales_targets"."salesperson_id" is null)
        or ("sales_targets"."scope" = 'region' and "sales_targets"."region_id" is not null and "sales_targets"."store_id" is null and "sales_targets"."salesperson_id" is null)
        or ("sales_targets"."scope" = 'store' and "sales_targets"."region_id" is null and "sales_targets"."store_id" is not null and "sales_targets"."salesperson_id" is null)
        or ("sales_targets"."scope" = 'salesperson' and "sales_targets"."region_id" is null and "sales_targets"."store_id" is not null and "sales_targets"."salesperson_id" is not null)),
	CONSTRAINT "sales_targets_month_format" CHECK ("sales_targets"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sales_targets_amount_positive" CHECK ("sales_targets"."amount_cents" > 0),
	CONSTRAINT "sales_targets_version" CHECK ("sales_targets"."version" >= 1 and ("sales_targets"."version" = 1 or "sales_targets"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_region_fk" FOREIGN KEY ("organization_id","region_id") REFERENCES "public"."regions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_salesperson_fk" FOREIGN KEY ("organization_id","salesperson_id") REFERENCES "public"."salespeople"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_targets_version_key" ON "sales_targets" USING btree ("organization_id","scope",coalesce("region_id", "store_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("salesperson_id", '00000000-0000-0000-0000-000000000000'::uuid),"month","version");--> statement-breakpoint
CREATE INDEX "sales_targets_org_month_idx" ON "sales_targets" USING btree ("organization_id","month");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "sales_targets" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "sales_targets" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
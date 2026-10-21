CREATE TABLE "salespeople" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"code" varchar(10) NOT NULL,
	"nickname" varchar(40) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salespeople_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "salespeople_org_membership_key" UNIQUE("organization_id","membership_id"),
	CONSTRAINT "salespeople_org_code_key" UNIQUE("organization_id","code"),
	CONSTRAINT "salespeople_code_format" CHECK ("salespeople"."code" ~ '^[A-Z0-9]{1,10}$')
);
--> statement-breakpoint
ALTER TABLE "salespeople" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "salesperson_stores" (
	"organization_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	CONSTRAINT "salesperson_stores_organization_id_salesperson_id_store_id_pk" PRIMARY KEY("organization_id","salesperson_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "salesperson_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"days_off" date[] DEFAULT '{}'::date[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "work_schedules_month_key" UNIQUE("organization_id","salesperson_id","store_id","month"),
	CONSTRAINT "work_schedules_month_format" CHECK ("work_schedules"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "work_schedules_days_off" CHECK (cardinality("work_schedules"."days_off") <= 31)
);
--> statement-breakpoint
ALTER TABLE "work_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salespeople" ADD CONSTRAINT "salespeople_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salespeople" ADD CONSTRAINT "salespeople_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_stores" ADD CONSTRAINT "salesperson_stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_stores" ADD CONSTRAINT "salesperson_stores_salesperson_fk" FOREIGN KEY ("organization_id","salesperson_id") REFERENCES "public"."salespeople"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salesperson_stores" ADD CONSTRAINT "salesperson_stores_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_link_fk" FOREIGN KEY ("organization_id","salesperson_id","store_id") REFERENCES "public"."salesperson_stores"("organization_id","salesperson_id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "salesperson_stores_store_idx" ON "salesperson_stores" USING btree ("organization_id","store_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "salespeople" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "salesperson_stores" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "work_schedules" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
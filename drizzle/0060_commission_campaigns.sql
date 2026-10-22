CREATE TABLE "commission_campaign_items" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	CONSTRAINT "commission_campaign_items_organization_id_id_pk" PRIMARY KEY("organization_id","id"),
	CONSTRAINT "commission_campaign_items_target" CHECK (("commission_campaign_items"."product_id" is null) <> ("commission_campaign_items"."category_id" is null))
);
--> statement-breakpoint
ALTER TABLE "commission_campaign_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid,
	"name" varchar(80) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"bonus_rate_bps" integer NOT NULL,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_campaigns_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_campaigns_bonus" CHECK ("commission_campaigns"."bonus_rate_bps" between 1 and 10000),
	CONSTRAINT "commission_campaigns_period" CHECK ("commission_campaigns"."ends_on" >= "commission_campaigns"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "commission_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD COLUMN "bonus_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_campaign_items" ADD CONSTRAINT "commission_campaign_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaign_items" ADD CONSTRAINT "commission_campaign_items_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."commission_campaigns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaign_items" ADD CONSTRAINT "commission_campaign_items_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaign_items" ADD CONSTRAINT "commission_campaign_items_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaigns" ADD CONSTRAINT "commission_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaigns" ADD CONSTRAINT "commission_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaigns" ADD CONSTRAINT "commission_campaigns_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_campaigns" ADD CONSTRAINT "commission_campaigns_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_campaign_items_campaign_idx" ON "commission_campaign_items" USING btree ("organization_id","campaign_id");--> statement-breakpoint
CREATE INDEX "commission_campaigns_period_idx" ON "commission_campaigns" USING btree ("organization_id","starts_on","ends_on");--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_campaign_fk" FOREIGN KEY ("organization_id","campaign_id") REFERENCES "public"."commission_campaigns"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_bonus" CHECK ("commission_statement_lines"."bonus_rate_bps" between 0 and 10000 and ("commission_statement_lines"."campaign_id" is null) = ("commission_statement_lines"."bonus_rate_bps" = 0));--> statement-breakpoint
CREATE POLICY "tenant_read" ON "commission_campaign_items" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "commission_campaign_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "commission_campaigns" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
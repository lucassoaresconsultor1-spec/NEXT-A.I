CREATE TYPE "public"."commission_line_kind" AS ENUM('sale', 'refund');--> statement-breakpoint
CREATE TYPE "public"."commission_statement_status" AS ENUM('calculated', 'approved', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "commission_rule_rates" (
	"organization_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"rate_bps" integer NOT NULL,
	CONSTRAINT "commission_rule_rates_organization_id_rule_id_category_id_pk" PRIMARY KEY("organization_id","rule_id","category_id"),
	CONSTRAINT "commission_rule_rates_rate" CHECK ("commission_rule_rates"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "commission_rule_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"default_rate_bps" integer NOT NULL,
	"reason" varchar(240),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commission_rules_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_rules_rate" CHECK ("commission_rules"."default_rate_bps" between 0 and 10000),
	CONSTRAINT "commission_rules_version" CHECK ("commission_rules"."version" >= 1 and ("commission_rules"."version" = 1 or "commission_rules"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "commission_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" "commission_line_kind" NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"refund_id" uuid,
	"base_cents" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"commission_cents" bigint NOT NULL,
	"rule_id" uuid,
	CONSTRAINT "commission_statement_lines_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_lines_kind" CHECK (("commission_statement_lines"."kind" = 'refund') = ("commission_statement_lines"."refund_id" is not null) and ("commission_statement_lines"."kind" = 'sale') = ("commission_statement_lines"."base_cents" >= 0)),
	CONSTRAINT "commission_lines_rate" CHECK ("commission_statement_lines"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"status" "commission_statement_status" DEFAULT 'calculated' NOT NULL,
	"base_cents" bigint NOT NULL,
	"commission_cents" bigint NOT NULL,
	"calculated_by" uuid,
	"calculated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"payment_reference" varchar(60),
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "commission_statements_month_format" CHECK ("commission_statements"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "commission_statements_status_fields" CHECK (("commission_statements"."status" = 'calculated' and "commission_statements"."approved_at" is null and "commission_statements"."paid_at" is null)
        or ("commission_statements"."status" = 'approved' and "commission_statements"."approved_at" is not null and "commission_statements"."paid_at" is null)
        or ("commission_statements"."status" = 'paid' and "commission_statements"."approved_at" is not null and "commission_statements"."paid_at" is not null and "commission_statements"."payment_reference" is not null)
        or ("commission_statements"."status" = 'cancelled' and "commission_statements"."cancelled_at" is not null and "commission_statements"."cancel_reason" is not null and "commission_statements"."paid_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commission_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_rule_rates" ADD CONSTRAINT "commission_rule_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_rates" ADD CONSTRAINT "commission_rule_rates_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."commission_rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rule_rates" ADD CONSTRAINT "commission_rule_rates_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_statement_fk" FOREIGN KEY ("organization_id","statement_id") REFERENCES "public"."commission_statements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_item_fk" FOREIGN KEY ("organization_id","sale_item_id") REFERENCES "public"."sale_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_refund_fk" FOREIGN KEY ("organization_id","refund_id") REFERENCES "public"."sale_refunds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_lines_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."commission_rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_salesperson_fk" FOREIGN KEY ("organization_id","salesperson_id") REFERENCES "public"."salespeople"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_version_key" ON "commission_rules" USING btree ("organization_id",coalesce("store_id", '00000000-0000-0000-0000-000000000000'::uuid),"version");--> statement-breakpoint
CREATE INDEX "commission_lines_statement_idx" ON "commission_statement_lines" USING btree ("organization_id","statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_statements_active_key" ON "commission_statements" USING btree ("organization_id","salesperson_id","store_id","month") WHERE "commission_statements"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "commission_statements_month_idx" ON "commission_statements" USING btree ("organization_id","month","store_id");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "commission_rule_rates" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "commission_rule_rates" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "commission_rules" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "commission_rules" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "commission_statement_lines" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "commission_statement_lines" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "commission_statements" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
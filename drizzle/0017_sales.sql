CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card_external', 'pix', 'card_provider');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'confirmed', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('suspended', 'completed', 'discarded', 'cancelled');--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"line" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_name" varchar(120) NOT NULL,
	"variant_name" varchar(80) NOT NULL,
	"sku" varchar(40) NOT NULL,
	"unit" "product_unit" NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"unit_cost_cents" bigint,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"reservation_id" uuid,
	"movement_id" uuid,
	CONSTRAINT "sale_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_items_sale_line_key" UNIQUE("sale_id","line"),
	CONSTRAINT "sale_items_quantity_positive" CHECK ("sale_items"."quantity" > 0),
	CONSTRAINT "sale_items_amounts" CHECK ("sale_items"."unit_price_cents" >= 0 and "sale_items"."discount_cents" >= 0 and "sale_items"."total_cents" >= 0 and ("sale_items"."unit_cost_cents" is null or "sale_items"."unit_cost_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tendered_cents" bigint,
	"change_cents" bigint,
	"nsu" varchar(20),
	"brand" varchar(30),
	"provider_reference" varchar(120),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sale_payments_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_payments_amount_positive" CHECK ("sale_payments"."amount_cents" > 0),
	CONSTRAINT "sale_payments_cash" CHECK ("sale_payments"."method" <> 'cash' or ("sale_payments"."tendered_cents" is not null and "sale_payments"."tendered_cents" >= "sale_payments"."amount_cents" and "sale_payments"."change_cents" = "sale_payments"."tendered_cents" - "sale_payments"."amount_cents")),
	CONSTRAINT "sale_payments_card_external" CHECK ("sale_payments"."method" <> 'card_external' or "sale_payments"."nsu" is not null)
);
--> statement-breakpoint
ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"number" integer,
	"status" "sale_status" NOT NULL,
	"completion_key" uuid,
	"cash_session_id" uuid,
	"operator_user_id" uuid NOT NULL,
	"salesperson_user_id" uuid,
	"customer_id" uuid,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"surcharge_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"change_cents" bigint DEFAULT 0 NOT NULL,
	"receipt_header" varchar(240),
	"receipt_footer" varchar(240),
	"note" varchar(500),
	"suspended_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"discard_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sales_org_completion_key_key" UNIQUE("organization_id","completion_key"),
	CONSTRAINT "sales_org_store_number_key" UNIQUE("organization_id","store_id","number"),
	CONSTRAINT "sales_completed_fields" CHECK (("sales"."status" in ('completed', 'cancelled')) = ("sales"."number" is not null and "sales"."completion_key" is not null and "sales"."completed_at" is not null and "sales"."cash_session_id" is not null)),
	CONSTRAINT "sales_discarded_fields" CHECK (("sales"."status" = 'discarded') = ("sales"."discarded_at" is not null)),
	CONSTRAINT "sales_amounts" CHECK ("sales"."subtotal_cents" >= 0 and "sales"."discount_cents" >= 0 and "sales"."surcharge_cents" >= 0 and "sales"."change_cents" >= 0
        and "sales"."total_cents" >= 0 and "sales"."total_cents" = "sales"."subtotal_cents" - "sales"."discount_cents" + "sales"."surcharge_cents")
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."inventory_reservations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_movement_fk" FOREIGN KEY ("organization_id","movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_salesperson_user_id_users_id_fk" FOREIGN KEY ("salesperson_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_session_fk" FOREIGN KEY ("organization_id","cash_session_id") REFERENCES "public"."cash_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("organization_id","sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("organization_id","sale_id");--> statement-breakpoint
CREATE INDEX "sales_store_completed_idx" ON "sales" USING btree ("organization_id","store_id","completed_at");--> statement-breakpoint
CREATE INDEX "sales_operator_completed_idx" ON "sales" USING btree ("organization_id","operator_user_id","completed_at");--> statement-breakpoint
CREATE INDEX "sales_store_status_idx" ON "sales" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "sale_payments" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "sale_payments" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
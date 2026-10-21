CREATE TYPE "public"."refund_kind" AS ENUM('cancellation', 'return');--> statement-breakpoint
CREATE TYPE "public"."refund_method" AS ENUM('original', 'cash', 'card_external');--> statement-breakpoint
CREATE TABLE "sale_refund_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"restocked" boolean NOT NULL,
	"movement_id" uuid,
	CONSTRAINT "sale_refund_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_refund_items_quantity_positive" CHECK ("sale_refund_items"."quantity" > 0),
	CONSTRAINT "sale_refund_items_amount_non_negative" CHECK ("sale_refund_items"."amount_cents" >= 0),
	CONSTRAINT "sale_refund_items_restock" CHECK ("sale_refund_items"."restocked" = ("sale_refund_items"."movement_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "sale_refund_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" "refund_kind" NOT NULL,
	"reason" varchar(240) NOT NULL,
	"method" "refund_method" NOT NULL,
	"nsu" varchar(20),
	"amount_cents" bigint NOT NULL,
	"cash_amount_cents" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"cash_session_id" uuid,
	"provider_status" varchar(16),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sale_refunds_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "sale_refunds_org_key_key" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "sale_refunds_amounts" CHECK ("sale_refunds"."amount_cents" > 0 and "sale_refunds"."cash_amount_cents" >= 0 and "sale_refunds"."cash_amount_cents" <= "sale_refunds"."amount_cents"),
	CONSTRAINT "sale_refunds_card_nsu" CHECK ("sale_refunds"."method" <> 'card_external' or "sale_refunds"."nsu" is not null),
	CONSTRAINT "sale_refunds_kind_method" CHECK (("sale_refunds"."kind" = 'cancellation') = ("sale_refunds"."method" = 'original'))
);
--> statement-breakpoint
ALTER TABLE "sale_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "suspension_key" uuid;--> statement-breakpoint
ALTER TABLE "sale_refund_items" ADD CONSTRAINT "sale_refund_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refund_items" ADD CONSTRAINT "sale_refund_items_refund_fk" FOREIGN KEY ("organization_id","refund_id") REFERENCES "public"."sale_refunds"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refund_items" ADD CONSTRAINT "sale_refund_items_item_fk" FOREIGN KEY ("organization_id","sale_item_id") REFERENCES "public"."sale_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refund_items" ADD CONSTRAINT "sale_refund_items_movement_fk" FOREIGN KEY ("organization_id","movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_session_fk" FOREIGN KEY ("organization_id","cash_session_id") REFERENCES "public"."cash_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_refund_items_item_idx" ON "sale_refund_items" USING btree ("organization_id","sale_item_id");--> statement-breakpoint
CREATE INDEX "sale_refunds_sale_idx" ON "sale_refunds" USING btree ("organization_id","sale_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_org_suspension_key_key" UNIQUE("organization_id","suspension_key");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "sale_refund_items" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "sale_refund_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "sale_refunds" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "sale_refunds" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
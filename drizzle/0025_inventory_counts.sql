CREATE TYPE "public"."inventory_count_status" AS ENUM('open', 'approved', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_count_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"expected_quantity" numeric(14, 3) NOT NULL,
	"counted_quantity" numeric(14, 3),
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_count_items_count_variant_key" UNIQUE("organization_id","count_id","variant_id"),
	CONSTRAINT "inventory_count_items_expected_non_negative" CHECK ("inventory_count_items"."expected_quantity" >= 0),
	CONSTRAINT "inventory_count_items_counted" CHECK (("inventory_count_items"."counted_quantity" is null) = ("inventory_count_items"."counted_at" is null) and ("inventory_count_items"."counted_quantity" is null or "inventory_count_items"."counted_quantity" >= 0)),
	CONSTRAINT "inventory_count_items_movement_counted" CHECK ("inventory_count_items"."movement_id" is null or "inventory_count_items"."counted_quantity" is not null)
);
--> statement-breakpoint
ALTER TABLE "inventory_count_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "inventory_count_status" DEFAULT 'open' NOT NULL,
	"category_id" uuid,
	"brand_id" uuid,
	"note" varchar(500),
	"opened_by" uuid,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_reason" varchar(240),
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_counts_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "inventory_counts_status_fields" CHECK (("inventory_counts"."status" = 'open' and "inventory_counts"."approved_at" is null and "inventory_counts"."cancelled_at" is null)
        or ("inventory_counts"."status" = 'approved' and "inventory_counts"."approved_at" is not null and "inventory_counts"."approval_reason" is not null and "inventory_counts"."cancelled_at" is null)
        or ("inventory_counts"."status" = 'cancelled' and "inventory_counts"."cancelled_at" is not null and "inventory_counts"."cancel_reason" is not null and "inventory_counts"."approved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_counted_by_users_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_count_fk" FOREIGN KEY ("organization_id","count_id") REFERENCES "public"."inventory_counts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_movement_fk" FOREIGN KEY ("organization_id","movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_brand_fk" FOREIGN KEY ("organization_id","brand_id") REFERENCES "public"."brands"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_one_open_per_store" ON "inventory_counts" USING btree ("organization_id","store_id") WHERE "inventory_counts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "inventory_counts_store_status_idx" ON "inventory_counts" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_count_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_counts" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
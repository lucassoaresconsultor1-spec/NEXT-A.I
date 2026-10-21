CREATE TYPE "public"."reservation_source" AS ENUM('transfer', 'sale');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'released', 'consumed');--> statement-breakpoint
CREATE TYPE "public"."stock_transfer_status" AS ENUM('requested', 'approved', 'in_transit', 'received', 'cancelled');--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"source" "reservation_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "inventory_reservations_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "inventory_reservations_status_dates" CHECK (("inventory_reservations"."status" = 'active' and "inventory_reservations"."released_at" is null and "inventory_reservations"."consumed_at" is null)
        or ("inventory_reservations"."status" = 'released' and "inventory_reservations"."released_at" is not null and "inventory_reservations"."consumed_at" is null)
        or ("inventory_reservations"."status" = 'consumed' and "inventory_reservations"."consumed_at" is not null and "inventory_reservations"."released_at" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity_requested" numeric(14, 3) NOT NULL,
	"quantity_sent" numeric(14, 3),
	"quantity_received" numeric(14, 3),
	"divergence_reason" varchar(240),
	"reservation_id" uuid,
	"exit_movement_id" uuid,
	"entry_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfer_items_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "stock_transfer_items_transfer_variant_key" UNIQUE("transfer_id","variant_id"),
	CONSTRAINT "stock_transfer_items_requested_positive" CHECK ("stock_transfer_items"."quantity_requested" > 0),
	CONSTRAINT "stock_transfer_items_sent_range" CHECK ("stock_transfer_items"."quantity_sent" is null or ("stock_transfer_items"."quantity_sent" >= 0 and "stock_transfer_items"."quantity_sent" <= "stock_transfer_items"."quantity_requested")),
	CONSTRAINT "stock_transfer_items_received_range" CHECK ("stock_transfer_items"."quantity_received" is null or ("stock_transfer_items"."quantity_sent" is not null and "stock_transfer_items"."quantity_received" >= 0 and "stock_transfer_items"."quantity_received" <= "stock_transfer_items"."quantity_sent"))
);
--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"origin_store_id" uuid NOT NULL,
	"destination_store_id" uuid NOT NULL,
	"status" "stock_transfer_status" DEFAULT 'requested' NOT NULL,
	"notes" varchar(500),
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"dispatched_by" uuid,
	"dispatched_at" timestamp with time zone,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(240),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "stock_transfers_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "stock_transfers_distinct_stores" CHECK ("stock_transfers"."origin_store_id" <> "stock_transfers"."destination_store_id"),
	CONSTRAINT "stock_transfers_cancelled" CHECK (("stock_transfers"."status" = 'cancelled') = ("stock_transfers"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "reserved" numeric(14, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD COLUMN "in_transit" numeric(14, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_transfer_fk" FOREIGN KEY ("organization_id","transfer_id") REFERENCES "public"."stock_transfers"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_reservation_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "public"."inventory_reservations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_exit_fk" FOREIGN KEY ("organization_id","exit_movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" ADD CONSTRAINT "stock_transfer_items_entry_fk" FOREIGN KEY ("organization_id","entry_movement_id") REFERENCES "public"."inventory_movements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_origin_fk" FOREIGN KEY ("organization_id","origin_store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destination_fk" FOREIGN KEY ("organization_id","destination_store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_reservations_active_idx" ON "inventory_reservations" USING btree ("organization_id","store_id","variant_id") WHERE "inventory_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "inventory_reservations_source_idx" ON "inventory_reservations" USING btree ("organization_id","source","source_id");--> statement-breakpoint
CREATE INDEX "stock_transfers_origin_status_idx" ON "stock_transfers" USING btree ("organization_id","origin_store_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfers_destination_status_idx" ON "stock_transfers" USING btree ("organization_id","destination_store_id","status");--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_reserved_range" CHECK ("inventory_balances"."reserved" >= 0 and "inventory_balances"."reserved" <= "inventory_balances"."quantity");--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_in_transit_non_negative" CHECK ("inventory_balances"."in_transit" >= 0);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_reservations" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_transfer_items" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stock_transfers" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
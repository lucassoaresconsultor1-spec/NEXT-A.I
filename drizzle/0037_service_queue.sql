CREATE TYPE "public"."queue_assignment" AS ENUM('rotation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."queue_entry_status" AS ENUM('waiting', 'in_service', 'finished', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."queue_outcome" AS ENUM('sale', 'no_sale');--> statement-breakpoint
CREATE TYPE "public"."queue_presence_status" AS ENUM('available', 'busy', 'away');--> statement-breakpoint
CREATE TABLE "queue_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"ticket" integer NOT NULL,
	"day" varchar(10) NOT NULL,
	"status" "queue_entry_status" DEFAULT 'waiting' NOT NULL,
	"note" varchar(80),
	"request_key" uuid NOT NULL,
	"arrived_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"salesperson_id" uuid,
	"assignment" "queue_assignment",
	"assignment_reason" varchar(240),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" "queue_outcome",
	"sale_id" uuid,
	"closing_reason" varchar(240),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queue_entries_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "queue_entries_org_request_key" UNIQUE("organization_id","request_key"),
	CONSTRAINT "queue_entries_ticket_key" UNIQUE("organization_id","store_id","day","ticket"),
	CONSTRAINT "queue_entries_status_fields" CHECK (("queue_entries"."status" = 'waiting' and "queue_entries"."salesperson_id" is null and "queue_entries"."started_at" is null and "queue_entries"."finished_at" is null)
        or ("queue_entries"."status" = 'in_service' and "queue_entries"."salesperson_id" is not null and "queue_entries"."started_at" is not null and "queue_entries"."finished_at" is null)
        or ("queue_entries"."status" = 'finished' and "queue_entries"."salesperson_id" is not null and "queue_entries"."finished_at" is not null and "queue_entries"."outcome" is not null)
        or ("queue_entries"."status" = 'abandoned' and "queue_entries"."salesperson_id" is null and "queue_entries"."finished_at" is not null and "queue_entries"."closing_reason" is not null)),
	CONSTRAINT "queue_entries_assignment" CHECK (("queue_entries"."salesperson_id" is null) = ("queue_entries"."assignment" is null) and ("queue_entries"."assignment" <> 'manual' or "queue_entries"."assignment_reason" is not null)),
	CONSTRAINT "queue_entries_outcome" CHECK (("queue_entries"."outcome" = 'sale') = ("queue_entries"."sale_id" is not null) and ("queue_entries"."outcome" <> 'no_sale' or "queue_entries"."closing_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "queue_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "queue_presence" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"salesperson_id" uuid NOT NULL,
	"status" "queue_presence_status" NOT NULL,
	"since" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "queue_presence_organization_id_store_id_salesperson_id_pk" PRIMARY KEY("organization_id","store_id","salesperson_id")
);
--> statement-breakpoint
ALTER TABLE "queue_presence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_salesperson_fk" FOREIGN KEY ("organization_id","salesperson_id") REFERENCES "public"."salespeople"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_presence" ADD CONSTRAINT "queue_presence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_presence" ADD CONSTRAINT "queue_presence_link_fk" FOREIGN KEY ("organization_id","salesperson_id","store_id") REFERENCES "public"."salesperson_stores"("organization_id","salesperson_id","store_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_entries_sale_key" ON "queue_entries" USING btree ("organization_id","sale_id") WHERE "queue_entries"."sale_id" is not null;--> statement-breakpoint
CREATE INDEX "queue_entries_store_status_idx" ON "queue_entries" USING btree ("organization_id","store_id","status","arrived_at");--> statement-breakpoint
CREATE INDEX "queue_entries_store_day_idx" ON "queue_entries" USING btree ("organization_id","store_id","day");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "queue_entries" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "queue_presence" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
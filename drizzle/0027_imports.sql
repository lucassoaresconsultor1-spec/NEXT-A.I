CREATE TYPE "public"."import_kind" AS ENUM('products', 'customers', 'opening_stock');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('ok', 'error', 'skipped', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('previewed', 'applying', 'done', 'discarded');--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"organization_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"field" varchar(32) NOT NULL,
	"source_column" varchar(120) NOT NULL,
	CONSTRAINT "import_mappings_organization_id_import_id_field_pk" PRIMARY KEY("organization_id","import_id","field")
);
--> statement-breakpoint
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"status" "import_row_status" NOT NULL,
	"messages" varchar(300)[] DEFAULT '{}'::varchar[] NOT NULL,
	"group_key" varchar(120),
	"product_name" varchar(120),
	"description" varchar(1000),
	"unit" varchar(2),
	"category_id" uuid,
	"brand_id" uuid,
	"variant_name" varchar(80),
	"sku" varchar(40),
	"barcode" varchar(14),
	"price_cents" bigint,
	"customer_name" varchar(120),
	"document" varchar(11),
	"email" varchar(254),
	"phone" varchar(11),
	"variant_id" uuid,
	"quantity" numeric(14, 3),
	"created_id" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_rows_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "import_rows_import_line_key" UNIQUE("organization_id","import_id","line"),
	CONSTRAINT "import_rows_line_positive" CHECK ("import_rows"."line" >= 2),
	CONSTRAINT "import_rows_price_non_negative" CHECK ("import_rows"."price_cents" is null or "import_rows"."price_cents" >= 0),
	CONSTRAINT "import_rows_quantity_positive" CHECK ("import_rows"."quantity" is null or "import_rows"."quantity" > 0),
	CONSTRAINT "import_rows_applied" CHECK (("import_rows"."status" = 'applied') = ("import_rows"."applied_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" "import_kind" NOT NULL,
	"status" "import_status" DEFAULT 'previewed' NOT NULL,
	"store_id" uuid,
	"file_name" varchar(200) NOT NULL,
	"total_rows" integer NOT NULL,
	"created_by" uuid,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "imports_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "imports_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "imports_store_kind" CHECK (("imports"."kind" = 'opening_stock') = ("imports"."store_id" is not null)),
	CONSTRAINT "imports_total_rows" CHECK ("imports"."total_rows" between 1 and 5000),
	CONSTRAINT "imports_done_fields" CHECK ("imports"."status" <> 'done' or ("imports"."confirmed_at" is not null and "imports"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_import_fk" FOREIGN KEY ("organization_id","import_id") REFERENCES "public"."imports"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_fk" FOREIGN KEY ("organization_id","import_id") REFERENCES "public"."imports"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_brand_fk" FOREIGN KEY ("organization_id","brand_id") REFERENCES "public"."brands"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_variant_fk" FOREIGN KEY ("organization_id","variant_id") REFERENCES "public"."product_variants"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_rows_import_status_idx" ON "import_rows" USING btree ("organization_id","import_id","status","line");--> statement-breakpoint
CREATE INDEX "imports_org_created_idx" ON "imports" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_mappings" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "import_rows" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "imports" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
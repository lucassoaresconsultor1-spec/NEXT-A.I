CREATE TYPE "public"."expense_status" AS ENUM('open', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"competence_date" date NOT NULL,
	"description" varchar(160) NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_date" date,
	"status" "expense_status" DEFAULT 'open' NOT NULL,
	"paid_on" date,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" varchar(240),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_status_fields" CHECK (("expenses"."status" = 'open' and "expenses"."paid_on" is null and "expenses"."cancelled_at" is null)
        or ("expenses"."status" = 'paid' and "expenses"."paid_on" is not null and "expenses"."cancelled_at" is null)
        or ("expenses"."status" = 'cancelled' and "expenses"."cancelled_at" is not null and "expenses"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_fk" FOREIGN KEY ("organization_id","category_id") REFERENCES "public"."expense_categories"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_org_name_idx" ON "expense_categories" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_store_competence_idx" ON "expenses" USING btree ("organization_id","store_id","competence_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expense_categories" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"document" varchar(11),
	"email" varchar(254),
	"phone" varchar(11),
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_document_digits" CHECK ("customers"."document" is null or "customers"."document" ~ '^[0-9]{11}$'),
	CONSTRAINT "customers_phone_digits" CHECK ("customers"."phone" is null or "customers"."phone" ~ '^[0-9]{10,11}$'),
	CONSTRAINT "customers_consent_date" CHECK (("customers"."marketing_consent" and "customers"."consent_at" is not null) or (not "customers"."marketing_consent" and "customers"."consent_at" is null))
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_document_idx" ON "customers" USING btree ("organization_id","document") WHERE "customers"."document" is not null;--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "customers_org_email_idx" ON "customers" USING btree ("organization_id","email") WHERE "customers"."email" is not null;--> statement-breakpoint
CREATE INDEX "customers_org_phone_idx" ON "customers" USING btree ("organization_id","phone") WHERE "customers"."phone" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
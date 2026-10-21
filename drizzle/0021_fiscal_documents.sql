CREATE TYPE "public"."fiscal_document_kind" AS ENUM('nfce');--> statement-breakpoint
CREATE TYPE "public"."fiscal_document_status" AS ENUM('not_configured', 'pending', 'authorized', 'rejected', 'cancelled', 'contingency');--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" "fiscal_document_kind" DEFAULT 'nfce' NOT NULL,
	"status" "fiscal_document_status" NOT NULL,
	"provider" varchar(40),
	"provider_reference" varchar(120),
	"access_key" varchar(44),
	"number" varchar(20),
	"series" varchar(5),
	"protocol" varchar(40),
	"rejection_reason" varchar(500),
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_documents_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "fiscal_documents_org_sale_kind_key" UNIQUE("organization_id","sale_id","kind"),
	CONSTRAINT "fiscal_documents_authorized_fields" CHECK ("fiscal_documents"."status" <> 'authorized' or ("fiscal_documents"."access_key" ~ '^[0-9]{44}$' and "fiscal_documents"."number" is not null and "fiscal_documents"."protocol" is not null)),
	CONSTRAINT "fiscal_documents_not_configured" CHECK ("fiscal_documents"."status" <> 'not_configured' or "fiscal_documents"."provider" is null)
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiscal_documents_store_status_idx" ON "fiscal_documents" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fiscal_documents" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
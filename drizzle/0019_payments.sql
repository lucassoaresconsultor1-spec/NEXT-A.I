CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"event_id" varchar(120) NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"source" varchar(16) NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "payment_events_provider_event_key" UNIQUE("provider","event_id"),
	CONSTRAINT "payment_events_source" CHECK ("payment_events"."source" in ('webhook', 'query'))
);
--> statement-breakpoint
ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider" varchar(40) NOT NULL,
	"provider_reference" varchar(120),
	"pix_qr_code" text,
	"pix_copy_paste" text,
	"expires_at" timestamp with time zone,
	"failure_reason" varchar(40),
	"idempotency_key" uuid NOT NULL,
	"sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "payment_intents_org_key_key" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "payment_intents_provider_reference_key" UNIQUE("provider","provider_reference"),
	CONSTRAINT "payment_intents_amount_positive" CHECK ("payment_intents"."amount_cents" > 0),
	CONSTRAINT "payment_intents_provider_method" CHECK ("payment_intents"."method" in ('pix', 'card_provider')),
	CONSTRAINT "payment_intents_sale_confirmed" CHECK ("payment_intents"."sale_id" is null or "payment_intents"."status" in ('confirmed', 'refunded'))
);
--> statement-breakpoint
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_provider_references" (
	"provider" varchar(40) NOT NULL,
	"provider_reference" varchar(120) NOT NULL,
	"organization_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_provider_references_provider_provider_reference_pk" PRIMARY KEY("provider","provider_reference")
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_intent_fk" FOREIGN KEY ("organization_id","intent_id") REFERENCES "public"."payment_intents"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_session_fk" FOREIGN KEY ("organization_id","cash_session_id") REFERENCES "public"."cash_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_sale_fk" FOREIGN KEY ("organization_id","sale_id") REFERENCES "public"."sales"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_provider_references" ADD CONSTRAINT "payment_provider_references_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_intent_idx" ON "payment_events" USING btree ("organization_id","intent_id");--> statement-breakpoint
CREATE INDEX "payment_intents_store_status_idx" ON "payment_intents" USING btree ("organization_id","store_id","status");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "payment_events" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "payment_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_intents" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
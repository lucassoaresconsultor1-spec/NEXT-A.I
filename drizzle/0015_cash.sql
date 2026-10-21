CREATE TYPE "public"."cash_movement_type" AS ENUM('opening', 'supply', 'withdrawal', 'sale', 'refund');--> statement-breakpoint
CREATE TYPE "public"."cash_session_event_type" AS ENUM('opened', 'closed', 'reopened');--> statement-breakpoint
CREATE TYPE "public"."cash_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"type" "cash_movement_type" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"reason" varchar(240),
	"reference_kind" varchar(16),
	"reference_id" uuid,
	"idempotency_key" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cash_movements_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "cash_movements_amount" CHECK (("cash_movements"."type" = 'opening' and "cash_movements"."amount_cents" >= 0) or "cash_movements"."amount_cents" > 0),
	CONSTRAINT "cash_movements_reason" CHECK ("cash_movements"."type" not in ('supply', 'withdrawal') or "cash_movements"."reason" is not null),
	CONSTRAINT "cash_movements_reference" CHECK ("cash_movements"."type" not in ('sale', 'refund') or ("cash_movements"."reference_kind" is not null and "cash_movements"."reference_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_registers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"name" varchar(60) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_registers_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "cash_registers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"type" "cash_session_event_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" varchar(500),
	"counted_cents" bigint,
	"expected_cents" bigint,
	"difference_cents" bigint,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "cash_session_events_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "cash_session_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "cash_session_status" DEFAULT 'open' NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"opening_amount_cents" bigint NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"counted_amount_cents" bigint,
	"expected_amount_cents" bigint,
	"difference_cents" bigint,
	"closing_note" varchar(500),
	"open_idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_sessions_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "cash_sessions_org_open_key_key" UNIQUE("organization_id","open_idempotency_key"),
	CONSTRAINT "cash_sessions_opening_non_negative" CHECK ("cash_sessions"."opening_amount_cents" >= 0),
	CONSTRAINT "cash_sessions_status_fields" CHECK (("cash_sessions"."status" = 'open' and "cash_sessions"."closed_at" is null and "cash_sessions"."counted_amount_cents" is null and "cash_sessions"."expected_amount_cents" is null and "cash_sessions"."difference_cents" is null)
        or ("cash_sessions"."status" = 'closed' and "cash_sessions"."closed_at" is not null and "cash_sessions"."counted_amount_cents" is not null and "cash_sessions"."expected_amount_cents" is not null and "cash_sessions"."difference_cents" is not null)),
	CONSTRAINT "cash_sessions_counted_non_negative" CHECK ("cash_sessions"."counted_amount_cents" is null or "cash_sessions"."counted_amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."cash_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_events" ADD CONSTRAINT "cash_session_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_events" ADD CONSTRAINT "cash_session_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_events" ADD CONSTRAINT "cash_session_events_session_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."cash_sessions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_fk" FOREIGN KEY ("organization_id","register_id") REFERENCES "public"."cash_registers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_movements_org_key_idx" ON "cash_movements" USING btree ("organization_id","idempotency_key") WHERE "cash_movements"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "cash_movements_session_idx" ON "cash_movements" USING btree ("organization_id","session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_registers_store_name_idx" ON "cash_registers" USING btree ("organization_id","store_id",lower("name"));--> statement-breakpoint
CREATE INDEX "cash_session_events_session_idx" ON "cash_session_events" USING btree ("organization_id","session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_open_register_idx" ON "cash_sessions" USING btree ("organization_id","register_id") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_open_operator_idx" ON "cash_sessions" USING btree ("organization_id","opened_by") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cash_sessions_store_opened_idx" ON "cash_sessions" USING btree ("organization_id","store_id","opened_at");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "cash_movements" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "cash_movements" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_registers" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_read" ON "cash_session_events" AS PERMISSIVE FOR SELECT TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "cash_session_events" AS PERMISSIVE FOR INSERT TO public WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_sessions" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
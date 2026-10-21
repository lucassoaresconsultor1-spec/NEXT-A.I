CREATE TYPE "public"."calendar_holiday_kind" AS ENUM('holiday', 'optional');--> statement-breakpoint
CREATE TABLE "calendar_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"store_id" uuid,
	"day" date NOT NULL,
	"name" varchar(80) NOT NULL,
	"kind" "calendar_holiday_kind" NOT NULL,
	"closed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_holidays_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "calendar_holidays_holiday_closed" CHECK ("calendar_holidays"."kind" <> 'holiday' or "calendar_holidays"."closed")
);
--> statement-breakpoint
ALTER TABLE "calendar_holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_work_weeks" (
	"organization_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_work_weeks_organization_id_store_id_pk" PRIMARY KEY("organization_id","store_id"),
	CONSTRAINT "store_work_weeks_weekdays" CHECK (cardinality("store_work_weeks"."weekdays") between 1 and 7 and "store_work_weeks"."weekdays" <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);
--> statement-breakpoint
ALTER TABLE "store_work_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_work_weeks" ADD CONSTRAINT "store_work_weeks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_work_weeks" ADD CONSTRAINT "store_work_weeks_store_fk" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holidays_org_day_key" ON "calendar_holidays" USING btree ("organization_id","day") WHERE "calendar_holidays"."store_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_holidays_store_day_key" ON "calendar_holidays" USING btree ("organization_id","store_id","day") WHERE "calendar_holidays"."store_id" is not null;--> statement-breakpoint
CREATE INDEX "calendar_holidays_org_day_idx" ON "calendar_holidays" USING btree ("organization_id","day");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "calendar_holidays" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_work_weeks" AS PERMISSIVE FOR ALL TO public USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid) WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
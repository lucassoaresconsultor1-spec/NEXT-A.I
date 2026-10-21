-- Custom migration: FORCE ROW LEVEL SECURITY for the calendar tables created in 0029
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "calendar_holidays" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_work_weeks" FORCE ROW LEVEL SECURITY;

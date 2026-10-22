-- Custom migration: FORCE ROW LEVEL SECURITY for the report tables created in 0045
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_runs" FORCE ROW LEVEL SECURITY;

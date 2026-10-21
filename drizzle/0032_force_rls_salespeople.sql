-- Custom migration: FORCE ROW LEVEL SECURITY for the salespeople tables created in 0031
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "salespeople" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesperson_stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_schedules" FORCE ROW LEVEL SECURITY;

-- Custom migration: FORCE ROW LEVEL SECURITY for the alert tables created in 0051
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "alert_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "alerts" FORCE ROW LEVEL SECURITY;

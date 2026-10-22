-- Custom migration: FORCE ROW LEVEL SECURITY for the closing tables created in 0043
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "daily_closings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliation_divergences" FORCE ROW LEVEL SECURITY;

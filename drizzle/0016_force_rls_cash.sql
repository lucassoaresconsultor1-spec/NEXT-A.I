-- Custom migration: FORCE ROW LEVEL SECURITY for the cash tables created in 0015
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "cash_registers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_session_events" FORCE ROW LEVEL SECURITY;

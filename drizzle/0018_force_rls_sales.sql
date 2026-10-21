-- Custom migration: FORCE ROW LEVEL SECURITY for the sales tables created in 0017
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_payments" FORCE ROW LEVEL SECURITY;

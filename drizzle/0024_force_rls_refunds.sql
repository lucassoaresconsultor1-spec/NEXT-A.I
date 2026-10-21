-- Custom migration: FORCE ROW LEVEL SECURITY for the refund tables created in 0023
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "sale_refunds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_refund_items" FORCE ROW LEVEL SECURITY;

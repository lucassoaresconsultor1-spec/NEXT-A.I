-- Custom migration: FORCE ROW LEVEL SECURITY for the inventory count tables created in 0025
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "inventory_counts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_count_items" FORCE ROW LEVEL SECURITY;

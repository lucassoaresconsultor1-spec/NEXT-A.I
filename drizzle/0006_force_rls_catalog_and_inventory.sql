-- Custom migration: FORCE ROW LEVEL SECURITY for the catalog and inventory
-- tables created in 0005 (drizzle-kit enables RLS but cannot emit FORCE).
-- Same rationale as 0001: the table owner is subject to the policies too.
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_balances" FORCE ROW LEVEL SECURITY;

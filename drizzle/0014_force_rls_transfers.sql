-- Custom migration: FORCE ROW LEVEL SECURITY for the reservation and transfer
-- tables created in 0013 (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "inventory_reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_transfer_items" FORCE ROW LEVEL SECURITY;

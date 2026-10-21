-- Custom migration: FORCE ROW LEVEL SECURITY for the purchasing tables and the
-- document counters created in 0011 (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "document_counters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goods_receipt_items" FORCE ROW LEVEL SECURITY;

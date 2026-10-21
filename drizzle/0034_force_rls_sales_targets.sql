-- Custom migration: FORCE ROW LEVEL SECURITY for the sales targets created in 0033
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "sales_targets" FORCE ROW LEVEL SECURITY;

-- Custom migration: FORCE ROW LEVEL SECURITY for the customers table created
-- in 0009 (drizzle-kit enables RLS but cannot emit FORCE). Same rationale as 0001.
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;

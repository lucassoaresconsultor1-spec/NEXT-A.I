-- Custom migration: FORCE ROW LEVEL SECURITY for fiscal_documents created in 0021
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "fiscal_documents" FORCE ROW LEVEL SECURITY;

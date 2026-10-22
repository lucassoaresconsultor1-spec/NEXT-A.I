-- Custom migration: FORCE ROW LEVEL SECURITY for ai_usage_records created in 0047
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "ai_usage_records" FORCE ROW LEVEL SECURITY;

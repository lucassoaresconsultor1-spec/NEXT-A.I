-- Custom migration: FORCE ROW LEVEL SECURITY for ai_specialist_evaluations created in 0055
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "ai_specialist_evaluations" FORCE ROW LEVEL SECURITY;

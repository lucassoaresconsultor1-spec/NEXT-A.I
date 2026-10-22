-- Custom migration: FORCE ROW LEVEL SECURITY for the expense tables created in 0041
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "expense_categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;

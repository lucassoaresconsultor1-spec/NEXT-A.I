-- Custom migration: FORCE ROW LEVEL SECURITY for the import tables created in 0027
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "imports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;

-- Custom migration: FORCE ROW LEVEL SECURITY for the operational settings
-- tables created in 0007 (drizzle-kit enables RLS but cannot emit FORCE).
-- Same rationale as 0001: the table owner is subject to the policies too.
ALTER TABLE "organization_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_settings" FORCE ROW LEVEL SECURITY;

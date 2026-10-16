-- Custom migration: drizzle-kit enables RLS but cannot emit FORCE.
-- FORCE makes the table owner subject to the policies as well, so only
-- superusers and roles with BYPASSRLS skip them. The application must
-- connect with a role that has neither (see docs/security.md).
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_regions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_stores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

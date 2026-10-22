-- Custom migration: FORCE ROW LEVEL SECURITY for the tenant tables created in 0039
-- (device_credentials is a global lookup without RLS, like sessions).
ALTER TABLE "queue_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "queue_pins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "salesperson_departments" FORCE ROW LEVEL SECURITY;

-- Custom migration: FORCE ROW LEVEL SECURITY for the task tables created in 0053
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedures" FORCE ROW LEVEL SECURITY;

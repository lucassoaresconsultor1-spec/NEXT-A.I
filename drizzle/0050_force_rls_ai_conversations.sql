-- Custom migration: FORCE ROW LEVEL SECURITY for the assistant tables created in 0049
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_tool_runs" FORCE ROW LEVEL SECURITY;

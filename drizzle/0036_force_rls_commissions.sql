-- Custom migration: FORCE ROW LEVEL SECURITY for the commission tables created in 0035
-- (drizzle-kit enables RLS but cannot emit FORCE).
ALTER TABLE "commission_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_rule_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" FORCE ROW LEVEL SECURITY;

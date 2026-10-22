-- Custom migration: FORCE ROW LEVEL SECURITY for the commission campaign tables
-- created in 0060 (m35a).
ALTER TABLE "commission_campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_campaign_items" FORCE ROW LEVEL SECURITY;

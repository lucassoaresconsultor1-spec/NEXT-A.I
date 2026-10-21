-- Custom migration: FORCE ROW LEVEL SECURITY for the payment tables created in
-- 0019. payment_provider_references is a global id map read by the webhook (no
-- session) and, like auth_rate_limits, has no tenant policy.
ALTER TABLE "payment_intents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_events" FORCE ROW LEVEL SECURITY;

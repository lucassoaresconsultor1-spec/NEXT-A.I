-- Custom migration: FORCE ROW LEVEL SECURITY for ops_events created in 0058
-- (insert from any connection, read only in the platform context).
ALTER TABLE "ops_events" FORCE ROW LEVEL SECURITY;

-- Custom migration: FORCE ROW LEVEL SECURITY for the queue tables created in 0037
-- (drizzle-kit enables RLS but cannot emit FORCE), and the new system role
-- "Recepção" in existing organizations (name, description and rank mirror
-- src/server/authz/system-roles.ts; system role permissions live in code).
ALTER TABLE "queue_presence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "queue_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
DECLARE
  org record;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.organization_id', org.id::text, true);
    INSERT INTO roles (organization_id, key, name, description, is_system, rank)
      VALUES (org.id, 'reception', 'Recepção', 'Recebe os clientes na entrada e opera a fila de atendimento da loja.', true, 20)
      ON CONFLICT (organization_id, key) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.organization_id', '', true);
  PERFORM set_config('app.platform', '', true);
END $$;

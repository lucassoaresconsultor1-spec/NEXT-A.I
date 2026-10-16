-- Custom migration: system roles of existing organizations follow the names
-- used by the business (Dono, Coordenador) and gain the Financeiro role.
-- Names and descriptions mirror src/server/authz/system-roles.ts; permissions
-- of system roles live in code, so only the rows change here.
-- roles and organizations are under FORCE ROW LEVEL SECURITY: each
-- organization is processed with app.organization_id set, as the app does.
DO $$
DECLARE
  org record;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  FOR org IN SELECT id FROM organizations LOOP
    PERFORM set_config('app.organization_id', org.id::text, true);
    UPDATE roles
      SET name = 'Dono', description = 'Acesso total à empresa, inclusive outros donos.', updated_at = now()
      WHERE organization_id = org.id AND is_system AND key = 'owner';
    UPDATE roles
      SET name = 'Coordenador',
          description = 'Acompanha a operação consolidada das lojas autorizadas, compara lojas e gerencia equipes.',
          updated_at = now()
      WHERE organization_id = org.id AND is_system AND key = 'regional_manager';
    INSERT INTO roles (organization_id, key, name, description, is_system, rank)
      VALUES (
        org.id,
        'finance',
        'Financeiro',
        'Faturamento, recebimentos, conciliação, caixa e despesas das lojas autorizadas, sem configurações operacionais.',
        true,
        80
      )
      ON CONFLICT (organization_id, key) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.organization_id', '', true);
  PERFORM set_config('app.platform', '', true);
END $$;

import Link from "next/link";
import { Table, Td, Th } from "@/components/ui/table";
import { PERMISSION_GROUPS } from "@/server/authz/permissions";
import type { RoleSummary } from "@/server/roles/service";
import { GrantMark } from "./role-badges";

/**
 * Read-only matrix: permission rows grouped by catalog area, one column per
 * role. The permission column stays visible while the table scrolls sideways.
 */
export function PermissionMatrix({ roles }: { roles: RoleSummary[] }) {
  const granted = roles.map((role) => new Set<string>(role.permissions));
  return (
    <Table caption="Matriz de permissões: cada coluna é um perfil e cada linha, uma permissão">
      <thead>
        <tr>
          <Th className="sticky left-0 z-10 min-w-56 bg-canvas">Permissão</Th>
          {roles.map((role) => (
            <Th key={role.id} className="min-w-28 text-center normal-case tracking-normal">
              <Link href={`/perfis/${role.id}`} className="hover:text-ink hover:underline">
                {role.name}
              </Link>
            </Th>
          ))}
        </tr>
      </thead>
      {PERMISSION_GROUPS.map((group) => (
        <tbody key={group.key}>
          <tr>
            <Th scope="rowgroup" colSpan={roles.length + 1} className="bg-surface pt-4 text-ink-soft">
              <span className="sticky left-4 inline-block">{group.label}</span>
            </Th>
          </tr>
          {group.permissions.map((permission) => (
            <tr key={permission.key} className="hover:bg-canvas/50">
              <Th scope="row" className="sticky left-0 z-10 bg-surface text-sm font-normal normal-case tracking-normal text-ink">
                {permission.label}
              </Th>
              {roles.map((role, index) => (
                <Td key={role.id} className="text-center">
                  <GrantMark granted={granted[index].has(permission.key)} />
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      ))}
    </Table>
  );
}

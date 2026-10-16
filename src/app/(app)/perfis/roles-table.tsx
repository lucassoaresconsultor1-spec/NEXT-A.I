import { ChevronRight, Pencil } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import { ALL_PERMISSIONS } from "@/server/authz/permissions";
import type { RoleSummary } from "@/server/roles/service";
import { RoleTypeBadge } from "./role-badges";

/** `editableIds` only switches the link label ("Editar"); the service still enforces every change. */
export function RolesTable({ roles, editableIds }: { roles: RoleSummary[]; editableIds: ReadonlySet<string> }) {
  return (
    <Table caption="Perfis de acesso da empresa, do maior para o menor nível">
      <thead>
        <tr>
          <Th>Perfil</Th>
          <Th>Tipo</Th>
          <Th className="text-right">Nível</Th>
          <Th className="text-right">Membros</Th>
          <Th className="text-right">Permissões</Th>
          <Th className="text-right">
            <span className="sr-only">Ações</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => {
          const editable = editableIds.has(role.id);
          return (
            <Tr key={role.id}>
              <Td>
                <p className="font-medium">{role.name}</p>
                {role.description ? <p className="max-w-md text-xs text-ink-muted">{role.description}</p> : null}
              </Td>
              <Td>
                <RoleTypeBadge isSystem={role.isSystem} />
              </Td>
              <Td className="text-right tabular-nums">{role.rank}</Td>
              <Td className="text-right tabular-nums">{role.memberCount === null ? "—" : formatInteger(role.memberCount)}</Td>
              <Td className="text-right tabular-nums">
                {role.permissions.length} <span className="text-ink-muted">de {ALL_PERMISSIONS.length}</span>
              </Td>
              <Td className="text-right">
                <LinkButton
                  href={`/perfis/${role.id}`}
                  variant="ghost"
                  size="sm"
                  aria-label={`${editable ? "Editar" : "Ver detalhes do"} perfil ${role.name}`}
                >
                  {editable ? (
                    <>
                      <Pencil className="size-4" aria-hidden /> Editar
                    </>
                  ) : (
                    <>
                      Ver detalhes <ChevronRight className="size-4" aria-hidden />
                    </>
                  )}
                </LinkButton>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

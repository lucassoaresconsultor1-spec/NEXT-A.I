import { Plus, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can, canManageRank } from "@/server/authz/guard";
import { canManageRoles, listRoles } from "@/server/roles/service";
import { PermissionMatrix } from "./permission-matrix";
import { RolesTable } from "./roles-table";

export const metadata: Metadata = { title: "Perfis de acesso" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function RolesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "roles.read")) return <AccessDenied />;
  const [roles, query] = await Promise.all([listRoles(context), searchParams]);
  const canManage = canManageRoles(context);
  const editableIds = new Set(
    canManage ? roles.filter((role) => !role.isSystem && canManageRank(context, role.rank)).map((role) => role.id) : [],
  );
  const newRoleButton = canManage ? (
    <LinkButton href="/perfis/novo">
      <Plus className="size-4" aria-hidden /> Novo perfil
    </LinkButton>
  ) : undefined;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Perfis de acesso" }]} />
      <PageHeader
        title="Perfis de acesso"
        description="Cada membro tem um perfil, que define o que ele pode ver e fazer. Perfis do sistema são mantidos pelo Varejo Inteligente; perfis personalizados ficam sempre abaixo do nível de quem os cria."
        actions={newRoleButton}
      />
      {query.excluido ? <Notice tone="success" title="Perfil excluído." /> : null}
      <Card>
        <CardHeader
          title="Perfis"
          description={
            context.storeScope.all
              ? "Membros inclui vínculos ativos e suspensos."
              : "A contagem de membros por perfil é exibida apenas para quem tem acesso a todas as lojas."
          }
        />
        {roles.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Nenhum perfil encontrado" action={newRoleButton} />
        ) : (
          <RolesTable roles={roles} editableIds={editableIds} />
        )}
      </Card>
      {roles.length > 0 ? (
        <Card>
          <CardHeader
            title="Matriz de permissões"
            description="Somente leitura. Para alterar um perfil personalizado, abra os detalhes dele. Em telas pequenas, deslize a tabela para o lado."
          />
          <PermissionMatrix roles={roles} />
        </Card>
      ) : null}
    </>
  );
}

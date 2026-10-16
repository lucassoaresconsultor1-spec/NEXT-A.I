import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext, type TenantContext } from "@/server/authz/context";
import { can, canManageRank } from "@/server/authz/guard";
import { canManageRoles, getRole, roleFormOptions, type RoleDetail } from "@/server/roles/service";
import { DeleteRoleDialog } from "../delete-role-dialog";
import { PermissionList } from "../permission-list";
import { RoleTypeBadge } from "../role-badges";
import { RoleForm } from "../role-form";

export const metadata: Metadata = { title: "Perfil de acesso" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Why a custom role is read-only for this member (null when it is editable or the member cannot manage roles). */
function readOnlyReason(context: TenantContext, role: RoleDetail) {
  if (!can(context, "roles.manage")) return null;
  if (!context.storeScope.all) return "Alterar perfis exige acesso a todas as lojas da empresa.";
  if (!canManageRank(context, role.rank)) return "Você só gerencia perfis de nível inferior ao seu.";
  return null;
}

function Summary({ role, timezone }: { role: RoleDetail; timezone: string }) {
  return (
    <Card>
      <CardHeader title="Resumo" />
      <CardBody>
        <DetailList
          items={[
            { label: "Tipo", value: <RoleTypeBadge isSystem={role.isSystem} /> },
            { label: "Identificador", value: <span className="font-mono text-xs">{role.key}</span> },
            { label: "Nível", value: role.rank },
            {
              label: "Membros (ativos e suspensos)",
              value: role.memberCount === null ? "Visível para quem tem acesso a todas as lojas" : formatInteger(role.memberCount),
            },
            { label: "Criado em", value: formatDateTime(role.createdAt, timezone) },
            { label: "Atualizado em", value: formatDateTime(role.updatedAt, timezone) },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function ReadOnlyPermissions({ role }: { role: RoleDetail }) {
  return (
    <Card>
      <CardHeader title="Permissões" description={`${role.permissions.length} permissão(ões) concedida(s).`} />
      <CardBody>
        <PermissionList permissions={role.permissions} />
      </CardBody>
    </Card>
  );
}

export default async function RoleDetailPage({ params, searchParams }: { params: Promise<{ roleId: string }>; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "roles.read")) return <AccessDenied />;
  const { roleId } = await params;
  const role = await getRole(context, roleId);
  if (!role) notFound();
  const query = await searchParams;
  const editable = !role.isSystem && canManageRoles(context) && canManageRank(context, role.rank);
  const deletable = editable && role.memberCount === 0;
  const reason = role.isSystem ? null : readOnlyReason(context, role);

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Painel", href: "/painel" }, { label: "Perfis de acesso", href: "/perfis" }, { label: role.name }]}
      />
      <PageHeader
        title={role.name}
        description={role.description ?? undefined}
        actions={deletable ? <DeleteRoleDialog role={{ id: role.id, name: role.name }} /> : undefined}
      />
      {query.criado ? <Notice tone="success" title="Perfil criado." /> : null}
      {role.isSystem ? (
        <Notice tone="info" title="Perfil do sistema">
          As permissões deste perfil são definidas pelo Varejo Inteligente e atualizadas automaticamente. Ele não pode ser
          alterado nem excluído; para um conjunto diferente, crie um perfil personalizado.
        </Notice>
      ) : null}
      {reason ? <Notice tone="info" title="Somente leitura">{reason}</Notice> : null}
      {editable && !deletable && role.memberCount ? (
        <Notice tone="info" title="Perfil em uso">
          {formatInteger(role.memberCount)} membro(s) usam este perfil. Para excluí-lo, altere antes o perfil deles na equipe.
          Alterações nas permissões valem para eles na próxima ação.
        </Notice>
      ) : null}
      <Summary role={role} timezone={context.organization.timezone} />
      {editable ? (
        <RoleForm
          role={{ id: role.id, name: role.name, description: role.description, rank: role.rank, permissions: role.permissions }}
          options={roleFormOptions(context)}
          cancelHref="/perfis"
        />
      ) : (
        <ReadOnlyPermissions role={role} />
      )}
    </>
  );
}

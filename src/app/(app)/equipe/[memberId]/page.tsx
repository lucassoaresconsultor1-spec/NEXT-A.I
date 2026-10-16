import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { formatDateTime } from "@/lib/format";
import { requireTenantContext, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { MANAGE_BLOCK_MESSAGES } from "@/server/members/rules";
import { getMember, getMemberFormOptions, type MemberDetail } from "@/server/members/service";
import { MemberAccessForm } from "../member-access-form";
import { MemberStatusBadge, STORE_ACCESS_LABELS } from "../member-badges";
import { MemberStatusDialog, RemoveMemberDialog, TemporaryPasswordDialog } from "../member-admin-dialogs";

export const metadata: Metadata = { title: "Membro da equipe" };

type Params = Promise<{ memberId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function ScopeValue({ member }: { member: MemberDetail }) {
  if (member.storeAccess === "all") return <>{STORE_ACCESS_LABELS.all}</>;
  const names = (member.storeAccess === "regions" ? member.regions : member.stores).map((link) => link.name);
  return (
    <span className="space-y-1">
      <span className="block font-medium">{STORE_ACCESS_LABELS[member.storeAccess]}</span>
      <span className="block text-ink-soft">{names.length ? names.join(", ") : "Nenhuma vinculada"}</span>
      {member.hasAccessOutsideViewerScope ? (
        <span className="block text-xs text-ink-muted">Também tem acesso fora do seu escopo.</span>
      ) : null}
    </span>
  );
}

function AddedNotice({ outcome }: { outcome?: string }) {
  if (outcome === "vinculado") {
    return (
      <Notice tone="success" title="Membro adicionado.">
        Este e-mail já tinha cadastro: a pessoa entra com a senha que já usa.
      </Notice>
    );
  }
  if (outcome === "novo") {
    return (
      <Notice tone="success" title="Membro adicionado.">
        Informe a senha provisória à pessoa por um canal seguro; ela deverá trocá-la no primeiro acesso.
      </Notice>
    );
  }
  return null;
}

function AccessNote({ context, member }: { context: TenantContext; member: MemberDetail }) {
  if (member.isSelf) {
    return (
      <Notice tone="info" title="Este é o seu acesso.">
        Perfil, escopo e situação do seu acesso são alterados por outro administrador da empresa.
      </Notice>
    );
  }
  if (member.manageBlock && can(context, "members.manage")) {
    return <Notice tone="info" title="Somente consulta">{MANAGE_BLOCK_MESSAGES[member.manageBlock]}</Notice>;
  }
  return null;
}

export default async function MemberPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "members.read")) return <AccessDenied />;
  const { memberId } = await params;
  const member = await getMember(context, memberId);
  if (!member) notFound();
  const outcome = single((await searchParams).adicionado);
  const manageable = member.manageBlock === null;
  const options = manageable ? await getMemberFormOptions(context) : null;
  const timeZone = context.organization.timezone;
  const ref = { membershipId: member.membershipId, name: member.name };

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Equipe", href: "/equipe" }, { label: member.name }]} />
      <PageHeader
        title={member.name}
        description={member.email}
        actions={
          manageable ? (
            <>
              <MemberStatusDialog member={ref} status={member.status} />
              {member.passwordResetBlock ? null : <TemporaryPasswordDialog member={ref} />}
              <RemoveMemberDialog member={ref} />
            </>
          ) : undefined
        }
      />
      <AddedNotice outcome={outcome} />
      <AccessNote context={context} member={member} />
      <Card>
        <CardHeader title="Dados do acesso" />
        <CardBody>
          <DetailList
            items={[
              { label: "Perfil", value: member.role.name },
              { label: "Situação", value: <MemberStatusBadge status={member.status} /> },
              { label: "Escopo", value: <ScopeValue member={member} /> },
              { label: "Último acesso", value: member.lastLoginAt ? formatDateTime(member.lastLoginAt, timeZone) : "Nunca acessou" },
              { label: "Na equipe desde", value: formatDateTime(member.createdAt, timeZone) },
              ...(member.passwordResetBlock ? [{ label: "Senha", value: member.passwordResetBlock }] : []),
            ]}
          />
        </CardBody>
      </Card>
      {options ? (
        <Card>
          <CardHeader
            title="Perfil e escopo"
            description="As lojas e regiões vinculadas são substituídas pela seleção ao salvar."
          />
          <CardBody>
            <MemberAccessForm
              membershipId={member.membershipId}
              roles={options.roles.map((role) => ({ id: role.id, name: role.name }))}
              scope={{ organizationWide: options.organizationWide, regions: options.regions, stores: options.stores }}
              current={{
                roleId: member.role.id,
                storeAccess: member.storeAccess,
                regionIds: member.regions.map((region) => region.id),
                storeIds: member.stores.map((store) => store.id),
              }}
            />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

import { SearchX, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, SortableTh, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { memberFiltersSchema } from "@/server/members/schemas";
import { listMembers, listRoleFilterOptions } from "@/server/members/service";
import { listStoreOptions } from "@/server/stores/options";
import { MemberStatusBadge, scopeSummary } from "./member-badges";
import { MemberFilters } from "./member-filters";

export const metadata: Metadata = { title: "Equipe" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function hrefWith(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/equipe?${query}` : "/equipe";
}

function AddMemberButton() {
  return (
    <LinkButton href="/equipe/novo">
      <UserPlus className="size-4" aria-hidden /> Adicionar membro
    </LinkButton>
  );
}

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "members.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = memberFiltersSchema.parse({
    q: single(raw.q),
    roleId: single(raw.perfil),
    status: single(raw.situacao),
    storeId: single(raw.loja),
    sort: single(raw.sort),
    dir: single(raw.dir),
    page: single(raw.page),
  });
  const [result, roleOptions, storeOptions] = await Promise.all([
    listMembers(context, filters),
    listRoleFilterOptions(context),
    can(context, "stores.read") ? listStoreOptions(context, { includeInactive: true }) : Promise.resolve(null),
  ]);
  const storeFilterOptions = storeOptions?.map((store) => ({ id: store.id, code: store.code, name: store.name })) ?? null;
  const canManage = can(context, "members.manage");
  const params = {
    q: filters.q,
    perfil: filters.roleId,
    situacao: filters.status,
    loja: filters.storeId,
    sort: filters.sort,
    dir: filters.dir,
  };
  const filtered = Boolean(filters.q || filters.roleId || filters.status || filters.storeId);
  const timeZone = context.organization.timezone;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Equipe" }]} />
      <PageHeader
        title="Equipe"
        description={
          context.storeScope.all
            ? "Pessoas com acesso à empresa, seus perfis e as lojas que cada uma pode acompanhar."
            : "Pessoas que atuam nas lojas do seu escopo."
        }
        actions={canManage ? <AddMemberButton /> : undefined}
      />
      {single(raw.removido) === "1" ? <Notice tone="success" title="Membro removido da equipe." /> : null}
      <Card>
        <MemberFilters key={JSON.stringify(params)} values={params} roles={roleOptions} stores={storeFilterOptions} />
        {result.rows.length === 0 ? (
          <EmptyState
            icon={result.total === 0 && !filtered ? Users : SearchX}
            title={result.total === 0 && !filtered ? "Ninguém na equipe do seu escopo" : "Nenhum membro encontrado"}
            description={
              result.total > 0
                ? "Esta página não tem resultados."
                : filtered
                  ? "Ajuste a busca ou os filtros para ver outras pessoas."
                  : "Adicione pessoas para que acompanhem as lojas."
            }
            action={
              result.total > 0 || filtered ? (
                <LinkButton href={result.total > 0 ? hrefWith(params) : "/equipe"} variant="secondary">
                  {result.total > 0 ? "Voltar à primeira página" : "Limpar filtros"}
                </LinkButton>
              ) : canManage ? (
                <AddMemberButton />
              ) : undefined
            }
          />
        ) : (
          <>
            <Table caption="Membros da equipe">
              <thead>
                <tr>
                  <SortableTh label="Nome" column="name" basePath="/equipe" params={params} />
                  <SortableTh label="E-mail" column="email" basePath="/equipe" params={params} />
                  <SortableTh label="Perfil" column="role" basePath="/equipe" params={params} />
                  <Th>Escopo</Th>
                  <SortableTh label="Situação" column="status" basePath="/equipe" params={params} />
                  <SortableTh label="Último acesso" column="lastLogin" basePath="/equipe" params={params} />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((member) => (
                  <Tr key={member.membershipId}>
                    <Td>
                      <Link href={`/equipe/${member.membershipId}`} className="font-medium text-brand hover:underline">
                        {member.name}
                      </Link>
                      {member.membershipId === context.membershipId ? <span className="ml-2 text-xs text-ink-muted">(você)</span> : null}
                    </Td>
                    <Td className="text-ink-soft">{member.email}</Td>
                    <Td>{member.role.name}</Td>
                    <Td className="max-w-64 truncate text-ink-soft" title={scopeSummary(member.storeAccess, member.scopeNames, member.scopeCount)}>
                      {scopeSummary(member.storeAccess, member.scopeNames, member.scopeCount)}
                    </Td>
                    <Td>
                      <MemberStatusBadge status={member.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-soft">
                      {member.lastLoginAt ? formatDateTime(member.lastLoginAt, timeZone) : "Nunca acessou"}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/equipe" params={params} />
          </>
        )}
      </Card>
    </>
  );
}

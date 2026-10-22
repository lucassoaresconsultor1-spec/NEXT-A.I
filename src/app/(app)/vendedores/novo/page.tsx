import type { Metadata } from "next";
import Link from "next/link";
import Form from "next/form";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can, canManageRank } from "@/server/authz/guard";
import { memberFiltersSchema } from "@/server/members/schemas";
import { listMembers } from "@/server/members/service";
import { storeFiltersSchema } from "@/server/stores/schemas";
import { listStores } from "@/server/stores/service";
import { SalespersonCreateForm } from "../salesperson-create-form";

export const metadata: Metadata = { title: "Novo vendedor" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

async function allStorePages(fetchPage: (page: number) => Promise<{ rows: { id: string; code: string; name: string }[]; pageCount: number }>) {
  const first = await fetchPage(1);
  if (first.pageCount < 2) return first.rows;
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.rows, ...rest.flatMap((result) => result.rows)];
}

export default async function NewSalespersonPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "members.read") || !can(context, "salespeople.manage") || !can(context, "stores.read")) return <AccessDenied />;
  const raw = await searchParams;
  const memberFilters = memberFiltersSchema.parse({ status: "active", q: one(raw.q), page: one(raw.page) });
  const [members, stores] = await Promise.all([
    listMembers(context, memberFilters),
    allStorePages((page) => listStores(context, storeFiltersSchema.parse({ page }))),
  ]);
  const candidates = members.rows
    .filter((member) => canManageRank(context, member.role.rank))
    .map((member) => ({ id: member.membershipId, name: member.name, scope: member.storeAccess === "all" ? "Todas as lojas" : member.scopeNames.length ? member.scopeNames.join(", ") : "Escopo de lojas" }));
  const storeOptions = stores.map(({ id, code, name }) => ({ id, label: `${code} · ${name}` }));

  return <>
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Vendedores", href: "/vendedores" }, { label: "Novo vendedor" }]} />
    <PageHeader title="Novo vendedor" description="Associe um membro ativo a uma ou mais lojas acessíveis." />
    <Card className="space-y-3 p-5">
      <h2 className="text-sm font-semibold">Localizar membro ativo</h2>
      <Form action="/vendedores/novo" role="search" aria-label="Buscar membro da equipe" className="flex flex-wrap items-end gap-3">
        <Field label="Buscar por nome ou e-mail" className="min-w-56 flex-1">{(props) => <Input {...props} type="search" name="q" defaultValue={memberFilters.q ?? ""} maxLength={80} />}</Field>
        <Button type="submit" variant="secondary">Buscar</Button>
        {memberFilters.q ? <Link href="/vendedores/novo" className="self-center text-sm text-ink-soft underline">Limpar</Link> : null}
      </Form>
      <nav aria-label="Páginas de membros" className="flex items-center justify-between text-sm text-ink-muted">
        <span>{members.total} membros ativos · página {members.page} de {members.pageCount}</span>
        <span className="flex gap-3">
          {members.page > 1 ? <Link href={`/vendedores/novo?${new URLSearchParams({ q: memberFilters.q ?? "", page: String(members.page - 1) })}`} className="underline">Anterior</Link> : null}
          {members.page < members.pageCount ? <Link href={`/vendedores/novo?${new URLSearchParams({ q: memberFilters.q ?? "", page: String(members.page + 1) })}`} className="underline">Próxima</Link> : null}
        </span>
      </nav>
    </Card>
    <SalespersonCreateForm candidates={candidates} stores={storeOptions} />
  </>;
}

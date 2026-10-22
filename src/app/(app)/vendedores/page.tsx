import { Plus, SearchX, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { PAGE_SIZE } from "@/server/pagination";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { salespeopleFiltersSchema } from "@/server/salespeople/schemas";
import { listSalespeople } from "@/server/salespeople/service";
import { storeFiltersSchema } from "@/server/stores/schemas";
import { listStores } from "@/server/stores/service";
import { SalespeopleManager, type SalespersonRow } from "./salespeople-manager";

export const metadata: Metadata = { title: "Vendedores" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

async function allPages<T>(fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number }>) {
  const first = await fetchPage(1);
  if (first.pageCount < 2) return first.rows;
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.rows, ...rest.flatMap((result) => result.rows)];
}

export default async function SalespeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "members.read") || !can(context, "salespeople.manage")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = salespeopleFiltersSchema.parse({ storeId: one(raw.store), status: one(raw.status), page: one(raw.page) });
  const query = (one(raw.q) ?? "").trim().slice(0, 80);
  const filtersOnly = { storeId: filters.storeId, status: filters.status };
  const [result, stores] = await Promise.all([
    query
      ? allPages((page) => listSalespeople(context, { ...filtersOnly, page })).then((rows) => ({ rows, total: rows.length }))
      : listSalespeople(context, filters),
    can(context, "stores.read")
      ? allPages((page) => listStores(context, storeFiltersSchema.parse({ page })))
      : Promise.resolve([]),
  ]);
  const matching = query
    ? result.rows.filter((row) => [row.code, row.nickname, row.name].some((value) => value.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))))
    : result.rows;
  const total = query ? matching.length : result.total;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = query ? Math.min(filters.page, pageCount) : filters.page;
  const visibleRows = query ? matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : result.rows;
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const managerRows: SalespersonRow[] = visibleRows.map((row) => ({
    ...row,
    stores: row.storeIds.map((id) => ({ id, name: storeNames.get(id) ?? "Loja" })),
  }));
  const storeOptions = can(context, "stores.read") ? stores.map(({ id, code, name }) => ({ id, label: `${code} · ${name}` })) : null;
  const filtered = Boolean(query || filters.storeId || filters.status);
  const monthParts = new Intl.DateTimeFormat("en", { timeZone: context.organization.timezone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const defaultMonth = `${monthParts.find((part) => part.type === "year")?.value ?? "2026"}-${monthParts.find((part) => part.type === "month")?.value ?? "01"}`;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Vendedores" }]} />
      <PageHeader title="Vendedores" description="Vincule vendedores à equipe e às lojas, e mantenha suas escalas mensais." actions={can(context, "stores.read") ? <LinkButton href="/vendedores/novo"><Plus className="size-4" aria-hidden /> Novo vendedor</LinkButton> : undefined} />
      <Card>
        <Form action="/vendedores" role="search" aria-label="Filtrar vendedores" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4">
          <label className="min-w-56 flex-[2] space-y-1.5 text-sm font-medium">Buscar por código ou nome
            <input type="search" name="q" defaultValue={query} maxLength={80} placeholder="Código ou nome" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 font-normal focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25" />
          </label>
          {storeOptions ? <label className="min-w-48 flex-1 space-y-1.5 text-sm font-medium">Loja
            <select name="store" defaultValue={filters.storeId ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 font-normal">
              <option value="">Todas</option>{storeOptions.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}
            </select>
          </label> : null}
          <label className="min-w-36 flex-1 space-y-1.5 text-sm font-medium">Situação
            <select name="status" defaultValue={filters.status ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 font-normal">
              <option value="">Todas</option><option value="active">Ativos</option><option value="inactive">Inativos</option>
            </select>
          </label>
          <button className="h-10 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-canvas" type="submit">Filtrar</button>
          {filtered ? <LinkButton href="/vendedores" variant="ghost">Limpar filtros</LinkButton> : null}
        </Form>
        {managerRows.length === 0 ? (
          <EmptyState icon={filtered ? SearchX : UsersRound} title={filtered ? "Nenhum vendedor encontrado." : "Nenhum vendedor cadastrado."} description={filtered ? "Ajuste a busca ou os filtros para ver outros vendedores." : "Cadastre vendedores para vinculá-los à equipe e às lojas."} action={!filtered && can(context, "stores.read") ? <LinkButton href="/vendedores/novo"><Plus className="size-4" aria-hidden /> Novo vendedor</LinkButton> : undefined} />
        ) : (
          <>
            <Table caption="Vendedores cadastrados"><thead><tr><Th>Código</Th><Th>Vendedor</Th><Th>Lojas</Th><Th>Situação</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
              <tbody>{managerRows.map((row) => <Tr key={row.id}>
                <Td className="font-mono text-xs text-ink-soft">{row.code}</Td><Td><span className="font-medium">{row.nickname}</span><span className="block text-xs text-ink-muted">{row.name}</span></Td>
                <Td className="text-ink-soft">{row.stores.length ? row.stores.map((store) => store.name).join(", ") : "Sem lojas visíveis"}</Td>
                <Td><Badge tone={row.isActive ? "positive" : "neutral"}>{row.isActive ? "Ativo" : "Inativo"}</Badge></Td>
                <Td><SalespeopleManager row={row} stores={storeOptions ?? []} defaultMonth={defaultMonth} /></Td>
              </Tr>)}</tbody>
            </Table>
            <Pagination page={page} pageCount={pageCount} total={total} basePath="/vendedores" params={{ q: query || undefined, store: filters.storeId, status: filters.status }} />
          </>
        )}
      </Card>
    </>
  );
}

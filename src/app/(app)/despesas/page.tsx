import type { Metadata } from "next";
import Form from "next/form";
import { List } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr, Pagination } from "@/components/ui/table";
import { formatCurrencyCents } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listExpenses, listCategories } from "@/server/expenses/service";
import { expenseFiltersSchema, EXPENSE_STATUS_LABELS, type ExpenseFilters } from "@/server/expenses/schemas";
import { listStoreOptions } from "@/server/stores/options";
import { ExpenseActions } from "./despesa-actions";

export const metadata: Metadata = { title: "Despesas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "expenses.read")) return <AccessDenied />;
  const raw = await searchParams;
  const parsedFilters = expenseFiltersSchema.safeParse({
    from: one(raw.de) ?? "",
    to: one(raw.ate) ?? "",
    storeId: one(raw.loja),
    categoryId: one(raw.categoria),
    status: one(raw.situacao),
    page: one(raw.pagina),
  });
  const filters: ExpenseFilters = parsedFilters.success ? (parsedFilters.data as ExpenseFilters) : { from: "", to: "" };
  const [expensesResult, stores, categories] = await Promise.all([
    listExpenses(context, filters),
    can(context, "stores.read") ? listStoreOptions(context) : Promise.resolve([]),
    listCategories(context),
  ]);
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const canManage = can(context, "expenses.manage");

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Despesas" }]} />
      <PageHeader title="Despesas" description="Consulte, crie, pague e cancele despesas das lojas por competência." actions={canManage ? <LinkButton href="/despesas/novo">Nova despesa</LinkButton> : undefined} />

      <Card>
        <CardHeader title="Filtrar despesas" />
        <CardBody>
          <Form action="/despesas" role="search" aria-label="Filtrar despesas" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4">
            <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">De
              <input type="date" name="de" defaultValue={filters.from} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />
            </label>
            <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">Até
              <input type="date" name="ate" defaultValue={filters.to} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />
            </label>
            {stores.length > 1 ? (
              <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">Loja
                <select name="loja" defaultValue={filters.storeId ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                  <option value="">Todas</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </label>
            ) : null}
            {categories.length > 1 ? (
              <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">Categoria
                <select name="categoria" defaultValue={filters.categoryId ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                  <option value="">Todas</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
            ) : null}
            <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">Situação
              <select name="situacao" defaultValue={filters.status ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">
                <option value="">Todas</option>{Object.entries(EXPENSE_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-canvas" type="submit">Filtrar</button>
            {(filters.from || filters.to || filters.storeId || filters.categoryId || filters.status) ? <LinkButton href="/despesas" variant="ghost">Limpar filtros</LinkButton> : null}
          </Form>
        </CardBody>
      </Card>

      {expensesResult.rows.length === 0 ? (
        <EmptyState icon={List} title="Nenhuma despesa encontrada." description="Ajuste os filtros ou cadastre uma nova despesa." action={canManage ? <LinkButton href="/despesas/novo">Nova despesa</LinkButton> : undefined} />
      ) : (
        <Card>
          <CardBody>
            <Table caption="Despesas do período"><thead><tr><Th>Loja</Th><Th>Categoria</Th><Th>Competência</Th><Th>Descrição</Th><Th>Valor</Th><Th>Situação</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
              <tbody>{expensesResult.rows.map((row) => {
                const status = row.status as keyof typeof EXPENSE_STATUS_LABELS;
                return <Tr key={row.id}>
                  <Td>{storeNames.get(row.storeId) ?? "Loja"}</Td>
                  <Td>{categoryNames.get(row.categoryId) ?? "Categoria"}</Td>
                  <Td className="font-mono text-xs text-ink-soft">{row.competenceDate}</Td>
                  <Td>{row.description}</Td>
                  <Td className="tabular-nums">{formatCurrencyCents(row.amountCents)}</Td>
                  <Td><Badge tone={status === "paid" ? "positive" : status === "cancelled" ? "critical" : "attention"}>{EXPENSE_STATUS_LABELS[status]}</Badge></Td>
                  <Td><ExpenseActions expenseId={row.id} status={status} /></Td>
                </Tr>;
              })}</tbody>
            </Table>
            <Pagination page={expensesResult.page} pageCount={expensesResult.pageCount} total={expensesResult.total} basePath="/despesas" params={{ de: filters.from, ate: filters.to, loja: filters.storeId, categoria: filters.categoryId, situacao: filters.status }} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody>
          <DetailList items={[{ label: "Total do período (não canceladas)", value: formatCurrencyCents(expensesResult.totalCents) }]} />
        </CardBody>
      </Card>
    </>
  );
}

import type { Metadata } from "next";
import Form from "next/form";
import { Scale, List } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr, Pagination } from "@/components/ui/table";
import { formatCurrencyCents } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listRules } from "@/server/commissions/rules";
import { listStatements } from "@/server/commissions/statements";
import { statementFiltersSchema, STATEMENT_STATUS_LABELS, type StatementStatus, type StatementFilters } from "@/server/commissions/schemas";
import { listStoreOptions } from "@/server/stores/options";
import { listSalespeople } from "@/server/salespeople/service";
import { salespeopleFiltersSchema } from "@/server/salespeople/schemas";
import { StatementActions } from "./statement-actions";

export const metadata: Metadata = { title: "Comissões" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

async function allPages<T>(fetchPage: (page: number) => Promise<{ rows: T[]; pageCount: number }>) {
  const first = await fetchPage(1);
  if (first.pageCount < 2) return first.rows;
  const rest = await Promise.all(Array.from({ length: first.pageCount - 1 }, (_, index) => fetchPage(index + 2)));
  return [...first.rows, ...rest.flatMap((result) => result.rows)];
}

export default async function CommissionsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "commissions.read")) return <AccessDenied />;
  const raw = await searchParams;
  const parsedFilters = statementFiltersSchema.safeParse({ month: one(raw.mes) ?? new Date().toISOString().slice(0, 7), storeId: one(raw.loja), status: one(raw.situacao), page: one(raw.pagina) });
  const { month, storeId: filterStoreId, status: filterStatus, page: filterPage } = parsedFilters.success ? (parsedFilters.data as { month: string; storeId?: string; status?: string; page: number }) : { month: new Date().toISOString().slice(0, 7) };
  const filters = { month, storeId: filterStoreId, status: filterStatus, page: filterPage };
  const [statements, allStores, salespeople, rules] = await Promise.all([
    listStatements(context, filters as StatementFilters),
    can(context, "stores.read") ? listStoreOptions(context) : Promise.resolve([]),
    can(context, "members.read") ? allPages((page) => listSalespeople(context, salespeopleFiltersSchema.parse({ page }))) : Promise.resolve([]),
    listRules(context),
  ]);
  const storeNames = new Map(allStores.map((store) => [store.id, store.name]));
  const peopleNames = new Map(salespeople.map((person) => [person.id, person.nickname || person.name]));
  const canManage = can(context, "commissions.manage");
  const canApprove = can(context, "commissions.approve");
  const canPay = can(context, "commissions.pay");

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Comissões" }]} />
      <PageHeader title="Comissões" description="Regras de apuração, estimativa e apuração mensal de comissões por vendedor." />

      <Card>
        <CardHeader title="Regras de comissão" description="Regras versionadas com taxa padrão e taxas por categoria, vigentes por data da loja." actions={canManage ? <LinkButton href="/comissoes/nova">Nova regra</LinkButton> : undefined} />
        <CardBody>
          {rules.length === 0 ? (
            <EmptyState icon={Scale} title="Nenhuma regra de comissão cadastrada." description="Crie a primeira regra para definir as taxas de apuração." action={canManage ? <LinkButton href="/comissoes/nova">Nova regra</LinkButton> : undefined} />
          ) : (
            <Table caption="Regras de comissão vigentes"><thead><tr><Th>Vigência</Th><Th>Loja</Th><Th>Taxa padrão</Th><Th>Taxas por categoria</Th><Th>Versão</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
              <tbody>{rules.map((rule) => <Tr key={rule.id}>
                <Td>{rule.effectiveFrom}</Td>
                <Td>{rule.storeId ? storeNames.get(rule.storeId) ?? "Loja" : "Empresa"}</Td>
                <Td className="tabular-nums">{rule.defaultRateBps / 100}%</Td>
                <Td className="tabular-nums">{rule.rates.length ? rule.rates.map((rate) => `${rate.rateBps / 100}%`).join(", ") : "—"}</Td>
                <Td>v{rule.version}</Td><Td></Td>
              </Tr>)}</tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Apurações" description="Calcule, aprove, registre pagamento ou cancele apurações mensais de comissão." />
        <CardBody>
          <Form action="/comissoes" role="search" aria-label="Filtrar apurações" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-4">
            <label className="min-w-48 flex-[2] space-y-1.5 text-sm font-medium">Mês
              <input type="month" name="mes" defaultValue={filters.month} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3" />
            </label>
            {allStores.length > 1 ? <label className="min-w-48 flex-1 space-y-1.5 text-sm font-medium">Loja
              <select name="loja" defaultValue={filters.storeId ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3">
                <option value="">Todas</option>{allStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label> : null}
            <label className="min-w-40 flex-1 space-y-1.5 text-sm font-medium">Situação
              <select name="situacao" defaultValue={filters.status ?? ""} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3">
                <option value="">Todas</option>{Object.entries(STATEMENT_STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
              </select>
            </label>
            <button className="h-10 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-canvas" type="submit">Filtrar</button>
          </Form>

          {statements.rows.length === 0 ? (
            <EmptyState icon={List} title="Nenhuma apuração encontrada." description="Calcule uma apuração para um vendedor, loja e mês encerrados." />
          ) : (
            <>
              <Table caption="Apurações de comissão"><thead><tr><Th>Vendedor</Th><Th>Loja</Th><Th>Mês</Th><Th>Situação</Th><Th>Base</Th><Th>Comissão</Th><Th><span className="sr-only">Ações</span></Th></tr></thead>
                <tbody>{statements.rows.map((row) => {
                  const status = row.status as StatementStatus;
                  return <Tr key={row.id}>
                    <Td><span className="font-medium">{peopleNames.get(row.salespersonId) ?? "Vendedor"}</span></Td>
                    <Td>{storeNames.get(row.storeId) ?? "Loja"}</Td>
                    <Td className="font-mono text-xs text-ink-soft">{row.month}</Td>
                    <Td><Badge tone={status === "paid" ? "positive" : status === "cancelled" ? "critical" : status === "approved" ? "brand" : "neutral"}>{STATEMENT_STATUS_LABELS[status]}</Badge></Td>
                    <Td className="tabular-nums">{formatCurrencyCents(row.baseCents)}</Td>
                    <Td className="tabular-nums font-medium">{formatCurrencyCents(row.commissionCents)}</Td>
                    <Td><StatementActions statementId={row.id} status={status} canApprove={canApprove} canPay={canPay} canCancel={canManage} /></Td>
                  </Tr>;
                })}</tbody>
              </Table>
              <Pagination page={statements.page} pageCount={statements.pageCount} total={statements.total} basePath="/comissoes" params={{ mes: filters.month, loja: filters.storeId, situacao: filters.status }} />
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}

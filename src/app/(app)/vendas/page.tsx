import { PackageX, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { listSales } from "@/server/sales/queries";
import { PAYMENT_METHOD_LABELS, SALE_STATUS_LABELS, type PaymentMethod } from "@/server/sales/schemas";
import { listStoreOptions } from "@/server/stores/options";
import { SaleFilters, STATUS_PARAMS, STATUS_TONES, statusToParam } from "./sale-filters";

export const metadata: Metadata = { title: "Histórico de vendas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

const methodLabels = (methods: string[]) =>
  methods.map((method) => PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method).join(" + ") || "—";

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "sales.read") && !can(context, "sales.create")) return <AccessDenied />;
  const raw = await searchParams;
  const situacao = single(raw.situacao) ?? "";
  const filters = {
    storeId: single(raw.loja),
    status: STATUS_PARAMS[situacao],
    number: single(raw.numero),
    from: single(raw.de),
    to: single(raw.ate),
    page: single(raw.page),
  };
  // Without sales.read the service returns only the member's own sales.
  const ownOnly = !can(context, "sales.read");
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Histórico de vendas" }]} />
      <PageHeader title="Histórico de vendas" description={ownOnly ? "Suas vendas" : "Vendas das lojas do seu acesso"} />
    </>
  );

  let result: Awaited<ReturnType<typeof listSales>>;
  try {
    result = await listSales(context, filters);
  } catch (error) {
    if (isDomainError(error) && error.code === "limit") {
      return (
        <>
          {header}
          <Card>
            <EmptyState icon={PackageX} title="Vendas indisponíveis no plano" description={error.message} />
          </Card>
        </>
      );
    }
    throw error;
  }
  const stores = await listStoreOptions(context, { includeInactive: true });
  const values = {
    loja: filters.storeId && stores.some((store) => store.id === filters.storeId) ? filters.storeId : "",
    situacao: statusToParam(filters.status),
    numero: /^\d+$/.test(filters.number ?? "") ? (filters.number ?? "") : "",
    de: /^\d{4}-\d{2}-\d{2}$/.test(filters.from ?? "") ? (filters.from ?? "") : "",
    ate: /^\d{4}-\d{2}-\d{2}$/.test(filters.to ?? "") ? (filters.to ?? "") : "",
  };
  const hasFilter = Object.values(values).some((value) => value !== "");
  const tz = context.organization.timezone;

  return (
    <>
      {header}
      <Card>
        {result.rows.length > 0 || hasFilter ? (
          <SaleFilters key={Object.values(values).join("|")} values={values} stores={stores.map(({ id, code, name }) => ({ id, code, name }))} />
        ) : null}
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={hasFilter ? "Nenhuma venda encontrada" : "Nenhuma venda registrada"}
            description={hasFilter ? "Altere os filtros para ver as demais vendas." : undefined}
            action={
              hasFilter ? (
                <LinkButton href="/vendas" variant="secondary">
                  Ver todas
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Vendas">
                <thead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Data e hora</Th>
                    <Th>Loja</Th>
                    <Th>Operador</Th>
                    <Th>Cliente</Th>
                    <Th className="text-right">Itens</Th>
                    <Th>Pagamento</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Situação</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((sale) => (
                    <Tr key={sale.id}>
                      <Td className="font-medium tabular-nums">
                        <Link
                          href={`/vendas/${sale.id}`}
                          className="text-brand-strong hover:underline"
                          aria-label={sale.number === null ? "Abrir venda sem número" : `Abrir venda nº ${sale.number}`}
                        >
                          {sale.number ?? "—"}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft">{sale.completedAt ? formatDateTime(sale.completedAt, tz) : "—"}</Td>
                      <Td className="text-ink-soft">{sale.storeName}</Td>
                      <Td className="text-ink-soft">{sale.operatorName}</Td>
                      <Td className="text-ink-soft">{sale.customerName ?? "—"}</Td>
                      <Td className="text-right tabular-nums">{formatInteger(sale.itemCount)}</Td>
                      <Td className="text-ink-soft">{methodLabels(sale.paymentMethods)}</Td>
                      <Td className="text-right tabular-nums">{formatCurrencyCents(sale.totalCents)}</Td>
                      <Td>
                        <Badge tone={STATUS_TONES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/vendas"
              params={{ loja: values.loja || undefined, situacao: values.situacao || undefined, numero: values.numero || undefined, de: values.de || undefined, ate: values.ate || undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}

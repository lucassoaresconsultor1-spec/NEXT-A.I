import { ClipboardList, Plus } from "lucide-react";
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
import { listCatalogOptions } from "@/server/catalog/options";
import { PURCHASE_ORDER_STATUS_LABELS, purchaseOrderFiltersSchema } from "@/server/purchasing/schemas";
import { listPurchaseOrders } from "@/server/purchasing/service";
import { listStoreOptions } from "@/server/stores/options";
import { formatCalendarDate, PurchaseFilters, STATUS_TONES } from "./purchase-filters";

export const metadata: Metadata = { title: "Compras" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function NewOrderButton() {
  return (
    <LinkButton href="/compras/novo">
      <Plus className="size-4" aria-hidden /> Novo pedido
    </LinkButton>
  );
}

export default async function PurchasesPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "purchases.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = purchaseOrderFiltersSchema.parse({
    status: single(raw.situacao),
    storeId: single(raw.loja),
    supplierId: single(raw.fornecedor),
    number: single(raw.numero),
    page: single(raw.page),
  });
  const canCreate = can(context, "purchases.manage") && can(context, "catalog.costs.read");
  const [result, stores, options] = await Promise.all([
    listPurchaseOrders(context, filters),
    listStoreOptions(context, { includeInactive: true }),
    can(context, "catalog.read") ? listCatalogOptions(context) : Promise.resolve({ suppliers: [] }),
  ]);
  const values = {
    situacao: filters.status ?? "",
    loja: filters.storeId ?? "",
    fornecedor: filters.supplierId ?? "",
    numero: filters.number ? String(filters.number) : "",
  };
  const hasFilter = Object.values(values).some((value) => value !== "");
  // The service omits totals without catalog.costs.read; the column only exists when they come back.
  const showTotal = result.rows.some((row) => "totalCents" in row);
  const tz = context.organization.timezone;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Compras" }]} />
      <PageHeader
        title="Compras"
        description="Pedidos de compra das lojas do seu acesso. O recebimento lança as entradas no estoque e o custo de reposição."
        actions={canCreate ? <NewOrderButton /> : undefined}
      />
      <Card>
        {result.rows.length > 0 || hasFilter ? (
          <PurchaseFilters
            key={Object.values(values).join("|")}
            values={values}
            stores={stores.map(({ id, code, name }) => ({ id, code, name }))}
            suppliers={options.suppliers.map(({ id, name }) => ({ id, name }))}
          />
        ) : null}
        {result.rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum pedido encontrado"
              description="Altere os filtros para ver os demais pedidos."
              action={
                <LinkButton href="/compras" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Nenhum pedido de compra"
              description={canCreate ? "Crie um pedido para registrar o recebimento das mercadorias com o custo de reposição." : undefined}
              action={canCreate ? <NewOrderButton /> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Pedidos de compra">
                <thead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Loja</Th>
                    <Th>Fornecedor</Th>
                    <Th>Previsão</Th>
                    <Th className="text-right">Itens</Th>
                    {showTotal ? <Th className="text-right">Total</Th> : null}
                    <Th>Situação</Th>
                    <Th>Criado em</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((order) => (
                    <Tr key={order.id}>
                      <Td className="font-medium tabular-nums">
                        <Link href={`/compras/${order.id}`} className="text-brand-strong hover:underline" aria-label={`Abrir pedido nº ${order.number}`}>
                          {order.number}
                        </Link>
                      </Td>
                      <Td className="text-ink-soft">{order.storeName}</Td>
                      <Td className="text-ink-soft">{order.supplierName}</Td>
                      <Td className="whitespace-nowrap text-ink-soft">{formatCalendarDate(order.expectedDate)}</Td>
                      <Td className="text-right tabular-nums">{formatInteger(order.itemCount)}</Td>
                      {showTotal ? (
                        <Td className="text-right tabular-nums">{"totalCents" in order && typeof order.totalCents === "number" ? formatCurrencyCents(order.totalCents) : "—"}</Td>
                      ) : null}
                      <Td>
                        <Badge tone={STATUS_TONES[order.status]}>{PURCHASE_ORDER_STATUS_LABELS[order.status]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(order.createdAt, tz)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/compras"
              params={{
                situacao: filters.status,
                loja: filters.storeId,
                fornecedor: filters.supplierId,
                numero: filters.number ? String(filters.number) : undefined,
              }}
            />
          </>
        )}
      </Card>
    </>
  );
}

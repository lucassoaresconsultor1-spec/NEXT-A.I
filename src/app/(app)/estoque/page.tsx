import { ArrowLeftRight, Boxes, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/quantity-format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { balanceFiltersSchema } from "@/server/inventory/schemas";
import { listBalances } from "@/server/inventory/service";
import { listStoreOptions } from "@/server/stores/options";
import { InventoryUnavailable, withInventoryPlan } from "./feature-guard";
import { StockFilters } from "./stock-filters";

export const metadata: Metadata = { title: "Estoque" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

// Quantities come from the service as numeric strings ("0.000").
const isZero = (value: string) => /^-?0+(\.0+)?$/.test(value);

function NewMovementButton() {
  return (
    <LinkButton href="/estoque/lancar">
      <Plus className="size-4" aria-hidden /> Lançar movimentação
    </LinkButton>
  );
}

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = balanceFiltersSchema.parse({ storeId: single(raw.loja), q: single(raw.q), page: single(raw.page) });
  const canManage = can(context, "inventory.manage");
  const loaded = await withInventoryPlan(() => listBalances(context, filters));
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Estoque" }]} />
      <PageHeader
        title="Estoque"
        description="Saldos das lojas do seu acesso, calculados pelo livro de movimentações."
        actions={
          <>
            <LinkButton href="/estoque/movimentacoes" variant="secondary">
              <ArrowLeftRight className="size-4" aria-hidden /> Movimentações
            </LinkButton>
            {canManage ? <NewMovementButton /> : null}
          </>
        }
      />
    </>
  );
  if ("unavailable" in loaded) {
    return (
      <>
        {header}
        <InventoryUnavailable message={loaded.unavailable} />
      </>
    );
  }
  const result = loaded.data;
  const stores = await listStoreOptions(context, { includeInactive: true });
  const values = { loja: filters.storeId ?? "", q: filters.q ?? "" };
  const hasFilter = Boolean(values.loja || values.q);
  const tz = context.organization.timezone;

  return (
    <>
      {header}
      <Card>
        {result.rows.length > 0 || hasFilter ? <StockFilters key={`${values.loja}|${values.q}`} values={values} stores={stores} /> : null}
        {result.rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={Boxes}
              title="Nenhum item encontrado"
              description="Altere a loja ou a busca."
              action={
                <LinkButton href="/estoque" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="Nenhum saldo registrado"
              description="Os saldos aparecem depois da primeira entrada de estoque."
              action={canManage ? <NewMovementButton /> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Saldos de estoque">
                <thead>
                  <tr>
                    <Th>Produto</Th>
                    <Th>Loja</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">Reservado</Th>
                    <Th className="text-right">Em trânsito</Th>
                    <Th className="text-right">Disponível</Th>
                    <Th>Atualizado em</Th>
                    <Th className="text-right">Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <Tr key={`${row.storeId}-${row.variantId}`}>
                      <Td>
                        <span className="font-medium">{row.productName}</span>
                        <span className="block text-xs text-ink-muted">
                          {row.variantName} · {row.sku}
                        </span>
                      </Td>
                      <Td className="text-ink-soft">
                        {row.storeCode} · {row.storeName}
                      </Td>
                      <Td className={`text-right tabular-nums ${isZero(row.quantity) ? "text-ink-muted" : ""}`}>
                        {formatQuantity(row.quantity, row.unit)}
                      </Td>
                      <Td className={`text-right tabular-nums ${isZero(row.reserved) ? "text-ink-muted" : ""}`}>
                        {formatQuantity(row.reserved, row.unit)}
                      </Td>
                      <Td className={`text-right tabular-nums ${isZero(row.inTransit) ? "text-ink-muted" : ""}`}>
                        {formatQuantity(row.inTransit, row.unit)}
                      </Td>
                      <Td className="text-right font-medium tabular-nums">{formatQuantity(row.available, row.unit)}</Td>
                      <Td className="text-ink-soft">{formatDateTime(row.updatedAt, tz)}</Td>
                      <Td className="text-right">
                        <Link
                          href={`/produtos/${row.productId}`}
                          className="text-sm text-brand-strong hover:underline"
                          aria-label={`Ver produto ${row.productName}`}
                        >
                          Ver produto
                        </Link>
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
              basePath="/estoque"
              params={{ loja: filters.storeId, q: filters.q }}
            />
          </>
        )}
      </Card>
    </>
  );
}

import { ArrowLeftRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/quantity-format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { MOVEMENT_TYPE_LABELS, movementFiltersSchema } from "@/server/inventory/schemas";
import { listMovements } from "@/server/inventory/service";
import { listStoreOptions } from "@/server/stores/options";
import { InventoryUnavailable, withInventoryPlan } from "../feature-guard";
import { MovementFilters } from "./movement-filters";

export const metadata: Metadata = { title: "Movimentações de estoque" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

const TYPE_TONES = { entry: "positive", exit: "neutral", adjustment: "brand", loss: "critical", count: "attention" } as const;

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = movementFiltersSchema.parse({
    storeId: single(raw.loja),
    type: single(raw.tipo),
    from: single(raw.de),
    to: single(raw.ate),
    page: single(raw.page),
  });
  const loaded = await withInventoryPlan(() => listMovements(context, filters));
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Estoque", href: "/estoque" }, { label: "Movimentações" }]} />
      <PageHeader
        title="Movimentações de estoque"
        description="Livro de entradas, saídas, ajustes, perdas e inventários das lojas do seu acesso."
        actions={
          can(context, "inventory.manage") ? (
            <LinkButton href="/estoque/lancar">
              <Plus className="size-4" aria-hidden /> Lançar movimentação
            </LinkButton>
          ) : undefined
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
  const values = { loja: filters.storeId ?? "", tipo: filters.type ?? "", de: filters.from ?? "", ate: filters.to ?? "" };
  const hasFilter = Object.values(values).some((value) => value !== "");
  const tz = context.organization.timezone;

  return (
    <>
      {header}
      <Card>
        {result.rows.length > 0 || hasFilter ? <MovementFilters key={Object.values(values).join("|")} values={values} stores={stores} /> : null}
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={hasFilter ? "Nenhuma movimentação encontrada" : "Nenhuma movimentação registrada"}
            description={hasFilter ? "Altere os filtros para ver as demais movimentações." : "As movimentações aparecem aqui a partir do primeiro lançamento."}
            action={
              hasFilter ? (
                <LinkButton href="/estoque/movimentacoes" variant="secondary">
                  Ver todas
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Movimentações de estoque">
                <thead>
                  <tr>
                    <Th>Data e hora</Th>
                    <Th>Loja</Th>
                    <Th>Produto</Th>
                    <Th>Tipo</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th className="text-right">Saldo após</Th>
                    <Th className="text-right">Contado</Th>
                    <Th>Motivo</Th>
                    <Th>Responsável</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <Tr key={row.id}>
                      <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(row.createdAt, tz)}</Td>
                      <Td className="text-ink-soft">{row.storeName}</Td>
                      <Td>
                        <span className="font-medium">
                          {row.productName} · {row.variantName}
                        </span>
                        <span className="block text-xs text-ink-muted">{row.sku}</span>
                      </Td>
                      <Td>
                        <Badge tone={TYPE_TONES[row.type]}>{MOVEMENT_TYPE_LABELS[row.type]}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{formatQuantity(row.quantity)}</Td>
                      <Td className="text-right tabular-nums">{formatQuantity(row.balanceAfter)}</Td>
                      <Td className="text-right tabular-nums">{row.countedQuantity === null ? "—" : formatQuantity(row.countedQuantity)}</Td>
                      <Td className="min-w-48 text-ink-soft">{row.reason}</Td>
                      <Td className="text-ink-soft">{row.actorName ?? "—"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/estoque/movimentacoes"
              params={{ loja: filters.storeId, tipo: filters.type, de: filters.from, ate: filters.to }}
            />
          </>
        )}
      </Card>
    </>
  );
}

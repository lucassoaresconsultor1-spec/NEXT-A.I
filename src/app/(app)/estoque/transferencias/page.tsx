import { Plus, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listTransfers } from "@/server/inventory/transfer-queries";
import { TRANSFER_STATUS_LABELS, transferFiltersSchema } from "@/server/inventory/transfer-schemas";
import { listStoreOptions } from "@/server/stores/options";
import { InventoryUnavailable, withInventoryPlan } from "../feature-guard";
import { TRANSFER_TONES, TransferFilters } from "./transfer-filters";

export const metadata: Metadata = { title: "Transferências de estoque" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function NewTransferButton() {
  return (
    <LinkButton href="/estoque/transferencias/nova">
      <Plus className="size-4" aria-hidden /> Nova transferência
    </LinkButton>
  );
}

export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = transferFiltersSchema.parse({ status: single(raw.situacao), storeId: single(raw.loja), number: single(raw.numero), page: single(raw.page) });
  const canRequest = can(context, "inventory.transfer.request");
  const loaded = await withInventoryPlan(() => listTransfers(context, filters));
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Estoque", href: "/estoque" }, { label: "Transferências" }]} />
      <PageHeader
        title="Transferências de estoque"
        description="Mercadorias entre as lojas da empresa: a origem aprova e despacha, o destino recebe."
        actions={canRequest ? <NewTransferButton /> : undefined}
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
  const values = { situacao: filters.status ?? "", loja: filters.storeId ?? "", numero: filters.number ? String(filters.number) : "" };
  const hasFilter = Object.values(values).some((value) => value !== "");
  const tz = context.organization.timezone;

  return (
    <>
      {header}
      <Card>
        {result.rows.length > 0 || hasFilter ? (
          <TransferFilters key={Object.values(values).join("|")} values={values} stores={stores.map(({ id, code, name }) => ({ id, code, name }))} />
        ) : null}
        {result.rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={Repeat}
              title="Nenhuma transferência encontrada"
              description="Altere os filtros para ver as demais transferências."
              action={
                <LinkButton href="/estoque/transferencias" variant="secondary">
                  Ver todas
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Repeat}
              title="Nenhuma transferência"
              description={canRequest ? "Solicite mercadorias de outra loja da empresa." : undefined}
              action={canRequest ? <NewTransferButton /> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Transferências de estoque">
                <thead>
                  <tr>
                    <Th>Nº</Th>
                    <Th>Origem</Th>
                    <Th>Destino</Th>
                    <Th className="text-right">Itens</Th>
                    <Th>Situação</Th>
                    <Th>Solicitada em</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((transfer) => (
                    <Tr key={transfer.id}>
                      <Td className="font-medium tabular-nums">
                        <Link
                          href={`/estoque/transferencias/${transfer.id}`}
                          className="text-brand-strong hover:underline"
                          aria-label={`Abrir transferência nº ${transfer.number}`}
                        >
                          {transfer.number}
                        </Link>
                      </Td>
                      <Td className="text-ink-soft">{transfer.originStoreName}</Td>
                      <Td className="text-ink-soft">{transfer.destinationStoreName}</Td>
                      <Td className="text-right tabular-nums">{formatInteger(transfer.itemCount)}</Td>
                      <Td>
                        <Badge tone={TRANSFER_TONES[transfer.status]}>{TRANSFER_STATUS_LABELS[transfer.status]}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(transfer.requestedAt, tz)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/estoque/transferencias"
              params={{ situacao: filters.status, loja: filters.storeId, numero: filters.number ? String(filters.number) : undefined }}
            />
          </>
        )}
      </Card>
    </>
  );
}

import { ClipboardCheck, Plus } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { COUNT_STATUS_LABELS, COUNT_STATUSES, countFiltersSchema } from "@/server/inventory/count-schemas";
import { listCounts } from "@/server/inventory/counts";
import { listStoreOptions } from "@/server/stores/options";
import { InventoryUnavailable, withInventoryPlan } from "../feature-guard";
import { STATUS_TONES } from "./status";

export const metadata: Metadata = { title: "Inventários" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function CountsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read") && !can(context, "inventory.count.record")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = countFiltersSchema.parse({ storeId: single(raw.loja), status: single(raw.situacao), page: single(raw.page) });
  const loaded = await withInventoryPlan(() => listCounts(context, filters));
  const header = (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Estoque", href: "/estoque" }, { label: "Inventários" }]} />
      <PageHeader
        title="Inventários"
        description="Contagens por lote das lojas do seu acesso. A contagem é cega: o saldo do sistema só aparece na revisão."
        actions={
          can(context, "inventory.count.manage") ? (
            <LinkButton href="/estoque/inventarios/novo">
              <Plus className="size-4" aria-hidden /> Novo inventário
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
  const hasFilter = Boolean(filters.storeId || filters.status);
  const tz = context.organization.timezone;

  return (
    <>
      {header}
      <Card>
        {result.rows.length > 0 || hasFilter ? (
          <Form action="/estoque/inventarios" role="search" aria-label="Filtrar inventários" className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
            <div className="space-y-1.5">
              <label htmlFor="filtro-loja" className="block text-sm font-medium text-ink">
                Loja
              </label>
              <Select id="filtro-loja" name="loja" defaultValue={filters.storeId ?? ""} className="w-56">
                <option value="">Todas as lojas do meu acesso</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.code} · {store.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="filtro-situacao" className="block text-sm font-medium text-ink">
                Situação
              </label>
              <Select id="filtro-situacao" name="situacao" defaultValue={filters.status ?? ""} className="w-44">
                <option value="">Todas</option>
                {COUNT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {COUNT_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
            {hasFilter ? (
              <LinkButton href="/estoque/inventarios" variant="ghost">
                Limpar filtros
              </LinkButton>
            ) : null}
          </Form>
        ) : null}
        {result.rows.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={hasFilter ? "Nenhum inventário encontrado" : "Nenhum inventário registrado"}
            description={hasFilter ? "Altere os filtros para ver os demais inventários." : "Abra um inventário para contar o estoque de uma loja."}
          />
        ) : (
          <>
            <Table caption="Inventários">
              <thead>
                <tr>
                  <Th>Nº</Th>
                  <Th>Loja</Th>
                  <Th>Situação</Th>
                  <Th>Aberto em</Th>
                  <Th className="text-right">Contados</Th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link href={`/estoque/inventarios/${row.id}`} className="font-medium text-brand-strong hover:underline">
                        Inventário nº {row.number}
                      </Link>
                    </Td>
                    <Td className="text-ink-soft">{row.storeName}</Td>
                    <Td>
                      <Badge tone={STATUS_TONES[row.status]}>{COUNT_STATUS_LABELS[row.status]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(row.openedAt, tz)}</Td>
                    <Td className="text-right tabular-nums">
                      {formatInteger(row.countedCount)} de {formatInteger(row.itemCount)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              basePath="/estoque/inventarios"
              params={{ loja: filters.storeId, situacao: filters.status }}
            />
          </>
        )}
      </Card>
    </>
  );
}

import { Plus, SearchX, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, SortableTh, Table, Td, Tr } from "@/components/ui/table";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listRegionOptions } from "@/server/regions/service";
import { storeFiltersSchema } from "@/server/stores/schemas";
import { listStores } from "@/server/stores/service";
import { StoreFilters } from "./store-filters";
import { cityState, STORE_STATUS_LABELS, storeStatusTone } from "./store-labels";

export const metadata: Metadata = { title: "Lojas" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

const COLUMNS = [
  { column: "code", label: "Código" },
  { column: "name", label: "Nome" },
  { column: "city", label: "Cidade/UF" },
  { column: "region", label: "Região" },
  { column: "status", label: "Situação" },
] as const;

function firstPageHref(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `/lojas?${query}` : "/lojas";
}

function NewStoreButton() {
  return (
    <LinkButton href="/lojas/nova">
      <Plus className="size-4" aria-hidden /> Nova loja
    </LinkButton>
  );
}

export default async function StoresPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "stores.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = storeFiltersSchema.parse({
    q: single(raw.q),
    status: single(raw.status),
    regionId: single(raw.region),
    sort: single(raw.sort),
    dir: single(raw.dir),
    page: single(raw.page),
  });
  const [result, regionOptions] = await Promise.all([
    listStores(context, filters),
    can(context, "regions.read") ? listRegionOptions(context) : Promise.resolve(null),
  ]);
  const canCreate = can(context, "stores.manage") && context.storeScope.all;
  const params = { q: filters.q, status: filters.status, region: filters.regionId, sort: filters.sort, dir: filters.dir };
  const filtered = Boolean(filters.q || filters.status || filters.regionId);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Lojas" }]} />
      <PageHeader
        title="Lojas"
        description={
          context.storeScope.all
            ? "Cadastre as lojas da empresa, agrupe-as em regiões e controle quais estão em operação."
            : "Lojas do seu escopo de acesso."
        }
        actions={canCreate ? <NewStoreButton /> : undefined}
      />
      <Card>
        <StoreFilters key={JSON.stringify(params)} values={params} regions={regionOptions} />
        {result.rows.length === 0 ? (
          result.total === 0 && !filtered ? (
            <EmptyState
              icon={Store}
              title="Nenhuma loja cadastrada"
              description={
                canCreate
                  ? "Cadastre a primeira loja para começar a organizar a operação."
                  : "Nenhuma loja do seu escopo de acesso foi cadastrada ainda."
              }
              action={canCreate ? <NewStoreButton /> : undefined}
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nenhuma loja encontrada"
              description={result.total > 0 ? "Esta página não tem resultados." : "Ajuste a busca ou os filtros para ver outras lojas."}
              action={
                <LinkButton href={result.total > 0 ? firstPageHref(params) : "/lojas"} variant="secondary">
                  {result.total > 0 ? "Voltar à primeira página" : "Limpar filtros"}
                </LinkButton>
              }
            />
          )
        ) : (
          <>
            <Table caption="Lojas cadastradas">
              <thead>
                <tr>
                  {COLUMNS.map((entry) => (
                    <SortableTh key={entry.column} label={entry.label} column={entry.column} basePath="/lojas" params={params} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((store) => (
                  <Tr key={store.id}>
                    <Td className="font-mono text-xs text-ink-soft">{store.code}</Td>
                    <Td>
                      <Link href={`/lojas/${store.id}`} className="font-medium text-brand hover:underline">
                        {store.name}
                      </Link>
                    </Td>
                    <Td className="text-ink-soft">{cityState(store.city, store.state) ?? "—"}</Td>
                    <Td className="text-ink-soft">{store.regionName ?? "Sem região"}</Td>
                    <Td>
                      <Badge tone={storeStatusTone(store.status)}>{STORE_STATUS_LABELS[store.status]}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/lojas" params={params} />
          </>
        )}
      </Card>
    </>
  );
}

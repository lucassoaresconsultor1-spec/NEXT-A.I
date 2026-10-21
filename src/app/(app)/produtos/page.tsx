import { Package, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { parseStatusParam, statusToParam } from "@/components/catalog/status-param";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { productFiltersSchema } from "@/server/catalog/schemas";
import { listProducts } from "@/server/catalog/service";
import { ProductFilters } from "./product-filters";
import { PRODUCT_UNIT_LABELS } from "./variant-form-data";

export const metadata: Metadata = { title: "Produtos" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function NewProductButton() {
  return (
    <LinkButton href="/produtos/novo">
      <Plus className="size-4" aria-hidden /> Novo produto
    </LinkButton>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = productFiltersSchema.parse({
    q: single(raw.q),
    status: parseStatusParam(raw.situacao),
    categoryId: single(raw.categoria),
    brandId: single(raw.marca),
    supplierId: single(raw.fornecedor),
    page: single(raw.page),
  });
  const [result, options] = await Promise.all([listProducts(context, filters), listCatalogOptions(context)]);
  const canManage = can(context, "catalog.manage") && context.storeScope.all;

  const values = {
    q: filters.q ?? "",
    situacao: statusToParam(filters.status),
    categoria: filters.categoryId ?? "",
    marca: filters.brandId ?? "",
    fornecedor: filters.supplierId ?? "",
  };
  const hasFilter = Object.values(values).some((value) => value !== "");

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Produtos" }]} />
      <PageHeader
        title="Produtos"
        description="Catálogo de produtos da empresa, com variações, preço e código de barras, compartilhado por todas as lojas."
        actions={canManage ? <NewProductButton /> : undefined}
      />
      <Card>
        {result.rows.length > 0 || hasFilter ? <ProductFilters key={Object.values(values).join("|")} values={values} options={options} /> : null}
        {result.rows.length === 0 ? (
          hasFilter ? (
            <EmptyState
              icon={Package}
              title="Nenhum produto encontrado"
              description="Altere a busca ou os filtros para ver os demais produtos."
              action={
                <LinkButton href="/produtos" variant="secondary">
                  Ver todos
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title="Nenhum produto cadastrado"
              description={
                canManage
                  ? "Cadastre o primeiro produto com suas variações, preço e código de barras."
                  : "Os produtos aparecerão aqui quando alguém com permissão cadastrá-los."
              }
              action={canManage ? <NewProductButton /> : undefined}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table caption="Produtos cadastrados">
                <thead>
                  <tr>
                    <Th>Nome</Th>
                    <Th>Categoria</Th>
                    <Th>Marca</Th>
                    <Th>Unidade</Th>
                    <Th className="text-right">Variações</Th>
                    <Th>Situação</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((product) => (
                    <Tr key={product.id}>
                      <Td className="font-medium">
                        <Link href={`/produtos/${product.id}`} className="text-brand-strong hover:underline">
                          {product.name}
                        </Link>
                      </Td>
                      <Td className="text-ink-soft">{product.categoryName ?? "—"}</Td>
                      <Td className="text-ink-soft">{product.brandName ?? "—"}</Td>
                      <Td className="text-ink-soft">{PRODUCT_UNIT_LABELS[product.unit]}</Td>
                      <Td className="text-right tabular-nums">{formatInteger(product.variantCount)}</Td>
                      <Td>
                        <Badge tone={product.isActive ? "positive" : "neutral"}>{product.isActive ? "Ativo" : "Inativo"}</Badge>
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
              basePath="/produtos"
              params={{
                q: filters.q,
                situacao: values.situacao || undefined,
                categoria: filters.categoryId,
                marca: filters.brandId,
                fornecedor: filters.supplierId,
              }}
            />
          </>
        )}
      </Card>
    </>
  );
}

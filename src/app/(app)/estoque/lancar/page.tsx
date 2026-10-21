import { Search } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/form";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { productFiltersSchema } from "@/server/catalog/schemas";
import { getProduct, listProducts } from "@/server/catalog/service";
import { listStoreOptions } from "@/server/stores/options";
import { MovementForm } from "./movement-form";

export const metadata: Metadata = { title: "Lançar movimentação" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

function ProductSearch({ q }: { q: string }) {
  return (
    <Form action="/estoque/lancar" role="search" aria-label="Buscar produto" className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <label htmlFor="busca-produto" className="block text-sm font-medium text-ink">
          Buscar produto
        </label>
        <Input type="search" id="busca-produto" name="q" defaultValue={q} maxLength={80} autoComplete="off" className="w-80 max-w-full" />
      </div>
      <Button type="submit" variant="secondary">
        <Search className="size-4" aria-hidden /> Buscar
      </Button>
    </Form>
  );
}

export default async function LaunchMovementPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.manage")) return <AccessDenied />;
  const raw = await searchParams;
  const q = single(raw.q) ?? "";
  const productId = single(raw.produto);
  const crumbs = (
    <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Estoque", href: "/estoque" }, { label: "Lançar movimentação" }]} />
  );

  if (productId) {
    const product = await getProduct(context, productId);
    if (!product) notFound();
    const stores = await listStoreOptions(context);
    const variants = product.variants.filter((variant) => variant.isActive).map(({ id, name, sku }) => ({ id, name, sku }));
    const defaultStoreId = stores.some((store) => store.id === context.activeStoreId) ? (context.activeStoreId ?? "") : "";
    const back = q ? `/estoque/lancar?q=${encodeURIComponent(q)}` : "/estoque/lancar";
    return (
      <>
        {crumbs}
        <PageHeader
          title="Lançar movimentação"
          description={product.name}
          actions={
            <LinkButton href={back} variant="secondary">
              Escolher outro produto
            </LinkButton>
          }
        />
        <Card>
          <CardHeader title={product.name} description="Entradas, saídas, ajustes, perdas e inventários ficam no livro da loja." />
          <CardBody className="space-y-4">
            {product.isActive ? null : (
              <Notice tone="warning" title="Produto inativo: só saídas, ajustes, perdas e inventários são aceitos." />
            )}
            {stores.length === 0 ? (
              <Notice tone="warning" title="Nenhuma loja ativa no seu acesso." />
            ) : variants.length === 0 ? (
              <Notice tone="warning" title="Este produto não tem variações ativas." />
            ) : (
              <MovementForm
                stores={stores.map(({ id, code, name }) => ({ id, code, name }))}
                variants={variants}
                unit={product.unit}
                defaultStoreId={defaultStoreId}
              />
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  const results = q ? await listProducts(context, productFiltersSchema.parse({ q, status: "active", page: 1 })) : null;
  return (
    <>
      {crumbs}
      <PageHeader title="Lançar movimentação" description="Busque o produto pelo nome, SKU ou código de barras." />
      <Card>
        <CardBody className="space-y-4">
          <ProductSearch q={q} />
          {results === null ? null : results.rows.length === 0 ? (
            <EmptyState icon={Search} title="Nenhum produto encontrado" description="Confira o nome, o SKU ou o código de barras." />
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line" aria-label="Produtos encontrados">
              {results.rows.map((product) => (
                <li key={product.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span>
                    <span className="font-medium text-ink">{product.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {product.variantCount} {product.variantCount === 1 ? "variação" : "variações"}
                    </span>
                  </span>
                  <LinkButton
                    href={`/estoque/lancar?produto=${product.id}&q=${encodeURIComponent(q)}`}
                    variant="secondary"
                    size="sm"
                    aria-label={`Escolher ${product.name}`}
                  >
                    Escolher
                  </LinkButton>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

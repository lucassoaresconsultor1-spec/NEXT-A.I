import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listCatalogOptions } from "@/server/catalog/options";
import { MAX_VARIANTS_PER_PRODUCT } from "@/server/catalog/schemas";
import { getProduct } from "@/server/catalog/service";
import { PRODUCT_UNIT_LABELS } from "../variant-form-data";
import { ProductEditDialog, ProductStatusDialog } from "./product-dialogs";
import { VariantAmountDialog, VariantFormDialog, VariantStatusDialog, type VariantValues } from "./variant-dialogs";

export const metadata: Metadata = { title: "Produto" };

type Params = Promise<{ productId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ProductPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const { productId } = await params;
  const product = await getProduct(context, productId);
  if (!product) notFound();
  const query = await searchParams;
  const canManage = can(context, "catalog.manage") && context.storeScope.all;
  const canSeeCosts = can(context, "catalog.costs.read");
  const canManageCosts = canManage && canSeeCosts;
  const options = canManage
    ? await listCatalogOptions(context, { categoryId: product.categoryId, brandId: product.brandId, supplierId: product.supplierId })
    : null;
  const tz = context.organization.timezone;

  // Only what each member may see reaches the client components (no cost without the permission).
  const variants: VariantValues[] = product.variants.map((variant) => ({
    id: variant.id,
    name: variant.name,
    sku: variant.sku,
    barcode: variant.barcode,
    isActive: variant.isActive,
    priceCents: variant.priceCents,
    ...(canManageCosts && "costCents" in variant ? { costCents: variant.costCents } : {}),
  }));
  const productValues = {
    id: product.id,
    name: product.name,
    description: product.description,
    isActive: product.isActive,
    categoryId: product.categoryId,
    brandId: product.brandId,
    supplierId: product.supplierId,
  };

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Produtos", href: "/produtos" }, { label: product.name }]} />
      <PageHeader
        title={product.name}
        description={PRODUCT_UNIT_LABELS[product.unit]}
        actions={
          canManage && options ? (
            <>
              <ProductEditDialog product={productValues} options={options} />
              <ProductStatusDialog product={productValues} />
            </>
          ) : undefined
        }
      />
      {query.criado === "1" ? <Notice tone="success" title="Produto cadastrado." /> : null}
      <Card>
        <CardHeader title="Dados do produto" actions={<Badge tone={product.isActive ? "positive" : "neutral"}>{product.isActive ? "Ativo" : "Inativo"}</Badge>} />
        <CardBody>
          <DetailList
            items={[
              { label: "Descrição", value: product.description ? <span className="whitespace-pre-line">{product.description}</span> : null },
              { label: "Unidade", value: PRODUCT_UNIT_LABELS[product.unit] },
              { label: "Categoria", value: product.categoryName },
              { label: "Marca", value: product.brandName },
              { label: "Fornecedor", value: product.supplierName },
              { label: "Cadastrado em", value: formatDateTime(product.createdAt, tz) },
              { label: "Atualizado em", value: formatDateTime(product.updatedAt, tz) },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Variações"
          description="Preço único para todas as lojas. Alterações ficam no histórico."
          actions={
            canManage ? (
              <VariantFormDialog productId={product.id} canManageCosts={canManageCosts} disabled={variants.length >= MAX_VARIANTS_PER_PRODUCT} />
            ) : undefined
          }
        />
        <div className="overflow-x-auto">
          <Table caption="Variações do produto">
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>SKU</Th>
                <Th>Código de barras</Th>
                <Th className="text-right">Preço</Th>
                {canSeeCosts ? <Th className="text-right">Custo</Th> : null}
                <Th>Situação</Th>
                <Th className="text-right">Ações</Th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((variant, index) => {
                const values = variants[index];
                const cost = "costCents" in variant ? variant.costCents : null;
                return (
                  <Tr key={variant.id}>
                    <Td className="font-medium">{variant.name}</Td>
                    <Td className="font-mono text-xs">{variant.sku}</Td>
                    <Td className="text-ink-soft">{variant.barcode ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{variant.priceCents === null ? <span className="text-ink-muted">Sem preço</span> : formatCurrencyCents(variant.priceCents)}</Td>
                    {canSeeCosts ? (
                      <Td className="text-right tabular-nums">{cost === null || cost === undefined ? <span className="text-ink-muted">Sem custo</span> : formatCurrencyCents(cost)}</Td>
                    ) : null}
                    <Td>
                      <Badge tone={variant.isActive ? "positive" : "neutral"}>{variant.isActive ? "Ativa" : "Inativa"}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canManage ? (
                          <>
                            <VariantFormDialog productId={product.id} variant={values} />
                            <VariantAmountDialog productId={product.id} variant={values} kind="price" />
                            {canManageCosts ? <VariantAmountDialog productId={product.id} variant={values} kind="cost" /> : null}
                            <VariantStatusDialog productId={product.id} variant={values} />
                          </>
                        ) : null}
                        <Link
                          href={`/produtos/${product.id}/historico?variante=${variant.id}&tipo=preco`}
                          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink-soft hover:bg-canvas hover:text-ink"
                          aria-label={`Ver histórico da variação ${variant.name}`}
                        >
                          <History className="size-4" aria-hidden /> Histórico
                        </Link>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>
    </>
  );
}

import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { listVariantHistory } from "@/server/catalog/pricing";
import { getProduct } from "@/server/catalog/service";
import { parsePage } from "@/server/pagination";

export const metadata: Metadata = { title: "Histórico de preço e custo" };

type Params = Promise<{ productId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function VariantHistoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "catalog.read")) return <AccessDenied />;
  const { productId } = await params;
  const query = await searchParams;
  const kind = single(query.tipo) === "custo" ? "cost" : "price";
  const canSeeCosts = can(context, "catalog.costs.read");
  if (kind === "cost" && !canSeeCosts) return <AccessDenied detail="Seu perfil não tem acesso aos custos dos produtos." />;

  const product = await getProduct(context, productId);
  const variant = product?.variants.find((entry) => entry.id === single(query.variante));
  if (!product || !variant) notFound();
  const page = parsePage(single(query.page));
  const history = await listVariantHistory(context, variant.id, kind, page);
  if (!history) notFound();
  const tz = context.organization.timezone;
  const base = `/produtos/${product.id}/historico`;
  const tabs = [
    { key: "price", label: "Preço", tipo: "preco" },
    ...(canSeeCosts ? [{ key: "cost", label: "Custo", tipo: "custo" }] : []),
  ];

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Painel", href: "/painel" },
          { label: "Produtos", href: "/produtos" },
          { label: product.name, href: `/produtos/${product.id}` },
          { label: "Histórico" },
        ]}
      />
      <PageHeader title={`Histórico: ${variant.name}`} description={`${product.name} · SKU ${variant.sku}`} />
      <nav aria-label="Tipo de histórico" className="flex gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`${base}?variante=${variant.id}&tipo=${tab.tipo}`}
            aria-current={tab.key === kind ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              tab.key === kind ? "bg-brand text-white" : "text-ink-soft hover:bg-canvas hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Card>
        {history.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title={kind === "price" ? "Nenhum preço registrado" : "Nenhum custo registrado"}
            description="Os valores aparecem aqui a partir da primeira definição."
          />
        ) : (
          <>
            <Table caption={kind === "price" ? "Histórico de preços" : "Histórico de custos"}>
              <thead>
                <tr>
                  <Th className="text-right">Valor</Th>
                  <Th>Vigente desde</Th>
                  <Th>Alterado por</Th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="text-right tabular-nums">{formatCurrencyCents(row.cents)}</Td>
                    <Td>{formatDateTime(row.validFrom, tz)}</Td>
                    <Td className="text-ink-soft">{row.createdByName ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={history.page}
              pageCount={history.pageCount}
              total={history.total}
              basePath={base}
              params={{ variante: variant.id, tipo: kind === "price" ? "preco" : "custo" }}
            />
          </>
        )}
      </Card>
    </>
  );
}

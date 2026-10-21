import { PackageX, Printer } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { buttonClasses } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { formatQuantity } from "@/lib/quantity-format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { getSale } from "@/server/sales/queries";
import { PAYMENT_METHOD_LABELS, SALE_STATUS_LABELS, type PaymentMethod } from "@/server/sales/schemas";
import { STATUS_TONES } from "../sale-filters";

export const metadata: Metadata = { title: "Venda" };

type Params = Promise<{ saleId: string }>;

// The sales service exports no labels for these keys; presentation text only.
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  failed: "Falhou",
  cancelled: "Cancelado",
  refunded: "Estornado",
};
const REFUND_KIND_LABELS: Record<string, string> = { cancellation: "Cancelamento", return: "Devolução" };
const REFUND_METHOD_LABELS: Record<string, string> = { original: "Forma original", cash: "Dinheiro", card_external: "Cartão (maquininha)" };

const isZero = (value: string) => /^-?0+(\.0+)?$/.test(value);

export default async function SalePage({ params }: { params: Params }) {
  const context = await requireTenantContext();
  if (!can(context, "sales.read") && !can(context, "sales.create")) return <AccessDenied />;
  const { saleId } = await params;
  let sale: Awaited<ReturnType<typeof getSale>>;
  try {
    sale = await getSale(context, saleId);
  } catch (error) {
    if (isDomainError(error) && error.code === "limit") {
      return (
        <Card>
          <EmptyState icon={PackageX} title="Vendas indisponíveis no plano" description={error.message} />
        </Card>
      );
    }
    throw error;
  }
  if (!sale) notFound();
  const tz = context.organization.timezone;
  const title = sale.number === null ? "Venda suspensa" : `Venda nº ${sale.number}`;
  // The service omits unit costs without catalog.costs.read; the column only exists when they come back.
  const showCost = sale.items.some((item) => "unitCostCents" in item);
  const showReturned = sale.items.some((item) => !isZero(item.returnedQuantity));
  const canReprint = sale.status === "completed" || sale.status === "cancelled";

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Histórico de vendas", href: "/vendas" }, { label: title }]} />
      <PageHeader
        title={title}
        description={sale.storeName}
        actions={
          canReprint ? (
            <a href={`/pdv/comprovante/${sale.id}`} target="_blank" rel="noopener" className={buttonClasses("secondary")}>
              <Printer className="size-4" aria-hidden /> Reimprimir comprovante
            </a>
          ) : undefined
        }
      />
      <Card>
        <CardHeader title="Dados da venda" actions={<Badge tone={STATUS_TONES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>} />
        <CardBody>
          <DetailList
            items={[
              { label: "Loja", value: sale.storeName },
              { label: "Data e hora", value: sale.completedAt ? formatDateTime(sale.completedAt, tz) : sale.suspendedAt ? formatDateTime(sale.suspendedAt, tz) : null },
              { label: "Operador", value: sale.operatorName },
              { label: "Vendedor", value: sale.salespersonName },
              {
                label: "Cliente",
                value: sale.customer ? `${sale.customer.name ?? ""}${sale.customer.document ? ` · ${sale.customer.document}` : ""}` : "Sem cliente identificado",
              },
              { label: "Observação", value: sale.note },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Itens" />
        <div className="overflow-x-auto">
          <Table caption="Itens da venda">
            <thead>
              <tr>
                <Th className="text-right">Linha</Th>
                <Th>Produto</Th>
                <Th className="text-right">Quantidade</Th>
                {showReturned ? <Th className="text-right">Devolvido</Th> : null}
                <Th className="text-right">Preço unitário</Th>
                {showCost ? <Th className="text-right">Custo</Th> : null}
                <Th className="text-right">Desconto</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item) => (
                <Tr key={item.line}>
                  <Td className="text-right tabular-nums">{item.line}</Td>
                  <Td>
                    <span className="font-medium">
                      {item.productName} · {item.variantName}
                    </span>
                    <span className="block text-xs text-ink-muted">{item.sku}</span>
                  </Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantity, item.unit)}</Td>
                  {showReturned ? (
                    <Td className={`text-right tabular-nums ${isZero(item.returnedQuantity) ? "text-ink-muted" : ""}`}>
                      {formatQuantity(item.returnedQuantity, item.unit)}
                    </Td>
                  ) : null}
                  <Td className="text-right tabular-nums">{formatCurrencyCents(item.unitPriceCents)}</Td>
                  {showCost ? (
                    <Td className="text-right tabular-nums">
                      {"unitCostCents" in item && typeof item.unitCostCents === "number" ? formatCurrencyCents(item.unitCostCents) : "—"}
                    </Td>
                  ) : null}
                  <Td className="text-right tabular-nums">{item.discountCents > 0 ? formatCurrencyCents(item.discountCents) : "—"}</Td>
                  <Td className="text-right tabular-nums">{formatCurrencyCents(item.totalCents)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
        <CardBody>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="text-right tabular-nums">{formatCurrencyCents(sale.subtotalCents)}</dd>
            <dt className="text-ink-muted">Desconto</dt>
            <dd className="text-right tabular-nums">{formatCurrencyCents(sale.discountCents)}</dd>
            {sale.surchargeCents > 0 ? (
              <>
                <dt className="text-ink-muted">Acréscimo</dt>
                <dd className="text-right tabular-nums">{formatCurrencyCents(sale.surchargeCents)}</dd>
              </>
            ) : null}
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCurrencyCents(sale.totalCents)}</dd>
            {sale.changeCents > 0 ? (
              <>
                <dt className="text-ink-muted">Troco</dt>
                <dd className="text-right tabular-nums">{formatCurrencyCents(sale.changeCents)}</dd>
              </>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pagamentos" />
        {sale.payments.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-muted">Nenhum pagamento registrado.</p>
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <Table caption="Pagamentos">
              <thead>
                <tr>
                  <Th>Forma</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th className="text-right">Troco</Th>
                  <Th>NSU e bandeira</Th>
                  <Th>Situação</Th>
                </tr>
              </thead>
              <tbody>
                {sale.payments.map((payment, index) => (
                  <Tr key={`${payment.method}-${index}`}>
                    <Td>{PAYMENT_METHOD_LABELS[payment.method as PaymentMethod] ?? payment.method}</Td>
                    <Td className="text-right tabular-nums">{formatCurrencyCents(payment.amountCents)}</Td>
                    <Td className="text-right tabular-nums">{payment.method === "cash" && payment.tenderedCents !== null ? formatCurrencyCents(payment.tenderedCents) : "—"}</Td>
                    <Td className="text-right tabular-nums">{payment.method === "cash" && payment.changeCents ? formatCurrencyCents(payment.changeCents) : "—"}</Td>
                    <Td className="text-ink-soft">{[payment.nsu, payment.brand].filter(Boolean).join(" · ") || "—"}</Td>
                    <Td>{PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>

      {sale.refunds.length > 0 ? (
        <Card>
          <CardHeader title="Cancelamentos e devoluções" />
          <div className="overflow-x-auto">
            <Table caption="Cancelamentos e devoluções">
              <thead>
                <tr>
                  <Th>Data e hora</Th>
                  <Th>Tipo</Th>
                  <Th>Estorno</Th>
                  <Th className="text-right">Valor devolvido</Th>
                  <Th>Motivo</Th>
                  <Th>Responsável</Th>
                </tr>
              </thead>
              <tbody>
                {sale.refunds.map((refund) => (
                  <Tr key={refund.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(refund.createdAt, tz)}</Td>
                    <Td>{REFUND_KIND_LABELS[refund.kind] ?? refund.kind}</Td>
                    <Td>{REFUND_METHOD_LABELS[refund.method] ?? refund.method}</Td>
                    <Td className="text-right tabular-nums">{formatCurrencyCents(refund.amountCents)}</Td>
                    <Td className="text-ink-soft">{refund.reason}</Td>
                    <Td className="text-ink-soft">{refund.createdByName ?? "—"}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      ) : null}
    </>
  );
}

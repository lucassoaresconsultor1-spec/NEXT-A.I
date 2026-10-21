import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/layout";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { getReceipt } from "@/server/sales/receipt";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@/server/sales/schemas";
import { ReceiptPrintButton } from "../../pos-screen";

export const metadata: Metadata = { title: "Comprovante de venda" };

export default async function ReceiptPage({ params }: { params: Promise<{ saleId: string }> }) {
  const context = await requireTenantContext();
  if (!can(context, "sales.create") && !can(context, "sales.read")) return <AccessDenied />;
  const { saleId } = await params;
  const receipt = await getReceipt(context, saleId);
  if (!receipt) notFound();
  return <>
    <div className="no-print mb-4 flex gap-2"><ReceiptPrintButton /><LinkButton href="/pdv" variant="secondary">Voltar ao PDV</LinkButton></div>
    <Card className="receipt mx-auto max-w-sm"><CardBody className="space-y-3 font-mono text-xs">
      {receipt.header ? <p className="text-center font-bold">{receipt.header}</p> : null}
      <header className="space-y-1 text-center"><h1 className="text-base font-bold">{receipt.store.name}</h1>{receipt.store.document ? <p>{receipt.store.document}</p> : null}{receipt.store.address ? <p>{receipt.store.address}</p> : null}<p>Venda nº {receipt.number}</p><p>{formatDateTime(receipt.completedAt, receipt.timezone)}</p></header>
      <p className="border-y border-dashed border-ink py-2 text-center">{receipt.notice}</p>
      <div className="flex justify-between font-bold"><span>Item</span><span>Total</span></div>
      {receipt.items.map((item) => <div key={item.line} className="space-y-0.5 border-b border-dashed border-line py-1"><p>{item.line}. {item.productName} · {item.variantName}</p><p>{item.quantity} {item.unit} × {formatCurrencyCents(item.unitPriceCents)}</p><p className="text-right">{formatCurrencyCents(item.totalCents)}</p></div>)}
      <dl className="space-y-1"><div className="flex justify-between"><dt>Subtotal</dt><dd>{formatCurrencyCents(receipt.subtotalCents)}</dd></div><div className="flex justify-between"><dt>Descontos</dt><dd>{formatCurrencyCents(receipt.discountCents)}</dd></div><div className="flex justify-between"><dt>Acréscimos</dt><dd>{formatCurrencyCents(receipt.surchargeCents)}</dd></div><div className="flex justify-between border-t border-ink pt-1 text-sm font-bold"><dt>Total</dt><dd>{formatCurrencyCents(receipt.totalCents)}</dd></div></dl>
      <div><p className="font-bold">Pagamentos</p>{receipt.payments.map((payment, index) => <p key={index} className="flex justify-between"><span>{PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]}</span><span>{formatCurrencyCents(payment.amountCents)}</span></p>)}</div>
      {receipt.changeCents > 0 ? <p className="flex justify-between"><span>Troco</span><span>{formatCurrencyCents(receipt.changeCents)}</span></p> : null}
      {receipt.customerName ? <p>Cliente: {receipt.customerName}</p> : null}
      {receipt.footer ? <p className="border-t border-dashed border-ink pt-2 text-center">{receipt.footer}</p> : null}
    </CardBody></Card>
    <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } body { background: white !important; } .no-print { display: none !important; } .receipt { max-width: none !important; border: 0 !important; box-shadow: none !important; } main { padding: 0 !important; } }`}</style>
  </>;
}

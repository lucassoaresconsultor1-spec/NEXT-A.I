"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatCurrencyCents } from "@/lib/format";
import { parseBrlToCents } from "@/lib/money";
import type { Cart } from "./cart";

type Payment = { method: "cash" | "card_external"; amount: string; tendered: string; nsu: string; brand: string };
type State = { status?: string; message?: string; fieldErrors?: Record<string, string[]>; pending?: boolean };
const cashRow = (amount = "") => ({ method: "cash" as const, amount, tendered: amount, nsu: "", brand: "" });

export function PaymentDialog({ open, onOpenChange, cart, totalCents, pending, keysReady, note, onNoteChange, onComplete, onVerify }: {
  open: boolean; onOpenChange: (value: boolean) => void; cart: Cart; totalCents: number; pending: boolean; keysReady: boolean; note: string; onNoteChange: (value: string) => void;
  onComplete: (input: Record<string, unknown>) => Promise<State | undefined>; onVerify: () => Promise<void>;
}) {
  const [payments, setPayments] = useState<Payment[]>([cashRow()]);
  const [discount, setDiscount] = useState("");
  const [surcharge, setSurcharge] = useState("");
  const [message, setMessage] = useState("");
  const cents = payments.map((payment) => parseBrlToCents(payment.amount) ?? 0);
  const paid = cents.reduce((sum, value) => sum + value, 0);
  const dueCents = Math.max(0, totalCents - (parseBrlToCents(discount) ?? 0) + (parseBrlToCents(surcharge) ?? 0));
  const canSubmit = paid === dueCents && payments.every((payment, index) => cents[index] > 0 && (payment.method !== "cash" || (parseBrlToCents(payment.tendered) ?? -1) >= cents[index]) && (payment.method !== "card_external" || /^[A-Za-z0-9]{4,20}$/.test(payment.nsu)));
  const cashChangeCents = payments.reduce((sum, payment, index) => payment.method === "cash" ? sum + Math.max(0, (parseBrlToCents(payment.tendered) ?? 0) - cents[index]) : sum, 0);

  function update(index: number, value: Partial<Payment>) { setPayments((rows) => rows.map((row, i) => i === index ? { ...row, ...value } : row)); }
  async function submit() {
    setMessage("");
    const mapped = payments.map((payment) => {
      const amountCents = parseBrlToCents(payment.amount) ?? 0;
      return payment.method === "cash" ? { method: "cash", amountCents, tenderedCents: parseBrlToCents(payment.tendered) ?? 0 } : { method: "card_external", amountCents, nsu: payment.nsu, ...(payment.brand.trim() ? { brand: payment.brand.trim() } : {}) };
    });
    const result = await onComplete({ items: cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity, expectedUnitPriceCents: item.unitPriceCents, discountCents: item.discountCents })), saleDiscountCents: parseBrlToCents(discount) ?? 0, surchargeCents: parseBrlToCents(surcharge) ?? 0, notes: note, payments: mapped });
    if (result?.status === "error") setMessage(result.message ?? "Não foi possível finalizar a venda.");
    else { setPayments([cashRow()]); setDiscount(""); setSurcharge(""); }
  }

  return <Dialog open={open} onOpenChange={onOpenChange} title="Pagamento" description="Confira os valores antes de finalizar.">
    <div className="space-y-4">
      {message ? <Notice tone="error" title={message} /> : null}
      {pending ? <Notice tone="warning" title="Venda pendente de confirmação">Verifique o resultado para evitar uma venda duplicada. <Button onClick={() => void onVerify()}>Verificar</Button></Notice> : null}
      <p className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrencyCents(dueCents)}</span></p>
      <div className="space-y-3">{payments.map((payment, index) => <fieldset key={index} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">Pagamento {index + 1}</legend>
        <Field label="Forma de pagamento">{(field) => <Select {...field} value={payment.method} onChange={(event) => update(index, { method: event.target.value as Payment["method"] })}><option value="cash">Dinheiro</option><option value="card_external">Cartão (maquininha)</option></Select>}</Field>
        <Field label="Valor" hint="Digite em reais, por exemplo 25,00.">{(field) => <Input {...field} inputMode="decimal" value={payment.amount} onChange={(event) => update(index, { amount: event.target.value })} />}</Field>
        {payment.method === "cash" ? <Field label="Recebido em dinheiro">{(field) => <Input {...field} inputMode="decimal" value={payment.tendered} onChange={(event) => update(index, { tendered: event.target.value })} />}</Field> : <>
          <Field label="NSU da maquininha" required>{(field) => <Input {...field} value={payment.nsu} maxLength={20} onChange={(event) => update(index, { nsu: event.target.value })} />}</Field>
          <Field label="Bandeira (opcional)">{(field) => <Input {...field} value={payment.brand} maxLength={30} onChange={(event) => update(index, { brand: event.target.value })} />}</Field>
        </>}
        {payments.length > 1 ? <Button variant="ghost" onClick={() => setPayments((rows) => rows.filter((_, i) => i !== index))}>Remover pagamento</Button> : null}
      </fieldset>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={payments.length >= 10} onClick={() => setPayments((rows) => [...rows, cashRow()])}>Adicionar dinheiro</Button><Button variant="secondary" disabled={payments.length >= 10} onClick={() => setPayments((rows) => [...rows, { ...cashRow(), method: "card_external" }])}>Adicionar cartão</Button></div>
      <div className="flex justify-between text-sm"><span>Pago</span><span>{formatCurrencyCents(paid)}</span></div>
      <div className="flex justify-between text-sm"><span>Troco (dinheiro)</span><span>{formatCurrencyCents(cashChangeCents)}</span></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Desconto da venda" hint="Digite em reais.">{(field) => <Input {...field} id="pdv-discount" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} />}</Field><Field label="Acréscimo" hint="Digite em reais.">{(field) => <Input {...field} inputMode="decimal" value={surcharge} onChange={(event) => setSurcharge(event.target.value)} />}</Field></div>
      <Field label="Observação da venda">{(field) => <Textarea {...field} maxLength={500} value={note} onChange={(event) => onNoteChange(event.target.value)} />}</Field>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!canSubmit || pending || !keysReady} onClick={() => void submit()}>{pending ? "Verifique a venda" : "Finalizar venda"}</Button></div>
    </div>
  </Dialog>;
}

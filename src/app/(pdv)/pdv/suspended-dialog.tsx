"use client";

import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";
import type { Cart } from "./cart";
import { listSuspendedAction, resumeSaleAction } from "./actions";

type Suspended = { id: string; createdAt: string | Date; operatorName: string; customerName: string | null; itemCount: number; estimatedTotalCents: number; note: string | null };
type Props = { open: boolean; onOpenChange: (open: boolean) => void; storeId: string; onResume: (cart: Cart, saleId: string, sale: { customerId: string | null; salespersonUserId: string | null; note: string | null }) => void; onDiscard: (id: string, reason: string) => Promise<ActionState> };

export function SuspendedDialog({ open, onOpenChange, storeId, onResume, onDiscard }: Props) {
  const [rows, setRows] = useState<Suspended[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    const request = Promise.resolve().then(() => {
      if (active) { setLoading(true); setError(""); }
      return listSuspendedAction(storeId);
    });
    void request.then((result) => {
      if (!active) return;
      if (result.status === "error") setError(result.message ?? "Não foi possível carregar as vendas suspensas.");
      else setRows((result.data ?? []) as Suspended[]);
    }).catch(() => { if (active) setError("Não foi possível carregar as vendas suspensas."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, storeId]);

  async function resume(id: string) {
    setBusyId(id); setError("");
    let result;
    try { result = await resumeSaleAction(id); } catch { setError("Não foi possível carregar a venda suspensa."); setBusyId(""); return; }
    if (result.status === "error" || !result.data) setError(result.message ?? "Venda não encontrada.");
    else {
      const sale = result.data as { customerId: string | null; salespersonUserId: string | null; note: string | null; items: { variantId: string; quantity: string; productName: string; variantName: string; sku: string; unit: Cart[number]["unit"]; currentUnitPriceCents: number | null }[] };
      if (sale.items.some((item) => item.currentUnitPriceCents === null)) { setError("Um ou mais produtos não têm preço vigente. Revise a venda."); setBusyId(""); return; }
      onResume(sale.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity, label: `${item.productName} · ${item.variantName}`, sku: item.sku, unit: item.unit, unitPriceCents: item.currentUnitPriceCents!, discountCents: 0 })), id, sale);
    }
    setBusyId("");
  }

  async function discard(id: string) {
    setBusyId(id); setError("");
    let result;
    try { result = await onDiscard(id, reasons[id] ?? ""); } catch { setError("Não foi possível descartar a venda suspensa."); setBusyId(""); return; }
    if (result.status === "error") setError(result.message ?? "Não foi possível descartar.");
    else setRows((previous) => previous.filter((row) => row.id !== id));
    setBusyId("");
  }

  return <Dialog open={open} onOpenChange={onOpenChange} title="Vendas suspensas" description="Retome uma venda ou descarte-a com um motivo.">
    <div className="space-y-3">
      {error ? <Notice tone="error" title={error} /> : null}
      {loading ? <p role="status">Carregando vendas suspensas…</p> : null}
      {!loading && rows.length === 0 ? <EmptyState icon={Inbox} title="Nenhuma venda suspensa" description="As vendas suspensas desta loja aparecerão aqui." /> : null}
      {rows.map((row) => <article key={row.id} className="space-y-2 rounded-md border border-line p-3"><div className="flex justify-between gap-3"><div><h3 className="font-medium">{row.customerName ?? "Venda sem cliente"}</h3><p className="text-xs text-ink-muted">{formatDateTime(new Date(row.createdAt))} · {row.operatorName} · {row.itemCount} itens</p>{row.note ? <p className="text-sm">{row.note}</p> : null}</div><strong>{formatCurrencyCents(row.estimatedTotalCents)}</strong></div>
        <div className="flex flex-wrap gap-2"><Button disabled={Boolean(busyId)} onClick={() => void resume(row.id)}>{busyId === row.id ? "Carregando…" : "Retomar"}</Button><Field label="Motivo do descarte" className="min-w-48 flex-1">{(field) => <Input {...field} minLength={3} maxLength={240} value={reasons[row.id] ?? ""} onChange={(event) => setReasons((values) => ({ ...values, [row.id]: event.target.value }))} />}</Field><Button variant="danger" disabled={Boolean(busyId) || (reasons[row.id] ?? "").trim().length < 3} onClick={() => void discard(row.id)}>Descartar</Button></div>
      </article>)}
    </div>
  </Dialog>;
}

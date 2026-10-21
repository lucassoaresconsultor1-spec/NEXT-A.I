"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign, Search, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { formatCurrencyCents } from "@/lib/format";
import { parseBrlToCents } from "@/lib/money";
import { addLine, cartTotals, loadCart, lineTotal, removeLine, saveCart, setQuantity, type Cart } from "./cart";
import { completeSaleAction, discardSaleAction, findSaleByCompletionKeyAction, listPdvSalespeopleAction, rotatePdvKeysAction, searchCustomersAction, searchVariantsAction, suspendSaleAction } from "./actions";
import { PaymentDialog } from "./payment-dialog";
import { SuspendedDialog } from "./suspended-dialog";

type Hit = { variantId: string; productName: string; variantName: string; sku: string; barcode: string | null; unit: "un" | "kg" | "l" | "m"; isActive: boolean; priceCents: number };
type Props = { storeId: string; sessionId: string; storeName: string; completionKey: string; suspensionKey: string; canReadCustomers: boolean; canReadMembers: boolean };
const fmtQuantity = (value: string) => value.replace(/\.000$/, "").replace(".", ",");

export function PosScreen(props: Props) {
  const storageKey = `pdv:${props.storeId}:${props.sessionId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<Cart>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState(0);
  const [selectedCartId, setSelectedCartId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [suspendedOpen, setSuspendedOpen] = useState(false);
  const [keys, setKeys] = useState({ completionKey: props.completionKey, suspensionKey: props.suspensionKey });
  const [keysReady, setKeysReady] = useState(true);
  const [pending, setPending] = useState(false);
  const [suspendPending, setSuspendPending] = useState(false);
  const [suspendedSaleId, setSuspendedSaleId] = useState<string | undefined>();
  const [receiptId, setReceiptId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customers, setCustomers] = useState<{ id: string; name: string; document: string | null }[]>([]);
  const [salespeople, setSalespeople] = useState<{ userId: string; label: string; code: string }[]>([]);
  const [salespersonUserId, setSalespersonUserId] = useState("");
  const [note, setNote] = useState("");
  const totals = useMemo(() => cartTotals(cart), [cart]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setCart(loadCart(storageKey)); setCartLoaded(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);
  useEffect(() => { if (cartLoaded) saveCart(storageKey, cart); }, [cartLoaded, storageKey, cart]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!props.canReadMembers) return;
    void listPdvSalespeopleAction(props.storeId).then((result) => {
      if (result.status === "success") setSalespeople((result.data ?? []) as typeof salespeople);
      else setError(result.message ?? "Não foi possível carregar os vendedores.");
    }).catch(() => setError("Não foi possível carregar os vendedores."));
  }, [props.canReadMembers, props.storeId]);

  const rotateKeys = useCallback(async () => {
    setKeysReady(false);
    try {
      const result = await rotatePdvKeysAction();
      if (result.status === "success" && result.data && typeof result.data === "object") {
        setKeys(result.data as typeof keys); setKeysReady(true); setError("");
      } else setError(result.message ?? "Não foi possível gerar uma nova chave de operação.");
    } catch { setError("Não foi possível gerar uma nova chave de operação."); }
  }, []);
  const changeCart = useCallback((next: Cart) => {
    if (pending || suspendPending || busy) return;
    setCart(next); setReceiptId(""); void rotateKeys();
  }, [busy, pending, rotateKeys, suspendPending]);
  const addHit = useCallback((hit: Hit) => {
    changeCart(addLine(cart, { variantId: hit.variantId, label: `${hit.productName}${hit.variantName ? ` · ${hit.variantName}` : ""}`, sku: hit.sku, unit: hit.unit, unitPriceCents: hit.priceCents }));
    setSelectedCartId(hit.variantId);
    setQuery(""); setHits([]); setSelected(0); inputRef.current?.focus();
  }, [cart, changeCart]);

  async function search(term: string) {
    setQuery(term); setError("");
    if (term.trim().length < 2) { setHits([]); return; }
    setBusy(true);
    let result;
    try { result = await searchVariantsAction(term); }
    catch { setBusy(false); setError("Não foi possível buscar produtos."); return; }
    setBusy(false);
    if (result.status === "error") { setError(result.message ?? "Não foi possível buscar produtos."); return; }
    const rows = (result.data ?? []) as Hit[];
    const exact = rows.filter((row) => row.sku.toLowerCase() === term.trim().toLowerCase() || row.barcode === term.trim());
    const matches = exact.length ? exact : rows;
    setHits(matches); setSelected(0);
    if (exact.length === 1) addHit(exact[0]);
  }

  async function searchCustomer(term: string) {
    setCustomerQuery(term);
    if (term.trim().length < 2) { setCustomers([]); return; }
    try {
      const result = await searchCustomersAction(term);
      if (result.status === "success") setCustomers((result.data ?? []) as typeof customers);
      else setError(result.message ?? "Não foi possível buscar clientes.");
    } catch { setError("Não foi possível buscar clientes."); }
  }

  const suspend = useCallback(async () => {
    if (!cart.length || busy || !keysReady) return;
    setBusy(true); setError("");
    const input = { suspensionKey: keys.suspensionKey, storeId: props.storeId, customerId: customerId || undefined, salespersonUserId: salespersonUserId || undefined, note, items: cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity })) };
    const form = new FormData(); form.set("input", JSON.stringify(input));
    let result;
    try { result = await suspendSaleAction(form); }
    catch { setSuspendPending(true); setBusy(false); setError("A resposta da rede não chegou. Tente suspender novamente para confirmar."); return; }
    setBusy(false);
    if (result.status === "error") { setError(result.message ?? "Não foi possível suspender a venda."); return; }
    setCart([]); setCustomerId(""); setCustomerQuery(""); setSalespersonUserId(""); setNote(""); setSuspendPending(false); setNotice("Venda suspensa."); await rotateKeys();
  }, [busy, cart, customerId, keys.suspensionKey, keysReady, note, props.storeId, rotateKeys, salespersonUserId]);

  async function complete(input: Record<string, unknown>) {
    const form = new FormData(); form.set("input", JSON.stringify({ ...input, storeId: props.storeId, completionKey: keys.completionKey, customerId: customerId || undefined, salespersonUserId: salespersonUserId || undefined, ...(suspendedSaleId ? { suspendedSaleId } : {}) }));
    try {
      const result = await completeSaleAction(form);
      if (result.status === "error") {
        setError(result.message ?? "Não foi possível finalizar a venda.");
        const errors = result.fieldErrors ?? {};
        const refreshed = cart.map((item, index) => {
          const priceMessage = errors[`items.${index}.expectedUnitPriceCents`]?.[0];
          const value = priceMessage?.replace(/^Preço atual:\s*/, "").replace(/\.$/, "");
          const price = value ? parseBrlToCents(value) : null;
          return price === null ? item : { ...item, unitPriceCents: price };
        });
        if (refreshed.some((item, index) => item.unitPriceCents !== cart[index].unitPriceCents)) {
          setNotice("Preços atualizados. Confira a venda."); changeCart(refreshed);
        }
        return result;
      }
      const data = result.data as { saleId: string; number: number };
      setCart([]); setCustomerId(""); setCustomerQuery(""); setSalespersonUserId(""); setNote(""); setSuspendedSaleId(undefined); setPaymentOpen(false); setPending(false);
      setReceiptId(data.saleId);
      setNotice(`Venda nº ${data.number} finalizada.`); await rotateKeys();
      return { ...result, data };
    } catch {
      setPending(true); setError(""); return { status: "error", message: "A resposta da rede não chegou.", pending: true };
    }
  }

  async function verifyPending() {
    setBusy(true);
    const result = await findSaleByCompletionKeyAction(keys.completionKey);
    setBusy(false);
    if (result.status === "success" && result.data) {
      const data = result.data as { saleId: string; number: number };
      setCart([]); setPending(false); setPaymentOpen(false); setReceiptId(data.saleId); setNotice(`Venda nº ${data.number} finalizada.`); await rotateKeys();
    } else { setPending(false); setNotice("Venda não encontrada. Você pode tentar de novo com a mesma chave."); }
  }

  function resume(items: Cart, saleId: string, sale?: { customerId: string | null; salespersonUserId: string | null; note: string | null }) { changeCart(items); setSuspendedSaleId(saleId); setCustomerId(sale?.customerId ?? ""); setSalespersonUserId(sale?.salespersonUserId ?? ""); setNote(sale?.note ?? ""); setSuspendedOpen(false); }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (event.key === "Escape") { setPaymentOpen(false); setSuspendedOpen(false); return; }
      if (event.key === "F8" && keysReady) { event.preventDefault(); setPaymentOpen(true); }
      if (event.key === "F9" && keysReady) { event.preventDefault(); void suspend(); }
      if (event.key === "F10") { event.preventDefault(); setSuspendedOpen(true); }
      if (event.key === "F4" && props.canReadCustomers) { event.preventDefault(); document.getElementById("cliente-pdv")?.focus(); }
      if (event.key === "F2") { event.preventDefault(); inputRef.current?.focus(); }
      if (event.key === "F6") { event.preventDefault(); setPaymentOpen(true); window.setTimeout(() => document.getElementById("pdv-discount")?.focus(), 0); }
      if (!typing && event.key === "Delete" && cart.length) { event.preventDefault(); const id = selectedCartId || cart[0].variantId; changeCart(removeLine(cart, id)); setSelectedCartId(cart.find((item) => item.variantId !== id)?.variantId ?? ""); }
      if (!typing && (event.key === "ArrowDown" || event.key === "ArrowUp") && cart.length) {
        event.preventDefault();
        const current = Math.max(0, cart.findIndex((item) => item.variantId === selectedCartId));
        const offset = event.key === "ArrowDown" ? 1 : -1;
        setSelectedCartId(cart[(current + offset + cart.length) % cart.length].variantId);
      }
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [cart, props.canReadCustomers, changeCart, selectedCartId, keysReady, suspend]);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-semibold">{props.storeName}</h1><p className="text-sm text-ink-muted">Leitor de código de barras ou busca por produto</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => setSuspendedOpen(true)}>F10 · Suspensas</Button><Button variant="secondary" onClick={() => void suspend()} disabled={!cart.length || busy || !keysReady}>F9 · Suspender</Button></div></div>
    {notice ? <Notice tone="success" title={notice}>{receiptId ? <a className="font-medium text-brand-strong underline" href={`/pdv/comprovante/${receiptId}`}>Abrir comprovante</a> : null}</Notice> : null}{error ? <Notice tone="error" title={error}>{error.includes("chave de operação") ? <Button variant="secondary" onClick={() => void rotateKeys()}>Gerar nova chave</Button> : null}</Notice> : null}
    {pending ? <Notice tone="warning" title="Venda pendente de confirmação">A resposta da finalização não chegou. Verifique o resultado antes de tentar novamente. <Button onClick={() => void verifyPending()} disabled={busy}>{busy ? "Verificando…" : "Verificar"}</Button></Notice> : null}
    {suspendPending ? <Notice tone="warning" title="Suspensão pendente de confirmação">Tente novamente para confirmar a suspensão com a mesma chave. <Button onClick={() => void suspend()} disabled={busy}>Tentar suspender novamente</Button></Notice> : null}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
      <Card><CardHeader title="Adicionar produto" description="Digite o código ou SKU e pressione Enter." /><CardBody className="space-y-3">
        <div className="flex gap-2"><Field label="Código de barras ou produto" className="flex-1">{(field) => <Input {...field} ref={inputRef} value={query} onChange={(event) => void search(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && hits.length) { event.preventDefault(); setSelected((value) => (value + 1) % hits.length); } if (event.key === "ArrowUp" && hits.length) { event.preventDefault(); setSelected((value) => (value + hits.length - 1) % hits.length); } if (event.key === "Enter") { event.preventDefault(); if (hits.length) addHit(hits[selected] ?? hits[0]); else void search(query); } }} autoComplete="off" />}</Field><Button className="mt-6" onClick={() => void search(query)} aria-label="Buscar produto"><Search className="size-4" aria-hidden /></Button></div>
        {!cartLoaded ? <p role="status" className="text-sm text-ink-muted">Carregando carrinho…</p> : null}{busy ? <p role="status" className="text-sm text-ink-muted">Buscando…</p> : null}
        {!busy && query.trim().length >= 2 && !hits.length ? <p className="text-sm text-ink-muted">Nenhum produto encontrado.</p> : null}
        {hits.length > 0 ? <ul className="divide-y divide-line rounded-md border border-line">{hits.map((hit, index) => <li key={hit.variantId}><button type="button" className={`w-full p-3 text-left hover:bg-canvas ${index === selected ? "bg-canvas" : ""}`} onClick={() => addHit(hit)}>{hit.productName} · {hit.variantName} <span className="text-ink-muted">({hit.sku})</span> · {formatCurrencyCents(hit.priceCents)}</button></li>)}</ul> : null}
        <div className="flex items-center justify-between"><h2 className="font-semibold">Carrinho <span className="text-sm text-ink-muted">({cart.length} itens)</span></h2><span className="text-2xl font-bold tabular-nums">{formatCurrencyCents(totals.totalCents)}</span></div>
        {!cart.length ? <EmptyState icon={ShoppingCart} title="Carrinho vazio" description="Leia um código de barras ou busque um produto para começar." /> : <ul className="divide-y divide-line">{cart.map((item, index) => <li key={item.variantId} onClick={() => setSelectedCartId(item.variantId)} className={`grid grid-cols-[1fr_6rem_auto] items-center gap-3 py-3 ${selectedCartId === item.variantId ? "bg-brand-soft/30" : ""}`}><div><p className="font-medium">{index + 1}. {item.label}</p><p className="text-xs text-ink-muted">{item.sku} · {formatCurrencyCents(item.unitPriceCents)} / {item.unit}</p></div><label className="text-xs text-ink-muted">Quantidade<Input aria-label={`Quantidade de ${item.label}`} inputMode="decimal" value={fmtQuantity(item.quantity)} onChange={(event) => changeCart(setQuantity(cart, item.variantId, event.target.value.replace(",", ".")))} /></label><div className="flex items-center gap-2"><strong className="tabular-nums">{formatCurrencyCents(lineTotal(item))}</strong><Button variant="ghost" aria-label={`Remover ${item.label}`} onClick={() => { changeCart(removeLine(cart, item.variantId)); setSelectedCartId(cart.find((entry) => entry.variantId !== item.variantId)?.variantId ?? ""); }}><Trash2 className="size-4" aria-hidden /></Button></div></li>)}</ul>}
      </CardBody></Card>
      <Card><CardHeader title="Venda" description="Cliente e total da compra" /><CardBody className="space-y-4">
        {props.canReadCustomers ? <div className="space-y-2"><Field label="Cliente">{(field) => <Input {...field} id="cliente-pdv" value={customerQuery} onChange={(event) => void searchCustomer(event.target.value)} placeholder="Buscar cliente" />}</Field>{customers.length ? <ul className="rounded-md border border-line">{customers.map((item) => <li key={item.id}><button type="button" className="w-full p-2 text-left hover:bg-canvas" onClick={() => { setCustomerId(item.id); setCustomerQuery(item.name); setCustomers([]); }}>{item.name}{item.document ? ` · ${item.document}` : ""}</button></li>)}</ul> : null}</div> : null}
        {props.canReadMembers ? <Field label="Vendedor">{(field) => <Select {...field} value={salespersonUserId} onChange={(event) => setSalespersonUserId(event.target.value)}><option value="">Sem vendedor</option>{salespeople.map((person) => <option key={person.userId} value={person.userId}>{person.label} · {person.code}</option>)}</Select>}</Field> : null}
        <Field label="Observação da venda">{(field) => <Textarea {...field} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />}</Field>
        <p className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrencyCents(totals.totalCents)}</span></p>
        <Button className="w-full" disabled={!cart.length || pending || !keysReady} onClick={() => setPaymentOpen(true)}><CircleDollarSign className="size-4" aria-hidden />F8 · Pagamento</Button>
        <p className="text-xs text-ink-muted">F2 buscar · F4 cliente · F6 desconto · F8 pagar · F9 suspender · F10 suspensas · Delete remover · Esc fechar</p>
      </CardBody></Card>
    </div>
    <PaymentDialog open={paymentOpen} onOpenChange={setPaymentOpen} cart={cart} totalCents={totals.totalCents} pending={pending} keysReady={keysReady} note={note} onNoteChange={setNote} onComplete={complete} onVerify={verifyPending} />
    <SuspendedDialog open={suspendedOpen} onOpenChange={setSuspendedOpen} storeId={props.storeId} onResume={resume} onDiscard={async (id, reason) => { const form = new FormData(); form.set("saleId", id); form.set("reason", reason); const result = await discardSaleAction(form); if (result.status === "error") setError(result.message ?? "Não foi possível descartar."); return result; }} />
  </div>;
}

export function ReceiptPrintButton() {
  return <Button onClick={() => window.print()}>Imprimir</Button>;
}

"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Notice } from "@/components/ui/feedback";
import { Checkbox, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { recordCountAction } from "../actions";
import { QTY_PREFIX } from "../count-form-data";

/** One item as the page received it; balances only come when the member may see them (not blind). */
export interface SheetItem {
  id: string;
  label: string;
  sku: string;
  unit: QuantityUnit;
  countedQuantity: string | null;
  review?: { expectedQuantity: string; currentQuantity: string | null; difference: string | null; movedDuringCount: boolean };
}

const MAX_PER_SUBMIT = 500;
const toInput = (value: string | null) => (value === null ? "" : formatQuantity(value).replace(/\./g, ""));

/** Blind counting sheet: search, "only pending" and one quantity per item; only changed items are sent. */
export function CountSheet({ countId, items, canRecord }: { countId: string; items: SheetItem[]; canRecord: boolean }) {
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [state, action] = useFormAction(recordCountAction, () => setDirty(new Set()));
  const errors = state.fieldErrors ?? {};
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      new Set(
        items
          .filter((item) => (!pendingOnly || item.countedQuantity === null) && (!needle || item.label.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle)))
          .map((item) => item.id),
      ),
    [items, pendingOnly, needle],
  );
  const counted = items.filter((item) => item.countedQuantity !== null).length;
  const showReview = items.some((item) => item.review);

  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="countId" value={countId} />
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {state.status === "success" && state.message ? <Notice tone="success" title={state.message} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label htmlFor="busca-item" className="block text-sm font-medium text-ink">
            Buscar item
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input id="busca-item" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou SKU" autoComplete="off" className="w-72 max-w-full pl-9" />
          </div>
        </div>
        <Checkbox checked={pendingOnly} onChange={(event) => setPendingOnly(event.target.checked)} label="Só os não contados" className="pb-2.5" />
        <p className="pb-2.5 text-sm text-ink-muted" aria-live="polite">
          {counted} de {items.length} contados · {visible.size} na lista
        </p>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line" aria-label="Itens do inventário">
        {items.map((item) => {
          const field = `${QTY_PREFIX}${item.id}`;
          const inputId = `qtd-${item.id}`;
          const error = errors[field]?.[0];
          return (
            <li key={item.id} hidden={!visible.has(item.id)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-48 flex-1">
                <label htmlFor={inputId} className="font-medium text-ink">
                  {item.label}
                </label>
                <span className="block text-xs text-ink-muted">
                  {item.sku} · {item.unit}
                  {item.countedQuantity === null ? " · não contado" : ""}
                </span>
                {item.review ? (
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                    <span>Na abertura: {formatQuantity(item.review.expectedQuantity)}</span>
                    {item.review.currentQuantity === null ? null : <span>Atual: {formatQuantity(item.review.currentQuantity)}</span>}
                    {item.review.difference === null ? null : <span className="font-medium">Diferença: {formatQuantity(item.review.difference)}</span>}
                    {item.review.movedDuringCount ? <Badge tone="attention">Movimentado durante a contagem</Badge> : null}
                  </span>
                ) : null}
                {error ? (
                  <p id={`${inputId}-erro`} className="mt-1 text-xs font-medium text-critical">
                    {error}
                  </p>
                ) : null}
              </div>
              <Input
                id={inputId}
                name={dirty.has(item.id) ? field : undefined}
                defaultValue={toInput(item.countedQuantity)}
                onChange={() => setDirty((current) => (current.has(item.id) ? current : new Set(current).add(item.id)))}
                inputMode={item.unit === "un" ? "numeric" : "decimal"}
                maxLength={16}
                autoComplete="off"
                disabled={!canRecord}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-erro` : undefined}
                className="w-32 text-right tabular-nums"
              />
            </li>
          );
        })}
      </ul>
      {canRecord ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {dirty.size > MAX_PER_SUBMIT ? <span className="text-sm text-attention">Salve no máximo {MAX_PER_SUBMIT} itens por vez.</span> : null}
          <span className="text-sm text-ink-muted">{dirty.size === 1 ? "1 item alterado" : `${dirty.size} itens alterados`}</span>
          <SubmitButton pendingLabel="Salvando…">Salvar contagem</SubmitButton>
        </div>
      ) : null}
      {showReview ? null : <p className="text-xs text-ink-muted">Contagem cega: o saldo do sistema não aparece para quem conta.</p>}
    </form>
  );
}

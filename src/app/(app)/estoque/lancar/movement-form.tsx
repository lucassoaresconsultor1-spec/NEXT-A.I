"use client";

import Link from "next/link";
import { startTransition, useState, type FormEvent } from "react";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPES } from "@/server/inventory/schemas";
import type { MovementType } from "@/server/inventory/quantity";
import { recordMovementAction } from "../actions";

export interface MovementFormStore {
  id: string;
  code: string;
  name: string;
}

export interface MovementFormVariant {
  id: string;
  name: string;
  sku: string;
}

const QUANTITY_COPY: Record<MovementType, { label: string; hint: string }> = {
  entry: { label: "Quantidade", hint: "Quantidade movimentada, maior que zero." },
  exit: { label: "Quantidade", hint: "Quantidade movimentada, maior que zero." },
  loss: { label: "Quantidade", hint: "Quantidade movimentada, maior que zero." },
  adjustment: { label: "Ajuste", hint: "Use número negativo para reduzir (ex.: -2)." },
  count: { label: "Quantidade contada", hint: "Total contado na loja; o sistema calcula a diferença." },
};

export function MovementForm({
  stores,
  variants,
  unit,
  defaultStoreId,
}: {
  stores: MovementFormStore[];
  variants: MovementFormVariant[];
  unit: QuantityUnit;
  defaultStoreId: string;
}) {
  const [type, setType] = useState<MovementType>("entry");
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  // Store, variant and type stay selected after a launch; quantity and reason start over.
  const [state, action] = useFormAction(recordMovementAction, () => {
    setQuantity("");
    setReason("");
  });
  const errors = state.fieldErrors ?? {};
  const copy = QUANTITY_COPY[type];
  const balanceAfter = "balanceAfter" in state && typeof state.balanceAfter === "string" ? state.balanceAfter : null;

  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {state.status === "success" && balanceAfter !== null ? (
        <Notice tone="success" title={`Movimentação lançada. Saldo atual: ${formatQuantity(balanceAfter, unit)}.`}>
          <Link href={`/estoque/movimentacoes?loja=${storeId}`} className="font-medium text-brand-strong hover:underline">
            Ver no livro
          </Link>
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Loja" error={errors.storeId} required>
          {(props) => (
            <Select {...props} name="storeId" value={storeId} onChange={(event) => setStoreId(event.target.value)} required>
              {defaultStoreId ? null : <option value="">Selecione</option>}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.code} · {store.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Variação" error={errors.variantId} required>
          {(props) => (
            <Select {...props} name="variantId" defaultValue={variants.length === 1 ? variants[0].id : ""} required>
              {variants.length === 1 ? null : <option value="">Selecione</option>}
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name} · {variant.sku}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo" error={errors.type} required>
          {(props) => (
            <Select {...props} name="type" value={type} onChange={(event) => setType(event.target.value as MovementType)} required>
              {MOVEMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {MOVEMENT_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={copy.label} hint={unit === "un" ? `${copy.hint} Somente números inteiros.` : copy.hint} error={errors.quantity} required>
          {(props) => (
            <Input
              {...props}
              name="quantity"
              inputMode="decimal"
              maxLength={16}
              autoComplete="off"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          )}
        </Field>
      </div>
      <Field label="Motivo" hint="Entre 3 e 240 caracteres. Fica no histórico." error={errors.reason} required>
        {(props) => (
          <Textarea {...props} name="reason" maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} required />
        )}
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Lançando…">Lançar movimentação</SubmitButton>
      </div>
    </form>
  );
}

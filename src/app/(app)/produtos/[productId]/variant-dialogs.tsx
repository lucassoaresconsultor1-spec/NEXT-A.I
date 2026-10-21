"use client";

import { BadgeDollarSign, Pencil, Plus, Power, PowerOff, Tag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatCentsInput } from "@/lib/money";
import { addVariantAction, setVariantActiveAction, setVariantCostAction, setVariantPriceAction, updateVariantAction } from "../actions";

/** Variant data sent to the client; costCents only exists for members allowed to manage costs. */
export interface VariantValues {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  isActive: boolean;
  priceCents: number | null;
  costCents?: number | null;
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      {children}
    </div>
  );
}

function MoneyInput(props: { id: string; name: string; defaultValue?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-muted" aria-hidden>
        R$
      </span>
      <Input {...props} inputMode="decimal" maxLength={18} autoComplete="off" className="pl-10" />
    </div>
  );
}

// Each dialog's form lives in its content, which unmounts when closed, so every opening starts fresh.
function VariantForm({ productId, variant, canManageCosts, onDone }: { productId: string; variant?: VariantValues; canManageCosts: boolean; onDone: () => void }) {
  const [state, action] = useFormAction(variant ? updateVariantAction : addVariantAction, onDone);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="productId" value={productId} />
      {variant ? <input type="hidden" name="variantId" value={variant.id} /> : null}
      <Field label="Nome" hint="Ex.: Único, 39, Azul P" error={errors.name} required>
        {(props) => <Input {...props} name="name" defaultValue={variant?.name} maxLength={80} autoComplete="off" required />}
      </Field>
      <Field label="SKU" hint="Letras sem acento, números, ponto, hífen ou sublinhado." error={errors.sku} required>
        {(props) => <Input {...props} name="sku" defaultValue={variant?.sku} maxLength={40} autoComplete="off" autoCapitalize="characters" required />}
      </Field>
      <Field label="Código de barras" error={errors.barcode}>
        {(props) => <Input {...props} name="barcode" defaultValue={variant?.barcode ?? ""} inputMode="numeric" maxLength={14} autoComplete="off" />}
      </Field>
      {variant ? null : (
        <>
          <Field label="Preço de venda" error={errors.price ?? errors.priceCents}>
            {(props) => <MoneyInput {...props} name="price" />}
          </Field>
          {canManageCosts ? (
            <Field label="Custo" error={errors.cost ?? errors.costCents}>
              {(props) => <MoneyInput {...props} name="cost" />}
            </Field>
          ) : null}
        </>
      )}
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function VariantFormDialog({ productId, variant, canManageCosts = false, disabled = false }: { productId: string; variant?: VariantValues; canManageCosts?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = variant ? (
    <Button variant="ghost" size="sm" aria-label={`Editar variação ${variant.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button variant="secondary" size="sm" disabled={disabled} aria-disabled={disabled}>
      <Plus className="size-4" aria-hidden /> Adicionar variação
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={variant ? "Editar variação" : "Adicionar variação"}>
      <VariantForm productId={productId} variant={variant} canManageCosts={canManageCosts} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

const AMOUNT = {
  price: { action: setVariantPriceAction, label: "Preço de venda", title: "Alterar preço", aria: "Alterar preço da variação", icon: Tag },
  cost: { action: setVariantCostAction, label: "Custo", title: "Alterar custo", aria: "Alterar custo da variação", icon: BadgeDollarSign },
} as const;

function AmountForm({ productId, variant, kind, onDone }: { productId: string; variant: VariantValues; kind: keyof typeof AMOUNT; onDone: () => void }) {
  // No auto-close: the result (updated, or "already the current value") stays visible until "Fechar".
  const [state, action] = useFormAction(AMOUNT[kind].action);
  const current = kind === "price" ? variant.priceCents : variant.costCents;
  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <Notice tone="success" title={state.message} />
        <div className="flex justify-end">
          <Button onClick={onDone}>Fechar</Button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={variant.id} />
      <Field label={AMOUNT[kind].label} hint="O valor anterior fica no histórico." error={state.fieldErrors?.[kind]} required>
        {(props) => <MoneyInput {...props} name={kind} defaultValue={current === null || current === undefined ? "" : formatCentsInput(current)} />}
      </Field>
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function VariantAmountDialog({ productId, variant, kind }: { productId: string; variant: VariantValues; kind: keyof typeof AMOUNT }) {
  const [open, setOpen] = useState(false);
  const Icon = AMOUNT[kind].icon;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${AMOUNT[kind].title}: ${variant.name}`}
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${AMOUNT[kind].aria} ${variant.name}`}>
          <Icon className="size-4" aria-hidden /> {kind === "price" ? "Preço" : "Custo"}
        </Button>
      }
    >
      <AmountForm productId={productId} variant={variant} kind={kind} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function StatusForm({ productId, variant, onDone }: { productId: string; variant: VariantValues; onDone: () => void }) {
  const [state, action] = useFormAction(setVariantActiveAction, onDone);
  const activating = !variant.isActive;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="id" value={variant.id} />
      <input type="hidden" name="active" value={activating ? "true" : "false"} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar variação" : "Desativar variação"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function VariantStatusDialog({ productId, variant }: { productId: string; variant: VariantValues }) {
  const [open, setOpen] = useState(false);
  const activating = !variant.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} a variação ${variant.name}?`}
      description={activating ? "A variação volta a constar como ativa." : "A variação deixa de aparecer para venda; o histórico é mantido."}
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${verb} variação ${variant.name}`}>
          <Icon className="size-4" aria-hidden /> {verb}
        </Button>
      }
    >
      <StatusForm productId={productId} variant={variant} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

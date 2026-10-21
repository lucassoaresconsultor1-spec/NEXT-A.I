"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import {
  CUSTOMER_REQUIREMENT_LABELS,
  CUSTOMER_REQUIREMENTS,
  formatBpsInput,
  RECEIPT_TEXT_MAX,
  type CustomerRequirement,
} from "@/server/settings/schemas";
import { saveOrganizationOperationsAction, saveStoreOperationsAction } from "./actions";

export interface OrganizationValues {
  customerRequirement: CustomerRequirement;
  maxDiscountBps: number;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export interface StoreValues {
  storeId: string;
  name: string;
  override: { customerRequirement: CustomerRequirement | null; maxDiscountBps: number | null; receiptHeader: string | null };
}

const DISCOUNT_HINT = "Acima deste percentual, o desconto exige um perfil com autorização para descontos maiores.";
const RECEIPT_HINT = "Até 4 linhas. Aparece no comprovante não fiscal do PDV.";
const INHERIT_LABEL = "Usar o padrão da empresa";

/** Percent input with a visual "%" suffix; the value travels as text and the server converts it. */
function PercentInput(props: { id: string; defaultValue: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) {
  return (
    <div className="relative max-w-40">
      <Input {...props} name="maxDiscountBps" inputMode="decimal" maxLength={6} autoComplete="off" className="pr-8" />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-muted" aria-hidden>
        %
      </span>
    </div>
  );
}

function RequirementOptions({ inherit }: { inherit?: boolean }) {
  return (
    <>
      {inherit ? <option value="">{INHERIT_LABEL}</option> : null}
      {CUSTOMER_REQUIREMENTS.map((value) => (
        <option key={value} value={value}>
          {CUSTOMER_REQUIREMENT_LABELS[value]}
        </option>
      ))}
    </>
  );
}

export function OrganizationOperationsForm({ values }: { values: OrganizationValues }) {
  const [state, action] = useFormAction(saveOrganizationOperationsAction);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {state.status === "success" && state.message ? <Notice tone="success" title={state.message} /> : null}
      <Field label="Cliente na venda" error={state.fieldErrors?.customerRequirement} required>
        {(props) => (
          <Select {...props} name="customerRequirement" defaultValue={values.customerRequirement} required>
            <RequirementOptions />
          </Select>
        )}
      </Field>
      <Field label="Teto de desconto sem autorização" hint={DISCOUNT_HINT} error={state.fieldErrors?.maxDiscountBps} required>
        {(props) => <PercentInput {...props} defaultValue={formatBpsInput(values.maxDiscountBps)} />}
      </Field>
      <Field label="Cabeçalho do comprovante" hint={RECEIPT_HINT} error={state.fieldErrors?.receiptHeader}>
        {(props) => <Textarea {...props} name="receiptHeader" rows={4} maxLength={RECEIPT_TEXT_MAX} defaultValue={values.receiptHeader ?? ""} />}
      </Field>
      <Field label="Rodapé do comprovante" hint={RECEIPT_HINT} error={state.fieldErrors?.receiptFooter}>
        {(props) => <Textarea {...props} name="receiptFooter" rows={4} maxLength={RECEIPT_TEXT_MAX} defaultValue={values.receiptFooter ?? ""} />}
      </Field>
      <div className="flex justify-end">
        <SubmitButton>Salvar regras da empresa</SubmitButton>
      </div>
    </form>
  );
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      {children}
    </div>
  );
}

// Rendered inside the dialog content, so each opening starts with a fresh form state.
function StoreOperationsForm({ store, onDone }: { store: StoreValues; onDone: () => void }) {
  const [state, action] = useFormAction(saveStoreOperationsAction, onDone);
  const [, resetAction] = useFormAction(saveStoreOperationsAction, onDone);
  const { override } = store;
  const hasOverride = override.customerRequirement !== null || override.maxDiscountBps !== null || override.receiptHeader !== null;
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="storeId" value={store.storeId} />
        <Field label="Cliente na venda" error={state.fieldErrors?.customerRequirement}>
          {(props) => (
            <Select {...props} name="customerRequirement" defaultValue={override.customerRequirement ?? ""}>
              <RequirementOptions inherit />
            </Select>
          )}
        </Field>
        <Field
          label="Teto de desconto sem autorização"
          hint={`${DISCOUNT_HINT} Deixe em branco para usar o padrão da empresa.`}
          error={state.fieldErrors?.maxDiscountBps}
        >
          {(props) => <PercentInput {...props} defaultValue={override.maxDiscountBps === null ? "" : formatBpsInput(override.maxDiscountBps)} />}
        </Field>
        <Field
          label="Cabeçalho do comprovante"
          hint={`${RECEIPT_HINT} Deixe em branco para usar o padrão da empresa.`}
          error={state.fieldErrors?.receiptHeader}
        >
          {(props) => <Textarea {...props} name="receiptHeader" rows={4} maxLength={RECEIPT_TEXT_MAX} defaultValue={override.receiptHeader ?? ""} />}
        </Field>
        <FormActions onCancel={onDone}>
          <SubmitButton>Salvar</SubmitButton>
        </FormActions>
      </form>
      {hasOverride ? (
        <form action={resetAction} className="border-t border-line pt-4">
          <input type="hidden" name="storeId" value={store.storeId} />
          <input type="hidden" name="customerRequirement" value="" />
          <input type="hidden" name="maxDiscountBps" value="" />
          <input type="hidden" name="receiptHeader" value="" />
          <SubmitButton variant="ghost" pendingLabel="Restaurando…">
            <RotateCcw className="size-4" aria-hidden /> Voltar ao padrão
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

export function StoreOperationsDialog({ store }: { store: StoreValues }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Regras da loja ${store.name}`}
      description="Os campos com o padrão da empresa acompanham as mudanças feitas na empresa."
      trigger={
        <Button variant="ghost" size="sm" aria-label={`Personalizar regras da loja ${store.name}`}>
          <SlidersHorizontal className="size-4" aria-hidden /> Personalizar
        </Button>
      }
    >
      <StoreOperationsForm store={store} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

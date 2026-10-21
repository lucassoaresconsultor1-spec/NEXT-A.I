"use client";

import { CheckCircle2, PackageCheck, Truck, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { parseQuantityInput } from "@/server/inventory/quantity";
import { approveTransferAction, cancelTransferAction, dispatchTransferAction, receiveTransferAction } from "../actions";

export interface TransferDialogItem {
  id: string;
  label: string;
  unit: QuantityUnit;
  /** Database quantities ("2.500"); `sent` is null before the dispatch. */
  requested: string;
  sent: string | null;
}

/** "1234.500" -> "1234,5": input value without thousands separators. */
function quantityInput(dbValue: string) {
  const [whole, fraction = ""] = dbValue.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole},${trimmed}` : whole;
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Voltar
      </Button>
      {children}
    </div>
  );
}

function SimpleForm({ transferId, kind, onDone }: { transferId: string; kind: "approve" | "cancel"; onDone: () => void }) {
  const [state, action] = useFormAction(kind === "approve" ? approveTransferAction : cancelTransferAction, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="transferId" value={transferId} />
      {kind === "cancel" ? (
        <Field label="Motivo" hint="Entre 3 e 240 caracteres. Fica no histórico." error={state.fieldErrors?.reason} required>
          {(props) => <Textarea {...props} name="reason" maxLength={240} required />}
        </Field>
      ) : null}
      <FormActions onCancel={onDone}>
        {kind === "approve" ? (
          <SubmitButton pendingLabel="Aprovando…">Aprovar</SubmitButton>
        ) : (
          <SubmitButton variant="danger" pendingLabel="Cancelando…">
            Cancelar transferência
          </SubmitButton>
        )}
      </FormActions>
    </form>
  );
}

export function ApproveTransferDialog({ transferId, number }: { transferId: string; number: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Aprovar a transferência nº ${number}?`}
      description="As quantidades ficam reservadas na loja de origem até o despacho."
      trigger={
        <Button aria-label={`Aprovar transferência nº ${number}`}>
          <CheckCircle2 className="size-4" aria-hidden /> Aprovar
        </Button>
      }
    >
      <SimpleForm transferId={transferId} kind="approve" onDone={() => setOpen(false)} />
    </Dialog>
  );
}

export function CancelTransferDialog({ transferId, number }: { transferId: string; number: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Cancelar a transferência nº ${number}?`}
      description="Reservas da origem são liberadas. Informe o motivo."
      trigger={
        <Button variant="secondary" aria-label={`Cancelar transferência nº ${number}`}>
          <XCircle className="size-4" aria-hidden /> Cancelar
        </Button>
      }
    >
      <SimpleForm transferId={transferId} kind="cancel" onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function QuantitiesForm({ transferId, kind, items, onDone }: { transferId: string; kind: "dispatch" | "receive"; items: TransferDialogItem[]; onDone: () => void }) {
  const [state, action] = useFormAction(kind === "dispatch" ? dispatchTransferAction : receiveTransferAction, onDone);
  const field = kind === "dispatch" ? "quantitySent" : "quantityReceived";
  const [values, setValues] = useState(() => items.map((item) => quantityInput(kind === "dispatch" ? item.requested : (item.sent ?? "0"))));
  const errors = state.fieldErrors ?? {};
  // The reason field appears as soon as any received quantity is below what was sent.
  const hasDifference =
    kind === "receive" &&
    items.some((item, index) => {
      const received = parseQuantityInput(values[index]);
      const sent = parseQuantityInput(item.sent ?? "0");
      return received !== null && sent !== null && received < sent;
    });

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {kind === "dispatch" ? <Notice tone="info" title="O que não for enviado volta a ficar disponível na origem." /> : null}
      <input type="hidden" name="transferId" value={transferId} />
      {items.map((item, index) => (
        <div key={item.id}>
          <input type="hidden" name={`items.${index}.itemId`} value={item.id} />
          <Field
            label={item.label}
            hint={
              kind === "dispatch"
                ? `Solicitado: ${formatQuantity(item.requested, item.unit)}.`
                : `Enviado: ${formatQuantity(item.sent ?? "0", item.unit)}.`
            }
            error={errors[`items.${index}.${field}`] ?? errors[`items.${index}.itemId`]}
          >
            {(props) => (
              <Input
                {...props}
                name={`items.${index}.${field}`}
                value={values[index]}
                onChange={(event) => setValues((current) => current.map((value, position) => (position === index ? event.target.value : value)))}
                inputMode="decimal"
                maxLength={16}
                autoComplete="off"
              />
            )}
          </Field>
        </div>
      ))}
      {hasDifference ? (
        <Field label="Motivo da diferença" hint="Obrigatório quando o recebido é menor que o enviado." error={errors.divergenceReason} required>
          {(props) => <Textarea {...props} name="divergenceReason" maxLength={240} required />}
        </Field>
      ) : null}
      <FormActions onCancel={onDone}>
        <SubmitButton pendingLabel={kind === "dispatch" ? "Despachando…" : "Registrando…"}>{kind === "dispatch" ? "Despachar" : "Registrar recebimento"}</SubmitButton>
      </FormActions>
    </form>
  );
}

export function DispatchTransferDialog({ transferId, number, items }: { transferId: string; number: number; items: TransferDialogItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Despachar a transferência nº ${number}`}
      description="Informe o que sai da loja de origem. Zero é permitido."
      trigger={
        <Button aria-label={`Despachar transferência nº ${number}`}>
          <Truck className="size-4" aria-hidden /> Despachar
        </Button>
      }
    >
      <QuantitiesForm transferId={transferId} kind="dispatch" items={items} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

export function ReceiveTransferDialog({ transferId, number, items }: { transferId: string; number: number; items: TransferDialogItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Registrar recebimento da transferência nº ${number}`}
      description="Informe o que chegou na loja de destino."
      trigger={
        <Button aria-label={`Registrar recebimento da transferência nº ${number}`}>
          <PackageCheck className="size-4" aria-hidden /> Registrar recebimento
        </Button>
      }
    >
      <QuantitiesForm transferId={transferId} kind="receive" items={items} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

"use client";

import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { approvePurchaseOrderAction, cancelPurchaseOrderAction, closePurchaseOrderAction } from "../actions";

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

function ApproveForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const [state, action] = useFormAction(approvePurchaseOrderAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="orderId" value={orderId} />
      <FormActions onCancel={onDone}>
        <SubmitButton pendingLabel="Aprovando…">Aprovar pedido</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ApproveOrderDialog({ orderId, number }: { orderId: string; number: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Aprovar o pedido nº ${number}?`}
      description="Depois de aprovado, o pedido não pode mais ser alterado."
      trigger={
        <Button aria-label={`Aprovar pedido nº ${number}`}>
          <CheckCircle2 className="size-4" aria-hidden /> Aprovar pedido
        </Button>
      }
    >
      <ApproveForm orderId={orderId} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

const REASON_ACTIONS = {
  cancel: {
    action: cancelPurchaseOrderAction,
    button: "Cancelar pedido",
    pending: "Cancelando…",
    title: (number: number) => `Cancelar o pedido nº ${number}?`,
    description: "O pedido deixa de aceitar recebimentos. Informe o motivo.",
    icon: XCircle,
  },
  close: {
    action: closePurchaseOrderAction,
    button: "Encerrar pendências",
    pending: "Encerrando…",
    title: (number: number) => `Encerrar as pendências do pedido nº ${number}?`,
    description: "As quantidades pendentes deixam de ser esperadas.",
    icon: CircleSlash,
  },
} as const;

function ReasonForm({ orderId, kind, onDone }: { orderId: string; kind: keyof typeof REASON_ACTIONS; onDone: () => void }) {
  const [state, action] = useFormAction(REASON_ACTIONS[kind].action, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="orderId" value={orderId} />
      <Field label="Motivo" hint="Entre 3 e 240 caracteres. Fica no histórico do pedido." error={state.fieldErrors?.reason} required>
        {(props) => <Textarea {...props} name="reason" maxLength={240} required />}
      </Field>
      <FormActions onCancel={onDone}>
        <SubmitButton variant="danger" pendingLabel={REASON_ACTIONS[kind].pending}>
          {REASON_ACTIONS[kind].button}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function ReasonOrderDialog({ orderId, number, kind }: { orderId: string; number: number; kind: keyof typeof REASON_ACTIONS }) {
  const [open, setOpen] = useState(false);
  const copy = REASON_ACTIONS[kind];
  const Icon = copy.icon;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={copy.title(number)}
      description={copy.description}
      trigger={
        <Button variant="secondary" aria-label={`${copy.button} do pedido nº ${number}`}>
          <Icon className="size-4" aria-hidden /> {copy.button}
        </Button>
      }
    >
      <ReasonForm orderId={orderId} kind={kind} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

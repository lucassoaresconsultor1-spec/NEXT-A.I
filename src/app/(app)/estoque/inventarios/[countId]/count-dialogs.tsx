"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { approveCountAction, cancelCountAction } from "../actions";

const KINDS = {
  approve: {
    action: approveCountAction,
    button: "Aprovar inventário",
    pending: "Aprovando…",
    variant: "primary",
    title: (number: number) => `Aprovar o inventário nº ${number}?`,
    description: "Cada item contado com diferença recebe um lançamento de inventário pelo saldo atual. Itens não contados ficam como estão.",
    icon: CheckCircle2,
  },
  cancel: {
    action: cancelCountAction,
    button: "Cancelar inventário",
    pending: "Cancelando…",
    variant: "danger",
    title: (number: number) => `Cancelar o inventário nº ${number}?`,
    description: "Nada é ajustado no estoque e as quantidades contadas ficam só no histórico.",
    icon: XCircle,
  },
} as const;

function ReasonForm({ countId, kind, onDone }: { countId: string; kind: keyof typeof KINDS; onDone: () => void }) {
  const copy = KINDS[kind];
  const [state, action] = useFormAction(copy.action, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="countId" value={countId} />
      <Field label="Motivo" hint="Entre 3 e 240 caracteres. Fica no histórico." error={state.fieldErrors?.reason} required>
        {(props) => <Textarea {...props} name="reason" maxLength={240} required />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Voltar
        </Button>
        <SubmitButton variant={copy.variant} pendingLabel={copy.pending}>
          {copy.button}
        </SubmitButton>
      </div>
    </form>
  );
}

export function CountReasonDialog({ countId, number, kind }: { countId: string; number: number; kind: keyof typeof KINDS }) {
  const [open, setOpen] = useState(false);
  const copy = KINDS[kind];
  const Icon = copy.icon;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={copy.title(number)}
      description={copy.description}
      trigger={
        <Button variant={kind === "approve" ? "primary" : "secondary"}>
          <Icon className="size-4" aria-hidden /> {copy.button}
        </Button>
      }
    >
      <ReasonForm countId={countId} kind={kind} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

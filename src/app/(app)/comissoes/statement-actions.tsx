"use client";

import { useState } from "react";
import { useFormAction } from "@/components/ui/use-form-action";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/feedback";
import type { ActionState } from "@/lib/action-state";
import { approveStatementAction, payStatementAction, cancelStatementAction } from "@/app/(app)/comissoes/actions";

function ApproveForm({ statementId, onDone }: { statementId: string; onDone: () => void }) {
  const [state, action] = useFormAction(approveStatementAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title="Aprovar apuração" description="Tem certeza de que deseja aprovar esta apuração?">
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={statementId} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Aprovar</SubmitButton></div>
      </form>
    </Dialog>
  );
}

function PayForm({ statementId, onDone }: { statementId: string; onDone: () => void }) {
  const [state, action] = useFormAction(payStatementAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title="Registrar pagamento" description="Informe a referência do pagamento externo.">
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={statementId} />
        <Field label="Referência do pagamento" required error={state.fieldErrors?.paymentReference}>
          {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <Input id={id} name="paymentReference" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Registrar pagamento</SubmitButton></div>
      </form>
    </Dialog>
  );
}

function CancelForm({ statementId, onDone }: { statementId: string; onDone: () => void }) {
  const [state, action] = useFormAction(cancelStatementAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title="Cancelar apuração" description="Informe o motivo do cancelamento.">
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={statementId} />
        <Field label="Motivo" required error={state.fieldErrors?.reason}>
          {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <Input id={id} name="reason" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton variant="danger">Cancelar apuração</SubmitButton></div>
      </form>
    </Dialog>
  );
}

type Props = {
  statementId: string;
  status: string;
  canApprove: boolean;
  canPay: boolean;
  canCancel: boolean;
};

export function StatementActions({ statementId, status, canApprove, canPay, canCancel }: Props) {
  const [mode, setMode] = useState<"approve" | "pay" | "cancel" | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {canApprove && status === "calculated" && <Button size="sm" onClick={() => setMode("approve")}>Aprovar</Button>}
      {canPay && status === "approved" && <Button size="sm" onClick={() => setMode("pay")}>Pagar</Button>}
      {canCancel && (status === "calculated" || status === "approved") && <Button variant="danger" size="sm" onClick={() => setMode("cancel")}>Cancelar</Button>}
      {mode === "approve" && <ApproveForm statementId={statementId} onDone={() => setMode(null)} />}
      {mode === "pay" && <PayForm statementId={statementId} onDone={() => setMode(null)} />}
      {mode === "cancel" && <CancelForm statementId={statementId} onDone={() => setMode(null)} />}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useFormAction } from "@/components/ui/use-form-action";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/feedback";
import type { ActionState } from "@/lib/action-state";
import { payExpenseAction, cancelExpenseAction } from "@/app/(app)/despesas/actions";

function PayForm({ expenseId, onDone }: { expenseId: string; onDone: () => void }) {
  const [state, action] = useFormAction(payExpenseAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title="Pagar despesa" description="Informe a data do pagamento.">
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={expenseId} />
        <Field label="Data do pagamento" required error={state.fieldErrors?.paidOn}>
          {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <Input id={id} name="paidOn" type="date" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Pagar</SubmitButton></div>
      </form>
    </Dialog>
  );
}

function CancelForm({ expenseId, onDone }: { expenseId: string; onDone: () => void }) {
  const [state, action] = useFormAction(cancelExpenseAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title="Cancelar despesa" description="Informe o motivo do cancelamento.">
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={expenseId} />
        <Field label="Motivo" required error={state.fieldErrors?.reason}>
          {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <Input id={id} name="reason" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} />}
        </Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton variant="danger">Cancelar despesa</SubmitButton></div>
      </form>
    </Dialog>
  );
}

export function ExpenseActions({ expenseId, status }: { expenseId: string; status: string }) {
  const [mode, setMode] = useState<"pay" | "cancel" | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {status === "open" && <Button size="sm" onClick={() => setMode("pay")}>Pagar</Button>}
      {(status === "open" || status === "paid") && <Button variant="danger" size="sm" onClick={() => setMode("cancel")}>Cancelar</Button>}
      {mode === "pay" && <PayForm expenseId={expenseId} onDone={() => { setMode(null); }} />}
      {mode === "cancel" && <CancelForm expenseId={expenseId} onDone={() => { setMode(null); }} />}
    </div>
  );
}

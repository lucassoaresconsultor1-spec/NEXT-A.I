"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea, Select } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";

type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;
type RegisterChoice = { id: string; name: string };

export function OpenCashForm({ action, registers, idempotencyKey }: { action: FormAction; registers: RegisterChoice[]; idempotencyKey: string }) {
  const [state, formAction] = useFormAction(action);
  return <form action={formAction} className="grid gap-4 sm:max-w-xl">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <Field label="Caixa" error={state.fieldErrors?.registerId} required>{(props) => <Select {...props} name="registerId" required defaultValue=""><option value="" disabled>Selecione um caixa</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</Select>}</Field>
    <Field label="Troco inicial" error={state.fieldErrors?.openingAmount} hint="Digite o valor em reais, por exemplo 100,00." required>{(props) => <div className="flex items-center gap-2"><span aria-hidden>R$</span><Input {...props} name="openingAmount" inputMode="decimal" placeholder="0,00" required autoFocus /></div>}</Field>
    <SubmitButton pendingLabel="Abrindo…">Abrir caixa</SubmitButton>
  </form>;
}

function MovementForm({ type, sessionId, action, idempotencyKey, done }: { type: "supply" | "withdrawal"; sessionId: string; action: FormAction; idempotencyKey: string; done: () => void }) {
  const [state, formAction] = useFormAction(action, done);
  return <form action={formAction} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="sessionId" value={sessionId} /><input type="hidden" name="type" value={type} /><input type="hidden" name="idempotencyKey" value={idempotencyKey} />
    <Field label="Valor" error={state.fieldErrors?.amount} required>{(props) => <div className="flex items-center gap-2"><span aria-hidden>R$</span><Input {...props} name="amount" inputMode="decimal" placeholder="0,00" required autoFocus /></div>}</Field>
    <Field label="Motivo" error={state.fieldErrors?.reason} required>{(props) => <Textarea {...props} name="reason" minLength={3} maxLength={240} required />}</Field>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={done}>Cancelar</Button><SubmitButton pendingLabel="Registrando…">Registrar {type === "supply" ? "suprimento" : "sangria"}</SubmitButton></div>
  </form>;
}

export function CashMovementDialogs({ sessionId, action }: { sessionId: string; action: FormAction }) {
  const [openType, setOpenType] = useState<"supply" | "withdrawal" | null>(null);
  const [keys, setKeys] = useState<{ supply?: string; withdrawal?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  return <div className="space-y-2">{notice ? <Notice tone="success" title={notice} /> : null}<div className="flex flex-wrap gap-2">{(["supply", "withdrawal"] as const).map((kind) => {
    const Icon = kind === "supply" ? ArrowDownToLine : ArrowUpFromLine;
    const label = kind === "supply" ? "Suprimento" : "Sangria";
    return <Dialog key={kind} open={openType === kind} onOpenChange={(value) => { if (value) { setKeys((previous) => ({ ...previous, [kind]: crypto.randomUUID() })); setOpenType(kind); } else setOpenType(null); }} title={label} trigger={<Button variant="secondary"><Icon className="size-4" aria-hidden />{label}</Button>}>{openType === kind && keys[kind] ? <MovementForm key={keys[kind]} type={kind} sessionId={sessionId} action={action} idempotencyKey={keys[kind]} done={() => { setNotice(kind === "supply" ? "Suprimento registrado." : "Sangria registrada."); setOpenType(null); }} /> : null}</Dialog>;
  })}</div></div>;
}



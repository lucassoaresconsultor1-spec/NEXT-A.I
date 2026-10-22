"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { assignAction, createDeviceAction, renewCodeAction, revokeDeviceAction, setPinAction } from "./actions";

type State = { status: string; message?: string; fieldErrors?: Record<string, string[]>; code?: string };

function StateNotice({ state }: { state: State }) {
  if (!state.message || state.status === "idle") return null;
  return <Notice tone={state.status === "error" ? "error" : "success"} title={state.message} />;
}

/** The pairing code exists only in this action response; it is not kept anywhere in the page. */
function PairingCode({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <Notice tone="info" title="Código de pareamento">
      <span className="block font-mono text-2xl tracking-widest">{code}</span>
      <span className="block text-xs">Digite no tablet em até 10 minutos. Ele não será mostrado de novo.</span>
    </Notice>
  );
}

function AssignForm({ entryId, salespeople, onDone }: { entryId: string; salespeople: { id: string; name: string }[]; onDone: () => void }) {
  const [state, action] = useFormAction(assignAction, onDone);
  return (
    <form action={action} className="space-y-3" noValidate>
      <StateNotice state={state} />
      <input type="hidden" name="entryId" value={entryId} />
      <Field label="Vendedor" required>
        {(props) => <Select {...props} name="salespersonId" required>{salespeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</Select>}
      </Field>
      <Field label="Motivo" error={state.fieldErrors?.reason} required>{(props) => <Textarea {...props} name="reason" maxLength={240} required />}</Field>
      <SubmitButton pendingLabel="Atribuindo…">Atribuir</SubmitButton>
    </form>
  );
}

export function AssignDialog({ entryId, ticket, salespeople }: { entryId: string; ticket: number; salespeople: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} title={`Atribuir a senha ${ticket}`} description="Fora do rodízio; o motivo fica registrado." trigger={<Button variant="secondary" size="sm">Atribuir</Button>}>
      <AssignForm entryId={entryId} salespeople={salespeople} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

export function CreateDeviceForm({ storeId }: { storeId: string }) {
  const [state, action] = useFormAction(createDeviceAction);
  const current = state as State;
  return (
    <form action={action} className="space-y-3" noValidate>
      <StateNotice state={current} />
      <PairingCode code={current.code} />
      <input type="hidden" name="storeId" value={storeId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nome do tablet" error={current.fieldErrors?.name} required className="min-w-56 flex-1">
          {(props) => <Input {...props} name="name" maxLength={60} placeholder="Entrada principal" required />}
        </Field>
        <SubmitButton pendingLabel="Cadastrando…">Cadastrar tablet</SubmitButton>
      </div>
    </form>
  );
}

export function DeviceActions({ deviceId, name, pending }: { deviceId: string; name: string; pending: boolean }) {
  const [renewState, renew] = useFormAction(renewCodeAction);
  const [open, setOpen] = useState(false);
  const [revokeState, revoke] = useFormAction(revokeDeviceAction, () => setOpen(false));
  const renewed = renewState as State;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {pending ? (
        <form action={renew}>
          <input type="hidden" name="deviceId" value={deviceId} />
          <SubmitButton variant="secondary" pendingLabel="Gerando…">Novo código</SubmitButton>
        </form>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen} title={`Revogar ${name}?`} description="O tablet perde o acesso na hora e precisa ser pareado de novo." trigger={<Button variant="ghost" size="sm">Revogar</Button>}>
        <form action={revoke} className="space-y-3">
          <StateNotice state={revokeState} />
          <input type="hidden" name="deviceId" value={deviceId} />
          <SubmitButton variant="danger" pendingLabel="Revogando…">Revogar tablet</SubmitButton>
        </form>
      </Dialog>
      {renewed.status === "error" || renewed.code ? (
        <div className="w-full">
          {renewed.status === "error" ? <StateNotice state={renewed} /> : null}
          <PairingCode code={renewed.code} />
        </div>
      ) : null}
    </div>
  );
}

export function PinForm() {
  const [state, action] = useFormAction(setPinAction);
  return (
    <form action={action} className="space-y-3" noValidate>
      <StateNotice state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Novo PIN" error={state.fieldErrors?.pin} required>
          {(props) => <Input {...props} name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} className="w-40 text-center font-mono" required />}
        </Field>
        <SubmitButton pendingLabel="Salvando…">Salvar PIN</SubmitButton>
      </div>
    </form>
  );
}

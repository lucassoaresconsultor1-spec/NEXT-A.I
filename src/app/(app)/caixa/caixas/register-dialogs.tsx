"use client";

import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";

type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;
type Register = { id: string; storeId: string; storeName: string; name: string; isActive: boolean; openSession: { openedByName: string | null; openedAt: Date | null } | null };
type Store = { id: string; name: string };

function RegisterForm({ action, row, stores, done }: { action: FormAction; row?: Register; stores: Store[]; done: () => void }) {
  const [state, formAction] = useFormAction(action, done);
  return <form action={formAction} className="space-y-4">{state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}{row ? <input type="hidden" name="id" value={row.id} /> : <Field label="Loja" required>{(props) => <Select {...props} name="storeId" required defaultValue="">{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</Field>}<Field label="Nome do caixa" error={state.fieldErrors?.name} hint="Use de 2 a 60 caracteres." required>{(props) => <Input {...props} name="name" defaultValue={row?.name} minLength={2} maxLength={60} required autoFocus />}</Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={done}>Cancelar</Button><SubmitButton>Salvar</SubmitButton></div></form>;
}

export function RegisterFormDialog({ action, stores, row }: { action: FormAction; stores: Store[]; row?: Register }) {
  const [open, setOpen] = useState(false);
  const title = row ? "Renomear caixa" : "Novo caixa";
  return <Dialog open={open} onOpenChange={setOpen} title={title} trigger={row ? <Button variant="ghost" size="sm" aria-label={`Renomear caixa ${row.name}`}><Pencil className="size-4" aria-hidden />Renomear</Button> : <Button><Plus className="size-4" aria-hidden />Novo caixa</Button>}><RegisterForm action={action} stores={stores} row={row} done={() => setOpen(false)} /></Dialog>;
}

function StatusForm({ action, row, done }: { action: FormAction; row: Register; done: () => void }) {
  const [state, formAction] = useFormAction(action, done);
  const active = !row.isActive;
  return <form action={formAction} className="space-y-4">{state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}<input type="hidden" name="id" value={row.id} /><input type="hidden" name="active" value={String(active)} /><p className="text-sm text-ink-muted">{active ? "O caixa ficará disponível para abertura." : "O caixa não poderá receber novas sessões."}</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={done}>Cancelar</Button><SubmitButton variant={active ? "primary" : "danger"}>{active ? "Ativar caixa" : "Desativar caixa"}</SubmitButton></div></form>;
}

export function RegisterStatusDialog({ action, row }: { action: FormAction; row: Register }) {
  const [open, setOpen] = useState(false);
  const active = !row.isActive;
  const Icon = active ? Power : PowerOff;
  const verb = active ? "Ativar" : "Desativar";
  return <Dialog open={open} onOpenChange={setOpen} title={`${verb} caixa ${row.name}?`} trigger={<Button variant="ghost" size="sm" aria-label={`${verb} caixa ${row.name}`}><Icon className="size-4" aria-hidden />{verb}</Button>}><StatusForm action={action} row={row} done={() => setOpen(false)} /></Dialog>;
}



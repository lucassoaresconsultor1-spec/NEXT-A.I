"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";

type StoreOption = { id: string; name: string };
type Holiday = { id: string; day: string; name: string; kind: "holiday" | "optional"; closed: boolean; storeId: string | null; storeName: string };
type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

function HolidayForm({ stores, organizationWide, holiday, action, onDone }: { stores: StoreOption[]; organizationWide: boolean; holiday?: Holiday; action: FormAction; onDone: () => void }) {
  const [state, formAction] = useFormAction(action, onDone);
  return <form action={formAction} className="space-y-4" noValidate>
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="id" value={holiday?.id ?? ""} />
    <Field label="Data" error={state.fieldErrors?.day} required>{(props) => <Input {...props} name="day" type="date" defaultValue={holiday?.day} required />}</Field>
    <Field label="Nome" error={state.fieldErrors?.name} required>{(props) => <Input {...props} name="name" defaultValue={holiday?.name} maxLength={80} required />}</Field>
    <Field label="Tipo" error={state.fieldErrors?.kind} required>{(props) => <Select {...props} name="kind" defaultValue={holiday?.kind ?? "holiday"}><option value="holiday">Feriado</option><option value="optional">Ponto facultativo</option></Select>}</Field>
    <Field label="Loja" hint="Empresa aplica a data a todas as lojas." error={state.fieldErrors?.storeId}>
      {(props) => <Select {...props} name="storeId" defaultValue={holiday?.storeId ?? ""}><option value="">{organizationWide ? "Empresa" : "Selecione uma loja"}</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}
    </Field>
    <Checkbox name="closed" defaultChecked={holiday?.closed ?? true} label="A loja fecha neste dia" />
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Salvar</SubmitButton></div>
  </form>;
}

function AddHoliday({ stores, canCreateOrganizationWide, action }: { stores: StoreOption[]; canCreateOrganizationWide: boolean; action: FormAction }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title="Adicionar data" description="Cadastre um feriado ou ponto facultativo." trigger={<Button onClick={() => setOpen(true)}>Adicionar data</Button>}>
    {open ? <HolidayForm stores={stores} organizationWide={canCreateOrganizationWide} action={action} onDone={() => setOpen(false)} /> : null}
  </Dialog>;
}

function EditHoliday({ holiday, stores, canCreateOrganizationWide, action }: { holiday: Holiday; stores: StoreOption[]; canCreateOrganizationWide: boolean; action: FormAction }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title="Editar data" description={`${holiday.storeName} · ${holiday.day}`} trigger={<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Editar</Button>}>
    {open ? <HolidayForm stores={stores} organizationWide={canCreateOrganizationWide} holiday={holiday} action={action} onDone={() => setOpen(false)} /> : null}
  </Dialog>;
}

function DeleteHoliday({ holiday, action }: { holiday: Holiday; action: FormAction }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormAction(action, () => setOpen(false));
  return <Dialog open={open} onOpenChange={setOpen} title="Excluir data" description="A data será removida do calendário." trigger={<Button size="sm" variant="danger" onClick={() => setOpen(true)}>Excluir</Button>}>
    {open ? <form action={formAction} className="space-y-4"><input type="hidden" name="id" value={holiday.id} /><p className="text-sm text-ink">Excluir esta data do calendário?</p>{state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button><SubmitButton variant="danger">Excluir</SubmitButton></div></form> : null}
  </Dialog>;
}

export function HolidayDialogs({ stores, canCreateOrganizationWide, holiday, saveAction, deleteAction }: { stores: StoreOption[]; canCreateOrganizationWide: boolean; holiday?: Holiday; saveAction: FormAction; deleteAction: FormAction }) {
  if (!holiday) return <AddHoliday stores={stores} canCreateOrganizationWide={canCreateOrganizationWide} action={saveAction} />;
  return <div className="flex gap-2"><EditHoliday holiday={holiday} stores={stores} canCreateOrganizationWide={canCreateOrganizationWide} action={saveAction} /><DeleteHoliday holiday={holiday} action={deleteAction} /></div>;
}

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

export function WorkWeekForm({ storeId, weekdays, action }: { storeId: string; weekdays: number[]; action: FormAction }) {
  const [state, formAction] = useFormAction(action);
  return <form action={formAction} className="space-y-4">
    <input type="hidden" name="storeId" value={storeId} />
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium text-ink">Dias de trabalho</legend>
      {WEEKDAYS.map((day, index) => <Checkbox key={day} name="weekdays" value={index} defaultChecked={weekdays.includes(index)} label={day} />)}
    </fieldset>
    {state.fieldErrors?.weekdays ? <p role="alert" className="text-sm text-critical">{state.fieldErrors.weekdays[0]}</p> : null}
    {state.status === "success" && state.message ? <Notice tone="success" title={state.message} /> : null}
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <SubmitButton>Salvar</SubmitButton>
  </form>;
}

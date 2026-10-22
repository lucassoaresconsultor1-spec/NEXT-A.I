"use client";

import { Pencil, Power, PowerOff, CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { setSalespersonActiveAction, setScheduleAction, saveSalespersonAction } from "./actions";

export interface SalespersonRow {
  id: string;
  code: string;
  nickname: string;
  isActive: boolean;
  membershipId: string;
  userId: string;
  name: string;
  storeIds: string[];
  stores: { id: string; name: string }[];
}

interface StoreOption { id: string; label: string }

function EditForm({ row, options, onDone }: { row: SalespersonRow; options: StoreOption[]; onDone: () => void }) {
  const [state, action] = useFormAction(saveSalespersonAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={row.id} /><input type="hidden" name="membershipId" value={row.membershipId} />
      <Field label="Membro">{(props) => <Input {...props} value={row.name} disabled />}</Field>
      <Field label="Código" required error={state.fieldErrors?.code}>{(props) => <Input {...props} name="code" defaultValue={row.code} maxLength={10} required />}</Field>
      <Field label="Nome de exibição" required error={state.fieldErrors?.nickname}>{(props) => <Input {...props} name="nickname" defaultValue={row.nickname} minLength={2} maxLength={40} required />}</Field>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">Lojas vinculadas</legend>
        {state.fieldErrors?.storeIds?.length ? <p role="alert" className="text-sm text-critical">{state.fieldErrors.storeIds[0]}</p> : null}
        <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
          {options.map((store) => <label key={store.id} className="flex items-start gap-2 text-sm"><input className="mt-0.5 size-4 accent-brand" type="checkbox" name="storeIds" value={store.id} defaultChecked={row.storeIds.includes(store.id)} /><span>{store.label}</span></label>)}
        </div>
        {row.storeIds.some((id) => !options.some((store) => store.id === id)) ? <p className="text-xs text-ink-muted">Vínculos fora do seu escopo são preservados pelo serviço.</p> : null}
      </fieldset>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Salvar</SubmitButton></div>
    </form>
  );
}

function EditDialog({ row, stores }: { row: SalespersonRow; stores: StoreOption[] }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title={`Editar ${row.nickname}`} description="O membro vinculado ao vendedor não pode ser trocado." trigger={<Button variant="secondary" size="sm"><Pencil className="size-4" aria-hidden /> Editar</Button>}><EditForm key={open ? "open" : "closed"} row={row} options={stores} onDone={() => setOpen(false)} /></Dialog>;
}

function StatusForm({ row, onDone }: { row: SalespersonRow; onDone: () => void }) {
  const [state, action] = useFormAction(setSalespersonActiveAction, onDone);
  const activating = !row.isActive;
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="id" value={row.id} /><input type="hidden" name="active" value={String(activating)} />
    <p className="text-sm text-ink-soft">{activating ? "O vendedor poderá voltar a ser selecionado nas operações da loja." : "O vendedor deixará de poder ser selecionado em novas operações. O histórico será mantido."}</p>
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton variant={activating ? "primary" : "danger"}>{activating ? "Ativar" : "Desativar"}</SubmitButton></div>
  </form>;
}

function StatusDialog({ row }: { row: SalespersonRow }) {
  const [open, setOpen] = useState(false);
  const activating = !row.isActive;
  return <Dialog open={open} onOpenChange={setOpen} title={`${activating ? "Ativar" : "Desativar"} ${row.nickname}?`} description="Confirme a alteração da situação do vendedor." trigger={<Button variant="secondary" size="sm">{activating ? <Power className="size-4" aria-hidden /> : <PowerOff className="size-4" aria-hidden />}{activating ? "Ativar" : "Desativar"}</Button>}><StatusForm key={open ? "open" : "closed"} row={row} onDone={() => setOpen(false)} /></Dialog>;
}

function ScheduleForm({ row, stores, defaultMonth, onDone }: { row: SalespersonRow; stores: StoreOption[]; defaultMonth: string; onDone: () => void }) {
  const [state, action] = useFormAction(setScheduleAction, onDone);
  const [month, setMonth] = useState(defaultMonth);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => new Set());
  const [year, monthNumber] = month.split("-").map(Number);
  const days = year && monthNumber ? new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() : 0;
  const dates = Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="salespersonId" value={row.id} />
    <Field label="Loja" required error={state.fieldErrors?.storeId}>{(props) => <select {...props} name="storeId" required className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm">{stores.map((store) => <option key={store.id} value={store.id}>{store.label}</option>)}</select>}</Field>
    <Field label="Mês" required error={state.fieldErrors?.month}>{(props) => <Input {...props} type="month" name="month" value={month} onChange={(event) => { setMonth(event.target.value); setSelectedDays(new Set()); }} required />}</Field>
    <fieldset className="space-y-2"><legend className="text-sm font-medium">Dias de folga</legend>
      <p className="text-xs text-ink-muted">Marque todas as folgas do mês. Salvar substitui as folgas atuais dessa loja e desse mês.</p>
      {dates.length ? <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-7">
        {dates.map((date, index) => <label key={date} className="flex items-center gap-1.5 rounded px-1 py-1 text-sm hover:bg-canvas"><input type="checkbox" name="daysOff" value={date} checked={selectedDays.has(date)} onChange={(event) => setSelectedDays((current) => { const next = new Set(current); if (event.target.checked) next.add(date); else next.delete(date); return next; })} className="size-4 accent-brand" /><span>{String(index + 1).padStart(2, "0")}</span></label>)}
      </div> : <p role="status" className="text-sm text-ink-muted">Escolha um mês válido.</p>}
      {state.fieldErrors?.daysOff?.length ? <p role="alert" className="text-sm text-critical">{state.fieldErrors.daysOff[0]}</p> : null}
    </fieldset>
    {selectedDays.size === 0 ? <p className="text-xs text-ink-muted">Nenhum dia de folga informado neste mês.</p> : null}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton>Salvar escala</SubmitButton></div>
  </form>;
}

function ScheduleDialog({ row, stores, defaultMonth }: { row: SalespersonRow; stores: StoreOption[]; defaultMonth: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title={`Escala de ${row.nickname}`} description="Defina os dias de folga do vendedor para uma loja e um mês." trigger={<Button variant="secondary" size="sm"><CalendarDays className="size-4" aria-hidden /> Escala</Button>}><ScheduleForm key={open ? "open" : "closed"} row={row} stores={stores} defaultMonth={defaultMonth} onDone={() => setOpen(false)} /></Dialog>;
}

export function SalespeopleManager({ row, stores, defaultMonth }: { row: SalespersonRow; stores: StoreOption[]; defaultMonth: string }) {
  return <div className="flex flex-wrap gap-2">{stores.length ? <EditDialog row={row} stores={stores} /> : null}<StatusDialog row={row} />{row.stores.length ? <ScheduleDialog row={row} stores={row.stores.map((store) => ({ id: store.id, label: store.name }))} defaultMonth={defaultMonth} /> : null}</div>;
}

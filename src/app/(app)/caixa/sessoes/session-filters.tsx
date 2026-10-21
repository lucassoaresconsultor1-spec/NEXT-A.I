"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";

type Store = { id: string; code: string; name: string };
type Register = { id: string; name: string };
export function SessionFilters({ stores, registers, values }: { stores: Store[]; registers: Register[]; values: { storeId: string; registerId: string; status: string; from: string; to: string } }) {
  const router = useRouter();
  return <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const query = new URLSearchParams(); for (const key of ["loja", "caixa", "situacao", "de", "ate"] as const) { const value = String(form.get(key) ?? ""); if (value) query.set(key, value); } router.push(`/caixa/sessoes${query.size ? `?${query}` : ""}`); }}>
    <Field label="Loja">{(props) => <Select {...props} name="loja" defaultValue={values.storeId}><option value="">Todas</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</Field>
    <Field label="Caixa">{(props) => <Select {...props} name="caixa" defaultValue={values.registerId}><option value="">Todos</option>{registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</Select>}</Field>
    <Field label="Situação">{(props) => <Select {...props} name="situacao" defaultValue={values.status}><option value="">Todas</option><option value="aberta">Aberta</option><option value="fechada">Fechada</option></Select>}</Field>
    <Field label="De">{(props) => <Input {...props} name="de" type="date" defaultValue={values.from} />}</Field>
    <Field label="Até">{(props) => <Input {...props} name="ate" type="date" defaultValue={values.to} />}</Field>
    <Button type="submit" variant="secondary" className="self-end">Aplicar filtros</Button>
  </form>;
}

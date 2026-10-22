"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { TargetScope } from "@/server/targets/schemas";
import { TARGET_SCOPE_LABELS } from "@/server/targets/schemas";
import { setTargetAction } from "./actions";

interface RegionOption { id: string; name: string }
interface StoreOption { id: string; name: string }
interface PersonOption { id: string; code: string; nickname: string; name: string; storeIds: string[] }

export function TargetForm({ scopes, regions, stores, people, month }: { scopes: TargetScope[]; regions: RegionOption[]; stores: StoreOption[]; people: PersonOption[]; month: string }) {
  const [state, action] = useFormAction(setTargetAction);
  const [scope, setScope] = useState<TargetScope>(scopes[0] ?? "store");
  const [storeId, setStoreId] = useState("");
  const eligiblePeople = people.filter((person) => person.storeIds.includes(storeId));
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    {state.status === "success" ? <Notice tone="success" title={state.message} /> : null}
    <Card className="space-y-5 p-5">
      <Field label="Escopo" required error={state.fieldErrors?.scope}>{(props) => <Select {...props} name="scope" value={scope} onChange={(event) => { setScope(event.target.value as TargetScope); setStoreId(""); }} required>{scopes.map((value) => <option key={value} value={value}>{TARGET_SCOPE_LABELS[value]}</option>)}</Select>}</Field>
      {scope === "region" ? <Field label="Região" required error={state.fieldErrors?.regionId}>{(props) => <Select {...props} name="regionId" required defaultValue=""><option value="" disabled>Selecione uma região</option>{regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</Select>}</Field> : null}
      {scope === "store" || scope === "salesperson" ? <Field label="Loja" required error={state.fieldErrors?.storeId}>{(props) => <Select {...props} name="storeId" required value={storeId} onChange={(event) => setStoreId(event.target.value)}><option value="" disabled>Selecione uma loja</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</Select>}</Field> : null}
      {scope === "salesperson" ? <Field label="Vendedor" required error={state.fieldErrors?.salespersonId}>{(props) => <Select {...props} name="salespersonId" required defaultValue=""><option value="" disabled>{storeId ? "Selecione um vendedor da loja" : "Selecione primeiro a loja"}</option>{eligiblePeople.map((person) => <option key={person.id} value={person.id}>{person.nickname} · {person.code}</option>)}</Select>}</Field> : null}
      <Field label="Mês" required error={state.fieldErrors?.month}>{(props) => <Input {...props} type="month" name="month" defaultValue={month} required />}</Field>
      <Field label="Valor da meta (R$)" required error={state.fieldErrors?.amountReais} hint="Informe reais e centavos, por exemplo 12.500,00.">{(props) => <Input {...props} name="amountReais" inputMode="decimal" autoComplete="off" placeholder="0,00" required />}</Field>
      <Field label="Motivo da alteração" error={state.fieldErrors?.reason} hint="Obrigatório ao criar uma nova versão para uma meta já existente.">{(props) => <Textarea {...props} name="reason" maxLength={240} rows={3} />}</Field>
    </Card>
    <div className="flex justify-end gap-2"><Button type="reset" variant="secondary" onClick={() => { setScope(scopes[0] ?? "store"); setStoreId(""); }}>Limpar</Button><SubmitButton>Salvar</SubmitButton></div>
  </form>;
}

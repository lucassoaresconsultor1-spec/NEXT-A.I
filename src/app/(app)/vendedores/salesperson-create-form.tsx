"use client";

import Link from "next/link";
import { Button, LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { Field, Input } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { saveSalespersonAction } from "./actions";

interface Candidate { id: string; name: string; scope: string }
interface StoreOption { id: string; label: string }

export function SalespersonCreateForm({ candidates, stores }: { candidates: Candidate[]; stores: StoreOption[] }) {
  const [state, action] = useFormAction(saveSalespersonAction);
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    {state.status === "success" ? <Notice tone="success" title={state.message}><Link href="/vendedores" className="font-medium underline">Voltar para vendedores</Link></Notice> : null}
    <Card className="space-y-5 p-5">
      <Field label="Membro" required error={state.fieldErrors?.membershipId} hint="São exibidos membros ativos do seu escopo que você pode gerenciar.">{(props) => <select {...props} name="membershipId" required defaultValue="" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="" disabled>Selecione um membro</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.scope}</option>)}</select>}</Field>
      {!candidates.length ? <Notice tone="info" title="Nenhum membro disponível"><span>Verifique se há membros ativos de nível inferior com acesso ao seu escopo de lojas.</span></Notice> : null}
      <Field label="Código" required error={state.fieldErrors?.code} hint="De 1 a 10 letras sem acento ou números.">{(props) => <Input {...props} name="code" maxLength={10} autoComplete="off" required />}</Field>
      <Field label="Nome de exibição" required error={state.fieldErrors?.nickname}>{(props) => <Input {...props} name="nickname" minLength={2} maxLength={40} required />}</Field>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">Lojas vinculadas <span className="text-critical" aria-hidden>*</span></legend>
        {state.fieldErrors?.storeIds?.length ? <p role="alert" className="text-sm text-critical">{state.fieldErrors.storeIds[0]}</p> : null}
        <p className="text-xs text-ink-muted">O membro precisa ter acesso a cada loja escolhida.</p>
        <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border border-line p-3 sm:grid-cols-2">
          {stores.map((store) => <label key={store.id} className="flex items-start gap-2 text-sm"><input type="checkbox" name="storeIds" value={store.id} className="mt-0.5 size-4 accent-brand" /><span>{store.label}</span></label>)}
        </div>
        {!stores.length ? <p className="text-sm text-ink-muted">Nenhuma loja acessível encontrada.</p> : null}
      </fieldset>
    </Card>
    <div className="flex justify-end gap-2"><LinkButton href="/vendedores" variant="secondary">Cancelar</LinkButton><Button type="submit" disabled={!candidates.length || !stores.length}>Salvar vendedor</Button></div>
  </form>;
}

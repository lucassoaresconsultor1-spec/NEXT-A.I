"use client";

import { useState } from "react";
import { useFormAction } from "@/components/ui/use-form-action";
import { createRuleAction } from "@/app/(app)/comissoes/actions";
import type { ActionState } from "@/lib/action-state";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Field, SubmitButton } from "@/components/ui/form";


export default function NewRulePage() {
  const [state, formAction] = useFormAction(createRuleAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>);
  const [categories, setCategories] = useState<{ categoryId: string; rateBps: string }[]>([]);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Comissões" }, { label: "Nova regra" }]} />
      <PageHeader title="Nova regra de comissão" description="Defina a taxa padrão e taxas por categoria com data de início de vigência." />
      <Card>
        <CardBody>
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message ? <p className="text-xs font-medium text-critical">{state.message}</p> : null}
            <div className="space-y-1.5">
              <label htmlFor="storeId" className="block text-sm font-medium text-ink">Loja (opcional, empresa se vazio)</label>
              <select id="storeId" name="storeId" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Empresa</option></select>
            </div>
            <Field label="Início da vigência" required>
              {({ id }) => <input id={id} type="date" name="effectiveFrom" required className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Taxa padrão (pontos-base, 1% = 100)" required hint="Exemplo: 100 = 1%, 500 = 5%">
              {({ id }) => <input id={id} type="number" name="defaultRateBps" min="0" max="10000" step="1" required className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Taxas por categoria">
              {() => (
                <div className="space-y-2">
                  {categories.map((entry, index) => (
                    <div key={index} className="flex gap-2">
                      <input type="hidden" name={`categoryRates[${index}].categoryId`} value={entry.categoryId} />
                      <input type="number" name={`categoryRates[${index}].rateBps`} min="0" max="10000" step="1" placeholder="Taxa (pb)" className="flex-1 block h-10 rounded-md border border-line-strong bg-surface px-3 text-sm" />
                      <button type="button" onClick={() => setCategories(categories.filter((_, i) => i !== index))} className="text-critical hover:bg-critical/10 rounded px-2 py-1">Remover</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCategories([...categories, { categoryId: "", rateBps: "" }])} className="text-sm text-brand hover:bg-brand/10 rounded px-2 py-1">Adicionar categoria</button>
                </div>
              )}
            </Field>
            <Field label="Motivo (obrigatório para nova versão)">
              {({ id }) => <textarea id={id} name="reason" rows={3} className="block h-24 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <SubmitButton pendingLabel="Criando…">Criar regra</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

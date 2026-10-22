"use client";

import { useFormAction } from "@/components/ui/use-form-action";
import { saveExpenseAction } from "@/app/(app)/despesas/actions";
import type { ActionState } from "@/lib/action-state";
import { Field, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";

export default function NewExpenseForm({ stores, categories }: { stores: { id: string; name: string }[]; categories: { id: string; name: string; isActive: boolean }[] }) {
  const [state, formAction] = useFormAction(saveExpenseAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Despesas", href: "/despesas" }, { label: "Nova despesa" }]} />
      <PageHeader title="Nova despesa" description="Lançamento de despesa por competência, em centavos." />
      <Card>
        <CardBody>
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message ? <p className="text-xs font-medium text-critical">{state.message}</p> : null}
            <Field label="Loja" required error={state.fieldErrors?.storeId}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <select id={id} name="storeId" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Selecione a loja</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>}
            </Field>
            <Field label="Categoria" required error={state.fieldErrors?.categoryId}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <select id={id} name="categoryId" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Selecione a categoria</option>{categories.filter((c) => c.isActive).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>}
            </Field>
            <Field label="Data de competência" required error={state.fieldErrors?.competenceDate}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="competenceDate" type="date" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Descrição" required error={state.fieldErrors?.description}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="description" minLength={3} maxLength={160} required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Valor (R$)" required hint="Exemplo: 12,90" error={state.fieldErrors?.amountReais}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="amountReais" type="text" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Vencimento (opcional)">
              {({ id }) => <input id={id} name="dueDate" type="date" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <SubmitButton pendingLabel="Criando…">Criar despesa</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

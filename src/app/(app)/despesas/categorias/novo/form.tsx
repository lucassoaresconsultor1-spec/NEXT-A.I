"use client";

import { useFormAction } from "@/components/ui/use-form-action";
import { saveCategoryAction } from "@/app/(app)/despesas/actions";
import type { ActionState } from "@/lib/action-state";
import { Field, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";

export default function NewCategoryForm() {
  const [state, formAction] = useFormAction(saveCategoryAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Despesas", href: "/despesas" }, { label: "Categorias", href: "/despesas/categorias" }, { label: "Nova categoria" }]} />
      <PageHeader title="Nova categoria de despesa" description="Nome da categoria usada para classificar despesas." />
      <Card>
        <CardBody>
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message ? <p className="text-xs font-medium text-critical">{state.message}</p> : null}
            <Field label="Nome" required hint="Máximo 80 caracteres" error={state.fieldErrors?.name}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="name" minLength={2} maxLength={80} required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <SubmitButton pendingLabel="Criando…">Criar categoria</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

"use client";

import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Field, SubmitButton } from "@/components/ui/form";

type ReportAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

interface NewReportFormProps {
  action: ReportAction;
}

export default function NewReportForm({ action }: NewReportFormProps) {
  const [state, formAction] = useFormAction(action);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Relatórios", href: "/relatorios" }, { label: "Novo relatório" }]} />
      <PageHeader title="Novo relatório" description="Escolha o tipo, o período e a loja para gerar um relatório em CSV." />
      <Card>
        <CardBody>
          <form action={formAction} className="space-y-4">
            {state.status === "error" && state.message ? <p className="text-xs font-medium text-critical">{state.message}</p> : null}
            <Field label="Tipo de relatório" required error={state.fieldErrors?.kind}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <select id={id} name="kind" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Selecione o relatório</option><option value="sales_by_period">Vendas por período</option><option value="sales_by_store">Vendas por loja</option><option value="sales_by_salesperson">Vendas por vendedor</option><option value="expenses">Despesas</option><option value="daily_closings">Fechamentos diários</option></select>}
            </Field>
            <Field label="Período de" required error={state.fieldErrors?.from}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="from" type="date" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Período até" required error={state.fieldErrors?.to}>
              {({ id, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy }) => <input id={id} name="to" type="date" required aria-invalid={ariaInvalid} aria-describedby={ariaDescribedBy} className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm" />}
            </Field>
            <Field label="Loja (opcional)">
              {({ id }) => <select id={id} name="storeId" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Todas as lojas</option></select>}
            </Field>
            <Field label="Agrupar por">
              {({ id }) => <select id={id} name="groupBy" className="block h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm"><option value="">Sem agrupamento</option><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select>}
            </Field>
            <SubmitButton pendingLabel="Gerando…">Gerar relatório</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

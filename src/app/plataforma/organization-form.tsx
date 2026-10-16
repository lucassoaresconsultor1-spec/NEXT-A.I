"use client";

import { PendingSubmit, submitKeepingValues } from "@/app/(app)/equipe/member-form-parts";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { createOrganizationAction } from "./actions";
import { limits, type PlanOption } from "./plan-dialog";

/** New client company and its owner. Success redirects to the company list with a notice. */
export function OrganizationForm({ plans, defaultPlanKey }: { plans: PlanOption[]; defaultPlanKey: string }) {
  const [state, action, pending] = useFormAction(createOrganizationAction);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="space-y-6" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Empresa</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome da empresa" error={errors.organizationName} required>
            {(props) => <Input {...props} name="organizationName" maxLength={120} autoComplete="off" required />}
          </Field>
          <Field label="CNPJ" error={errors.organizationDocument} hint="Opcional; o dono pode completar depois.">
            {(props) => <Input {...props} name="organizationDocument" inputMode="text" maxLength={18} autoComplete="off" />}
          </Field>
        </div>
        <Field label="Plano" error={errors.planKey} required hint="Pode ser alterado depois na lista de empresas.">
          {(props) => (
            <Select {...props} name="planKey" defaultValue={defaultPlanKey} required className="sm:max-w-md">
              {plans.map((plan) => (
                <option key={plan.key} value={plan.key}>{`${plan.name} — ${limits(plan)}`}</option>
              ))}
            </Select>
          )}
        </Field>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Acesso do dono</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do dono" error={errors.ownerName} required>
            {(props) => <Input {...props} name="ownerName" maxLength={120} autoComplete="off" required />}
          </Field>
          <Field label="E-mail" error={errors.ownerEmail} required hint="É o login do dono. Precisa ser um e-mail sem cadastro.">
            {(props) => <Input {...props} name="ownerEmail" type="email" maxLength={254} autoComplete="off" spellCheck={false} required />}
          </Field>
        </div>
        <Field
          label="Senha provisória"
          error={errors.ownerPassword}
          required
          hint="Mínimo de 10 caracteres. O dono troca no primeiro acesso; envie por um canal seguro."
        >
          {(props) => (
            <Input {...props} name="ownerPassword" type="text" maxLength={128} autoComplete="off" spellCheck={false} required className="sm:max-w-sm" />
          )}
        </Field>
      </fieldset>
      <div className="flex justify-end gap-2">
        <LinkButton href="/plataforma" variant="secondary">
          Cancelar
        </LinkButton>
        <PendingSubmit pending={pending} pendingLabel="Cadastrando…">
          Cadastrar empresa
        </PendingSubmit>
      </div>
    </form>
  );
}

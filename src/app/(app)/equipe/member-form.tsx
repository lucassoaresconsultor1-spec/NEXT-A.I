"use client";

import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { addMemberAction } from "./actions";
import { PendingSubmit, RoleField, submitKeepingValues, type RoleOption } from "./member-form-parts";
import { MemberScopeFields, type ScopeOptions } from "./member-scope-fields";

/** New member form. Success redirects to the member page, which explains the outcome. */
export function MemberForm({ roles, scope }: { roles: RoleOption[]; scope: ScopeOptions }) {
  const [state, action, pending] = useFormAction(addMemberAction);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="space-y-5" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" error={errors.name} required hint="Se o e-mail já tiver cadastro, o nome atual da pessoa é mantido.">
          {(props) => <Input {...props} name="name" maxLength={120} autoComplete="off" required />}
        </Field>
        <Field label="E-mail" error={errors.email} required hint="É o login da pessoa.">
          {(props) => <Input {...props} name="email" type="email" maxLength={254} autoComplete="off" spellCheck={false} required />}
        </Field>
      </div>
      <RoleField roles={roles} error={errors.roleId} />
      <MemberScopeFields options={scope} defaults={{ storeAccess: "stores", regionIds: [], storeIds: [] }} errors={errors} />
      <Field
        label="Senha provisória"
        error={errors.initialPassword}
        hint="Obrigatória apenas para e-mails sem cadastro; a pessoa troca no primeiro acesso. Mínimo de 10 caracteres."
      >
        {(props) => (
          <Input {...props} name="initialPassword" type="text" maxLength={128} autoComplete="off" spellCheck={false} className="sm:max-w-sm" />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <LinkButton href="/equipe" variant="secondary">
          Cancelar
        </LinkButton>
        <PendingSubmit pending={pending} pendingLabel="Adicionando…">
          Adicionar membro
        </PendingSubmit>
      </div>
    </form>
  );
}

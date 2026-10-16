"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { idleState } from "@/lib/action-state";
import { changePasswordAction, signInAction, signUpAction } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, idleState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="E-mail" error={state.fieldErrors?.email} required>
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" required />}
      </Field>
      <Field label="Senha" error={state.fieldErrors?.password} required>
        {(props) => <Input {...props} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <SubmitButton pendingLabel="Entrando…" className="w-full">
        Entrar
      </SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, idleState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Empresa</legend>
        <Field label="Nome da empresa" error={errors.organizationName} required>
          {(props) => <Input {...props} name="organizationName" autoComplete="organization" required />}
        </Field>
        <Field label="CNPJ" error={errors.organizationDocument} hint="Opcional agora; aceita CNPJ numérico ou alfanumérico.">
          {(props) => <Input {...props} name="organizationDocument" inputMode="text" placeholder="00.000.000/0000-00" />}
        </Field>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink">Seu acesso (proprietário)</legend>
        <Field label="Seu nome" error={errors.name} required>
          {(props) => <Input {...props} name="name" autoComplete="name" required />}
        </Field>
        <Field label="E-mail" error={errors.email} required>
          {(props) => <Input {...props} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field label="Senha" error={errors.password} hint="Mínimo de 10 caracteres." required>
          {(props) => <Input {...props} name="password" type="password" autoComplete="new-password" required />}
        </Field>
      </fieldset>
      <SubmitButton pendingLabel="Criando conta…" className="w-full">
        Criar conta da empresa
      </SubmitButton>
      <p className="text-center text-sm text-ink-muted">
        Já tem acesso?{" "}
        <Link href="/entrar" className="font-medium text-brand hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, idleState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <Field label="Senha atual" error={errors.currentPassword} required>
        {(props) => <Input {...props} name="currentPassword" type="password" autoComplete="current-password" required />}
      </Field>
      <Field label="Nova senha" error={errors.newPassword} hint="Mínimo de 10 caracteres." required>
        {(props) => <Input {...props} name="newPassword" type="password" autoComplete="new-password" required />}
      </Field>
      <Field label="Confirme a nova senha" error={errors.confirmPassword} required>
        {(props) => <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required />}
      </Field>
      <SubmitButton className="w-full">Salvar nova senha</SubmitButton>
    </form>
  );
}

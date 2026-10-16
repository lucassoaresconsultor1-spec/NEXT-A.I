"use client";

import { startTransition, type FormEvent } from "react";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { useFormAction } from "@/components/ui/use-form-action";
import { createRoleAction, updateRoleAction } from "./actions";
import { PermissionPicker, type PermissionChoiceGroup } from "./permission-picker";

export interface RoleFormValues {
  id: string;
  name: string;
  description: string | null;
  rank: number;
  permissions: readonly string[];
}

export interface RoleFormOptions {
  maxRank: number;
  groups: PermissionChoiceGroup[];
  /** System role levels shown as reference next to the rank field. */
  rankReference: { name: string; rank: number }[];
}

function rankHint(maxRank: number, reference: RoleFormOptions["rankReference"]) {
  const levels = reference.map((role) => `${role.name} ${role.rank}`).join(", ");
  return `Membros só gerenciam perfis de nível inferior ao seu. Use de 1 a ${maxRank}. Perfis do sistema: ${levels}.`;
}

/**
 * Create (redirects to the new role) and edit (stays on the page) form.
 * The submit handler dispatches the action itself so React does not reset
 * the checkboxes when the server answers with validation errors.
 */
export function RoleForm({ role, options, cancelHref }: { role?: RoleFormValues; options: RoleFormOptions; cancelHref: string }) {
  const [state, action] = useFormAction(role ? updateRoleAction : createRoleAction);

  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} noValidate className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {state.status === "success" && state.message ? <Notice tone="success" title={state.message} /> : null}
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <Card>
        <CardHeader title="Dados do perfil" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" error={state.fieldErrors?.name} required>
            {(props) => <Input {...props} name="name" defaultValue={role?.name} maxLength={80} autoComplete="off" required />}
          </Field>
          <Field label="Nível" error={state.fieldErrors?.rank} hint={rankHint(options.maxRank, options.rankReference)} required>
            {(props) => (
              <Input
                {...props}
                name="rank"
                type="number"
                inputMode="numeric"
                min={1}
                max={options.maxRank}
                step={1}
                defaultValue={role?.rank}
                required
              />
            )}
          </Field>
          <Field label="Descrição" error={state.fieldErrors?.description} className="sm:col-span-2">
            {(props) => <Textarea {...props} name="description" defaultValue={role?.description ?? ""} maxLength={240} />}
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Permissões" description="Marque o que os membros com este perfil podem ver e fazer." />
        <CardBody>
          <PermissionPicker groups={options.groups} selected={new Set(role?.permissions ?? [])} error={state.fieldErrors?.permissions} />
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          {role ? "Voltar" : "Cancelar"}
        </LinkButton>
        <SubmitButton>{role ? "Salvar alterações" : "Criar perfil"}</SubmitButton>
      </div>
    </form>
  );
}

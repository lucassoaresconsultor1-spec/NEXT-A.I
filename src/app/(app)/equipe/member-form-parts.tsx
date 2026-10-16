"use client";

import { startTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";

export interface RoleOption {
  id: string;
  name: string;
}

/** Only roles the viewer may assign reach this select; the server checks again. */
export function RoleField({ roles, defaultValue, error }: { roles: RoleOption[]; defaultValue?: string; error?: string[] }) {
  return (
    <Field
      label="Perfil"
      error={error}
      required
      hint="Somente perfis de nível inferior ao seu; o perfil Dono só é atribuído por donos."
    >
      {(props) => (
        <Select {...props} name="roleId" defaultValue={defaultValue ?? ""} required>
          <option value="" disabled>
            Selecione um perfil
          </option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * Dispatches the action from onSubmit so React does not reset the form when
 * the server answers with validation errors (the `action` prop stays as the
 * no-JavaScript fallback).
 */
export function submitKeepingValues(action: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  };
}

/** Submit button driven by the action's pending flag (the form is dispatched manually). */
export function PendingSubmit({ pending, pendingLabel, children }: { pending: boolean; pendingLabel: string; children: ReactNode }) {
  return (
    <Button type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

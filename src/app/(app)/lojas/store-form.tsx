"use client";

import { startTransition, type FormEvent } from "react";
import { LinkButton } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { createStoreAction, updateStoreAction } from "./actions";
import {
  AddressSection,
  ContactSection,
  IdentificationSection,
  OperationSection,
  type RegionChoice,
  type StoreFormValues,
} from "./store-form-sections";

export type { RegionChoice, StoreFormValues } from "./store-form-sections";

/**
 * Create and edit form. Successful submissions redirect to the store page.
 * The submit handler dispatches the action itself so React does not reset
 * the (long) form when the server answers with validation errors.
 */
export function StoreForm({
  store,
  regions,
  organizationTimezone,
  cancelHref,
}: {
  store?: StoreFormValues;
  regions: RegionChoice;
  organizationTimezone: string;
  cancelHref: string;
}) {
  const [state, action] = useFormAction(store ? updateStoreAction : createStoreAction);

  function submitKeepingValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => action(formData));
  }

  return (
    <form action={action} onSubmit={submitKeepingValues} noValidate className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {store ? <input type="hidden" name="id" value={store.id} /> : null}
      <Card>
        <IdentificationSection store={store} errors={state.fieldErrors} />
        <ContactSection store={store} errors={state.fieldErrors} />
        <AddressSection store={store} errors={state.fieldErrors} />
        <OperationSection store={store} errors={state.fieldErrors} regions={regions} organizationTimezone={organizationTimezone} />
      </Card>
      <div className="flex justify-end gap-2">
        <LinkButton href={cancelHref} variant="secondary">
          Cancelar
        </LinkButton>
        <SubmitButton>{store ? "Salvar alterações" : "Cadastrar loja"}</SubmitButton>
      </div>
    </form>
  );
}

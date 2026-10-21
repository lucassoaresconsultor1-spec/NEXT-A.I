"use client";

import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Checkbox, Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatCpf, formatPhone } from "@/lib/documents";

type FormAction = Parameters<typeof useFormAction>[0];

/** What the page received from the customer service; `document` is already masked when `documentMasked`. */
export interface CustomerDialogRow {
  id: string;
  name: string;
  document: string | null;
  documentMasked: boolean;
  email: string | null;
  phone: string | null;
  marketingConsent: boolean;
  isActive: boolean;
}

function FormActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      {children}
    </div>
  );
}

// Rendered inside the dialog content, so each opening starts with a fresh form state.
function CustomerForm({ saveAction, row, onDone }: { saveAction: FormAction; row?: CustomerDialogRow; onDone: () => void }) {
  const [state, action] = useFormAction(saveAction, onDone);
  const errors = state.fieldErrors ?? {};
  // A masked CPF goes back as is; the service then keeps the stored value.
  const documentValue = row?.documentMasked ? (row.document ?? "") : row?.document ? formatCpf(row.document) : "";
  const documentHint = row?.documentMasked
    ? "O CPF está oculto para o seu perfil. Deixe como está para mantê-lo ou digite o CPF completo para trocá-lo."
    : "Opcional. Não pode repetir outro cliente.";
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <Field label="Nome" hint="Entre 2 e 120 caracteres." error={errors.name} required>
        {(props) => <Input {...props} name="name" defaultValue={row?.name} maxLength={120} autoComplete="off" required />}
      </Field>
      <Field label="CPF" hint={documentHint} error={errors.document}>
        {(props) => <Input {...props} name="document" defaultValue={documentValue} inputMode="numeric" maxLength={14} autoComplete="off" />}
      </Field>
      <Field label="E-mail" hint="Opcional." error={errors.email}>
        {(props) => <Input {...props} type="email" name="email" defaultValue={row?.email ?? ""} maxLength={254} autoComplete="off" />}
      </Field>
      <Field label="Telefone" hint="Opcional. Use DDD + número." error={errors.phone}>
        {(props) => (
          <Input {...props} type="tel" name="phone" defaultValue={row?.phone ? formatPhone(row.phone) : ""} maxLength={20} autoComplete="off" />
        )}
      </Field>
      <Checkbox name="marketingConsent" defaultChecked={row?.marketingConsent ?? false} label="O cliente autorizou receber contatos e ofertas." />
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function CustomerFormDialog({ saveAction, row }: { saveAction: FormAction; row?: CustomerDialogRow }) {
  const [open, setOpen] = useState(false);
  const trigger = row ? (
    <Button variant="ghost" size="sm" aria-label={`Editar cliente ${row.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button>
      <Plus className="size-4" aria-hidden /> Novo cliente
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={row ? "Editar cliente" : "Novo cliente"}>
      <CustomerForm saveAction={saveAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function StatusForm({ statusAction, row, onDone }: { statusAction: FormAction; row: CustomerDialogRow; onDone: () => void }) {
  const [state, action] = useFormAction(statusAction, onDone);
  const activating = !row.isActive;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="active" value={activating ? "true" : "false"} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar cliente" : "Desativar cliente"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function CustomerStatusDialog({ statusAction, row }: { statusAction: FormAction; row: CustomerDialogRow }) {
  const [open, setOpen] = useState(false);
  const activating = !row.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} o cliente ${row.name}?`}
      description={
        activating
          ? "O cliente volta a ser oferecido no PDV."
          : "O cadastro é mantido e pode ser reativado. Clientes inativos não são oferecidos no PDV."
      }
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${verb} cliente ${row.name}`}>
          <Icon className="size-4" aria-hidden /> {verb}
        </Button>
      }
    >
      <StatusForm statusAction={statusAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

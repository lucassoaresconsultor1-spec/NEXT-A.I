"use client";

import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { formatCnpj, formatPhone } from "@/lib/documents";

type FormAction = Parameters<typeof useFormAction>[0];

export interface SupplierRow {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
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

function SupplierForm({
  saveAction,
  row,
  onDone,
}: {
  saveAction: FormAction;
  row?: SupplierRow;
  onDone: () => void;
}) {
  const [state, action] = useFormAction(saveAction, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <Field label="Nome" error={state.fieldErrors?.name} hint="Entre 2 e 120 caracteres." required>
        {(props) => <Input {...props} name="name" defaultValue={row?.name} maxLength={120} autoComplete="off" required />}
      </Field>
      <Field
        label="CNPJ"
        error={state.fieldErrors?.document}
        hint="Opcional. Pode digitar com pontuação. Não pode repetir outro fornecedor."
      >
        {(props) => (
          <Input
            {...props}
            name="document"
            defaultValue={row?.document ? formatCnpj(row.document) : ""}
            maxLength={18}
            autoComplete="off"
            inputMode="text"
          />
        )}
      </Field>
      <Field label="E-mail" error={state.fieldErrors?.email} hint="Opcional.">
        {(props) => (
          <Input
            {...props}
            type="email"
            name="email"
            defaultValue={row?.email ?? ""}
            maxLength={254}
            autoComplete="off"
          />
        )}
      </Field>
      <Field label="Telefone" error={state.fieldErrors?.phone} hint="Opcional. Use DDD + número.">
        {(props) => (
          <Input
            {...props}
            type="tel"
            name="phone"
            defaultValue={row?.phone ? formatPhone(row.phone) : ""}
            maxLength={20}
            autoComplete="off"
          />
        )}
      </Field>
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function SupplierFormDialog({
  saveAction,
  row,
}: {
  saveAction: FormAction;
  row?: SupplierRow;
}) {
  const [open, setOpen] = useState(false);
  const trigger = row ? (
    <Button variant="ghost" size="sm" aria-label={`Editar fornecedor ${row.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button>
      <Plus className="size-4" aria-hidden /> Novo fornecedor
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={row ? "Editar fornecedor" : "Novo fornecedor"}>
      <SupplierForm saveAction={saveAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function SupplierStatusForm({
  statusAction,
  row,
  onDone,
}: {
  statusAction: FormAction;
  row: SupplierRow;
  onDone: () => void;
}) {
  const [state, action] = useFormAction(statusAction, onDone);
  const activating = !row.isActive;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="active" value={activating ? "true" : "false"} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar fornecedor" : "Desativar fornecedor"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function SupplierStatusDialog({
  statusAction,
  row,
}: {
  statusAction: FormAction;
  row: SupplierRow;
}) {
  const [open, setOpen] = useState(false);
  const activating = !row.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} o fornecedor ${row.name}?`}
      description={
        activating
          ? "O fornecedor volta a constar como ativo."
          : "O cadastro é mantido como inativo e pode ser reativado a qualquer momento. Os produtos que já usam este fornecedor continuam com ele, mas ele deixa de ser oferecido para novos produtos."
      }
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${verb} fornecedor ${row.name}`}>
          <Icon className="size-4" aria-hidden /> {verb}
        </Button>
      }
    >
      <SupplierStatusForm statusAction={statusAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

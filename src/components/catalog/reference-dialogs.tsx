"use client";

import { Pencil, Plus, Power, PowerOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";

/** The hook's own action type (it is not exported); do not redeclare it. */
export type FormAction = Parameters<typeof useFormAction>[0];

export interface ReferenceRow {
  id: string;
  name: string;
  isActive: boolean;
}

export interface ReferenceCopy {
  title: string;
  description: string;
  singular: string;
  plural: string;
  newButton: string;
  nameHint: string;
  filterLabel: string;
  filterOptions: { all: string; active: string; inactive: string };
  activeBadge: string;
  inactiveBadge: string;
  caption: string;
  emptyTitle: string;
  emptyDescriptionManage: string;
  emptyDescriptionReadOnly: string;
  emptyFilteredActive: string;
  emptyFilteredInactive: string;
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

function ReferenceForm({
  copy,
  saveAction,
  row,
  onDone,
}: {
  copy: ReferenceCopy;
  saveAction: FormAction;
  row?: ReferenceRow;
  onDone: () => void;
}) {
  const [state, action] = useFormAction(saveAction, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <Field label="Nome" error={state.fieldErrors?.name} hint={copy.nameHint} required>
        {(props) => <Input {...props} name="name" defaultValue={row?.name} maxLength={80} autoComplete="off" required />}
      </Field>
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function ReferenceFormDialog({
  copy,
  saveAction,
  row,
}: {
  copy: ReferenceCopy;
  saveAction: FormAction;
  row?: ReferenceRow;
}) {
  const [open, setOpen] = useState(false);
  const trigger = row ? (
    <Button variant="ghost" size="sm" aria-label={`Editar ${copy.singular} ${row.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button>
      <Plus className="size-4" aria-hidden /> {copy.newButton}
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={row ? `Editar ${copy.singular}` : copy.newButton}>
      <ReferenceForm copy={copy} saveAction={saveAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function ReferenceStatusForm({
  copy,
  statusAction,
  row,
  onDone,
}: {
  copy: ReferenceCopy;
  statusAction: FormAction;
  row: ReferenceRow;
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
          {activating ? `Ativar ${copy.singular}` : `Desativar ${copy.singular}`}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function ReferenceStatusDialog({
  copy,
  statusAction,
  row,
}: {
  copy: ReferenceCopy;
  statusAction: FormAction;
  row: ReferenceRow;
}) {
  const [open, setOpen] = useState(false);
  const activating = !row.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} a ${copy.singular} ${row.name}?`}
      description={
        activating
          ? `A ${copy.singular} volta a constar como ativa.`
          : `O cadastro é mantido como inativo e pode ser reativado a qualquer momento. Os produtos que já usam esta ${copy.singular} continuam com ela, mas ela deixa de ser oferecida para novos produtos.`
      }
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${verb} ${copy.singular} ${row.name}`}>
          <Icon className="size-4" aria-hidden /> {verb}
        </Button>
      }
    >
      <ReferenceStatusForm copy={copy} statusAction={statusAction} row={row} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

"use client";

import { Pencil, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { deleteDepartmentAction, saveDepartmentAction, setDepartmentActiveAction } from "./actions";

export interface DepartmentValues {
  id: string;
  name: string;
  description: string | null;
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

// Each dialog's form lives in its content, which unmounts when closed, so every
// opening starts with a fresh form state (no stale errors or values).
function DepartmentForm({ department, onDone }: { department?: DepartmentValues; onDone: () => void }) {
  const [state, action] = useFormAction(saveDepartmentAction, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {department ? <input type="hidden" name="id" value={department.id} /> : null}
      <Field label="Nome" error={state.fieldErrors?.name} hint="Entre 2 e 80 caracteres. Não pode repetir outro departamento." required>
        {(props) => <Input {...props} name="name" defaultValue={department?.name} maxLength={80} autoComplete="off" required />}
      </Field>
      <Field label="Descrição" error={state.fieldErrors?.description} hint="Opcional, até 240 caracteres.">
        {(props) => <Textarea {...props} name="description" defaultValue={department?.description ?? ""} maxLength={240} />}
      </Field>
      <FormActions onCancel={onDone}>
        <SubmitButton>Salvar</SubmitButton>
      </FormActions>
    </form>
  );
}

export function DepartmentFormDialog({ department }: { department?: DepartmentValues }) {
  const [open, setOpen] = useState(false);
  const trigger = department ? (
    <Button variant="ghost" size="sm" aria-label={`Editar departamento ${department.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button>
      <Plus className="size-4" aria-hidden /> Novo departamento
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={department ? "Editar departamento" : "Novo departamento"}>
      <DepartmentForm department={department} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function StatusForm({ department, onDone }: { department: DepartmentValues; onDone: () => void }) {
  const [state, action] = useFormAction(setDepartmentActiveAction, onDone);
  const activating = !department.isActive;
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={department.id} />
      <input type="hidden" name="active" value={activating ? "true" : "false"} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar departamento" : "Desativar departamento"}
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function DepartmentStatusDialog({ department }: { department: DepartmentValues }) {
  const [open, setOpen] = useState(false);
  const activating = !department.isActive;
  const Icon = activating ? Power : PowerOff;
  const verb = activating ? "Ativar" : "Desativar";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`${verb} o departamento ${department.name}?`}
      description={
        activating
          ? "O departamento volta a constar como ativo."
          : "O cadastro é mantido como inativo e pode ser reativado a qualquer momento."
      }
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${verb} departamento ${department.name}`}>
          <Icon className="size-4" aria-hidden /> {verb}
        </Button>
      }
    >
      <StatusForm department={department} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function DeleteForm({ departmentId, onDone }: { departmentId: string; onDone: () => void }) {
  const [state, action] = useFormAction(deleteDepartmentAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={departmentId} />
      <FormActions onCancel={onDone}>
        <SubmitButton variant="danger" pendingLabel="Excluindo…">
          Excluir departamento
        </SubmitButton>
      </FormActions>
    </form>
  );
}

export function DeleteDepartmentDialog({ department }: { department: DepartmentValues }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Excluir o departamento ${department.name}?`}
      description="Esta ação não pode ser desfeita. Para apenas interromper o uso, desative o departamento."
      trigger={
        <Button variant="ghost" size="sm" className="text-critical" aria-label={`Excluir departamento ${department.name}`}>
          <Trash2 className="size-4" aria-hidden /> Excluir
        </Button>
      }
    >
      <DeleteForm departmentId={department.id} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

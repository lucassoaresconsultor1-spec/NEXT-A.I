"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { deleteRegionAction, saveRegionAction } from "./actions";

interface RegionValues {
  id: string;
  name: string;
  description: string | null;
}

// Dialog content unmounts when closed, so each opening starts with a fresh form state.
function RegionForm({ region, onDone }: { region?: RegionValues; onDone: () => void }) {
  const [state, action] = useFormAction(saveRegionAction, onDone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {region ? <input type="hidden" name="id" value={region.id} /> : null}
      <Field label="Nome" error={state.fieldErrors?.name} required>
        {(props) => <Input {...props} name="name" defaultValue={region?.name} maxLength={80} required />}
      </Field>
      <Field label="Descrição" error={state.fieldErrors?.description}>
        {(props) => <Textarea {...props} name="description" defaultValue={region?.description ?? ""} maxLength={240} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton>Salvar</SubmitButton>
      </div>
    </form>
  );
}

export function RegionFormDialog({ region }: { region?: RegionValues }) {
  const [open, setOpen] = useState(false);
  const trigger = region ? (
    <Button variant="ghost" size="sm" aria-label={`Editar região ${region.name}`}>
      <Pencil className="size-4" aria-hidden /> Editar
    </Button>
  ) : (
    <Button>
      <Plus className="size-4" aria-hidden /> Nova região
    </Button>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen} trigger={trigger} title={region ? "Editar região" : "Nova região"}>
      <RegionForm region={region} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function DeleteRegionForm({ regionId, onDone }: { regionId: string; onDone: () => void }) {
  const [state, action] = useFormAction(deleteRegionAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={regionId} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant="danger" pendingLabel="Excluindo…">
          Excluir região
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteRegionDialog({ region, storeCount }: { region: RegionValues; storeCount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Excluir a região ${region.name}?`}
      description={
        storeCount > 0
          ? `${storeCount} loja(s) ficarão sem região. Membros com acesso por região impedem a exclusão.`
          : "Esta ação não pode ser desfeita."
      }
      trigger={
        <Button variant="ghost" size="sm" className="text-critical" aria-label={`Excluir região ${region.name}`}>
          <Trash2 className="size-4" aria-hidden /> Excluir
        </Button>
      }
    >
      <DeleteRegionForm regionId={region.id} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

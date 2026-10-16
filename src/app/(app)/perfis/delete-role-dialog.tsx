"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { deleteRoleAction } from "./actions";

// Lives inside the dialog content, so each opening starts with a fresh state.
// On success the action redirects to the list.
function DeleteRoleForm({ roleId, onDone }: { roleId: string; onDone: () => void }) {
  const [state, action] = useFormAction(deleteRoleAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={roleId} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant="danger" pendingLabel="Excluindo…">
          Excluir perfil
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteRoleDialog({ role }: { role: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Excluir o perfil ${role.name}?`}
      description="O perfil e suas permissões serão removidos. Esta ação não pode ser desfeita."
      trigger={
        <Button variant="secondary" className="text-critical" aria-label={`Excluir perfil ${role.name}`}>
          <Trash2 className="size-4" aria-hidden /> Excluir
        </Button>
      }
    >
      <DeleteRoleForm roleId={role.id} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

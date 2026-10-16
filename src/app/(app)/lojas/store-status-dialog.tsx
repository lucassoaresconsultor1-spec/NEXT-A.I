"use client";

import { Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { setStoreStatusAction } from "./actions";

interface StatusTarget {
  id: string;
  name: string;
  status: "active" | "inactive";
}

// Rendered inside the dialog content, so each opening starts with a fresh state.
function StoreStatusForm({ store, onDone }: { store: StatusTarget; onDone: () => void }) {
  const [state, action] = useFormAction(setStoreStatusAction, onDone);
  const activating = store.status === "inactive";
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={store.id} />
      <input type="hidden" name="status" value={activating ? "active" : "inactive"} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant={activating ? "primary" : "danger"} pendingLabel={activating ? "Ativando…" : "Desativando…"}>
          {activating ? "Ativar loja" : "Desativar loja"}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Stores are never deleted: deactivation keeps their history and frees a plan slot. */
export function StoreStatusDialog({ store }: { store: StatusTarget }) {
  const [open, setOpen] = useState(false);
  const activating = store.status === "inactive";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={activating ? `Ativar a loja ${store.name}?` : `Desativar a loja ${store.name}?`}
      description={
        activating
          ? "A loja volta a aparecer nos seletores e passa a contar no limite de lojas ativas do plano."
          : "A loja deixa de aparecer nos seletores e libera uma vaga no limite do plano. Cadastro, equipe vinculada e histórico são mantidos, e você pode reativá-la depois."
      }
      trigger={
        <Button variant="secondary">
          {activating ? <Power className="size-4" aria-hidden /> : <PowerOff className="size-4" aria-hidden />}
          {activating ? "Ativar" : "Desativar"}
        </Button>
      }
    >
      <StoreStatusForm store={store} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

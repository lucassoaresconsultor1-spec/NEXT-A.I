"use client";

import { Ban, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { setOrganizationStatusAction } from "./actions";

interface StatusTarget {
  id: string;
  name: string;
  status: "active" | "suspended";
}

// Rendered inside the dialog content, so each opening starts with a fresh state.
function StatusForm({ organization, onDone }: { organization: StatusTarget; onDone: () => void }) {
  const [state, action] = useFormAction(setOrganizationStatusAction, onDone);
  const reactivating = organization.status === "suspended";
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="organizationId" value={organization.id} />
      <input type="hidden" name="status" value={reactivating ? "active" : "suspended"} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton variant={reactivating ? "primary" : "danger"} pendingLabel={reactivating ? "Reativando…" : "Suspendendo…"}>
          {reactivating ? "Reativar empresa" : "Suspender empresa"}
        </SubmitButton>
      </div>
    </form>
  );
}

export function StatusDialog({ organization }: { organization: StatusTarget }) {
  const [open, setOpen] = useState(false);
  const reactivating = organization.status === "suspended";
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={reactivating ? `Reativar a empresa ${organization.name}?` : `Suspender a empresa ${organization.name}?`}
      description={
        reactivating
          ? "Os membros ativos da empresa voltam a acessá-la imediatamente. A reativação fica registrada na auditoria da empresa."
          : "Todos os membros da empresa perdem o acesso imediatamente, inclusive quem estiver com uma sessão aberta. Os dados são mantidos e a empresa pode ser reativada depois. A suspensão fica registrada na auditoria da empresa."
      }
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className={reactivating ? undefined : "text-critical"}
          aria-label={reactivating ? `Reativar empresa ${organization.name}` : `Suspender empresa ${organization.name}`}
        >
          {reactivating ? <RotateCcw className="size-4" aria-hidden /> : <Ban className="size-4" aria-hidden />}
          {reactivating ? "Reativar" : "Suspender"}
        </Button>
      }
    >
      <StatusForm organization={organization} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

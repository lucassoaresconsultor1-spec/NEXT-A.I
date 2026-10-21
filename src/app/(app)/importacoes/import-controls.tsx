"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { confirmImportAction, discardImportAction } from "./actions";

function ConfirmForm({ importId, validCount, done }: { importId: string; validCount: number; done: () => void }) {
  const [state, action] = useFormAction(confirmImportAction, done);
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="importId" value={importId} />
    <p className="text-sm text-ink">A confirmação gravará {validCount} {validCount === 1 ? "linha válida" : "linhas válidas"}. Linhas com erro ou repetidas não serão importadas. Deseja continuar?</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={done}>Cancelar</Button><SubmitButton pendingLabel="Importando…">Confirmar {validCount} linhas</SubmitButton></div>
  </form>;
}

function DiscardForm({ importId, done }: { importId: string; done: () => void }) {
  const [state, action] = useFormAction(discardImportAction, done);
  return <form action={action} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    <input type="hidden" name="importId" value={importId} />
    <p className="text-sm text-ink">A prévia será descartada e as linhas normalizadas serão apagadas. Esta ação não pode ser desfeita.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={done}>Cancelar</Button><SubmitButton variant="danger" pendingLabel="Descartando…">Descartar prévia</SubmitButton></div>
  </form>;
}

export function ImportControls({ importId, validCount }: { importId: string; validCount: number }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  return <div className="flex flex-wrap gap-2">
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen} title="Confirmar importação" trigger={<Button>Confirmar importação</Button>}>
      <ConfirmForm importId={importId} validCount={validCount} done={() => setConfirmOpen(false)} />
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen} title="Descartar prévia" trigger={<Button variant="danger">Descartar prévia</Button>}>
      <DiscardForm importId={importId} done={() => setDiscardOpen(false)} />
    </Dialog>
  </div>;
}





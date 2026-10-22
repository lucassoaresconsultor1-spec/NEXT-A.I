"use client";

import { useState } from "react";
import { useFormAction } from "@/components/ui/use-form-action";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/feedback";
import type { ActionState } from "@/lib/action-state";
import { setCategoryActiveAction } from "@/app/(app)/despesas/actions";

function ToggleForm({ categoryId, isActive, onDone }: { categoryId: string; isActive: boolean; onDone: () => void }) {
  const [state, action] = useFormAction(setCategoryActiveAction as unknown as (state: ActionState, formData: FormData) => Promise<ActionState>, onDone);
  return (
    <Dialog open={true} onOpenChange={onDone} title={isActive ? "Desativar categoria" : "Ativar categoria"} description={`Tem certeza de que deseja ${isActive ? "desativar" : "ativar"} esta categoria?`}>
      <form action={action} className="space-y-4">
        {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
        <input type="hidden" name="id" value={categoryId} />
        <input type="hidden" name="active" value={String(!isActive)} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancelar</Button><SubmitButton variant={isActive ? "danger" : "primary"}>{isActive ? "Desativar" : "Ativar"}</SubmitButton></div>
      </form>
    </Dialog>
  );
}

export function CategoryRowActions({ categoryId, isActive }: { categoryId: string; isActive: boolean }) {
  const [mode, setMode] = useState<"toggle" | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setMode("toggle")}>{isActive ? "Desativar" : "Ativar"}</Button>
      {mode === "toggle" && <ToggleForm categoryId={categoryId} isActive={isActive} onDone={() => { setMode(null); }} />}
    </div>
  );
}

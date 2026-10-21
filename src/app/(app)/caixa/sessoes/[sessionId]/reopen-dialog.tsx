"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";

type FormAction = (state: ActionState, data: FormData) => Promise<ActionState>;
function ReopenForm({ sessionId, action, done }: { sessionId: string; action: FormAction; done: () => void }) {
  const [state, formAction] = useFormAction(action, done);
  return <form action={formAction} className="space-y-4">{state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}<input type="hidden" name="sessionId" value={sessionId} /><Field label="Motivo" error={state.fieldErrors?.reason} hint="Use de 3 a 240 caracteres." required>{(props) => <Textarea {...props} name="reason" minLength={3} maxLength={240} required autoFocus />}</Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={done}>Cancelar</Button><SubmitButton pendingLabel="Reabrindo…">Reabrir caixa</SubmitButton></div></form>;
}
export function ReopenDialog({ sessionId, action }: { sessionId: string; action: FormAction }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen} title="Reabrir caixa" description="Use só para corrigir um fechamento. A reabertura fica registrada." trigger={<Button>Reabrir caixa</Button>}><ReopenForm sessionId={sessionId} action={action} done={() => setOpen(false)} /></Dialog>;
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import type { ActionState } from "@/lib/action-state";
import { formatCurrencyCents } from "@/lib/format";
import { parseBrlToCents } from "@/lib/money";

type CloseAction = (state: ActionState, data: FormData) => Promise<ActionState & { expectedCents?: number; differenceCents?: number }>;

export function CloseForm({ sessionId, action }: { sessionId: string; action: CloseAction }) {
  const [confirmed, setConfirmed] = useState(false);
  const [countedCents, setCountedCents] = useState<number | null>(null);
  const [result, setResult] = useState<{ expectedCents?: number; differenceCents?: number }>();
  const [state, formAction] = useFormAction(async (previous, data) => {
    const counted = parseBrlToCents(String(data.get("countedAmount") ?? ""));
    const response = await action(previous, data);
    if (response.status === "success") {
      setCountedCents(counted);
      setResult(response);
    }
    return response;
  });
  const difference = result?.differenceCents ?? 0;
  return <form action={formAction} className="space-y-4">
    {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
    {state.status === "success" ? <Notice tone="success" title={state.message}>{result ? <div className="space-y-1"><p>Esperado: {formatCurrencyCents(result.expectedCents ?? 0)}</p><p>Contado: {formatCurrencyCents(countedCents ?? 0)}</p><p className={difference === 0 ? "text-positive" : "text-critical"}>{difference === 0 ? "Sem diferença" : `Diferença de ${formatCurrencyCents(difference)}`}</p></div> : null}</Notice> : null}
    <input type="hidden" name="sessionId" value={sessionId} />
    <Field label="Valor contado em dinheiro" error={state.fieldErrors?.countedAmount} required>{(props) => <div className="flex items-center gap-2"><span aria-hidden>R$</span><Input {...props} name="countedAmount" inputMode="decimal" placeholder="0,00" required autoFocus /></div>}</Field>
    <Field label="Observação" error={state.fieldErrors?.note} hint="Obrigatória quando houver diferença.">{(props) => <Textarea {...props} name="note" maxLength={500} />}</Field>
    {!confirmed ? <Button type="button" onClick={() => setConfirmed(true)}>Fechar caixa</Button> : <div className="space-y-2"><p className="text-sm text-attention">Depois de fechado, só um gerente pode reabrir.</p><div className="flex gap-2"><Button variant="secondary" onClick={() => setConfirmed(false)}>Cancelar</Button><SubmitButton pendingLabel="Fechando…">Confirmar fechamento</SubmitButton></div></div>}
  </form>;
}

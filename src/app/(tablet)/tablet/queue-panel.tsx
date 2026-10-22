"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { useFormAction } from "@/components/ui/use-form-action";
import { abandonAction, arrivalAction, callNextAction, eligibleSalesAction, finishAction, lockAction, presenceAction } from "./actions";

export interface PanelData {
  deviceName: string;
  memberName: string;
  canOperate: boolean;
  departments: { id: string; name: string }[];
  waiting: { id: string; ticket: number; note: string | null; sector: string | null; at: string }[];
  inService: { id: string; ticket: number; note: string | null; salesperson: string; at: string }[];
  presence: { salespersonId: string; name: string; code: string; status: "available" | "busy" | "away"; since: string }[];
}

const PRESENCE = { available: { label: "Disponível", tone: "positive" }, busy: { label: "Atendendo", tone: "attention" }, away: { label: "Ausente", tone: "neutral" } } as const;

function StateNotice({ state }: { state: { status: string; message?: string } }) {
  if (!state.message || state.status === "idle") return null;
  return <Notice tone={state.status === "error" ? "error" : "success"} title={state.message} />;
}

function ArrivalForm({ departments }: { departments: PanelData["departments"] }) {
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  // A new key after each registered arrival; a retry of the same submission reuses it.
  const [state, action] = useFormAction(arrivalAction, () => setRequestKey(crypto.randomUUID()));
  return (
    <form action={action} className="space-y-3" noValidate>
      <StateNotice state={state} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Setor (opcional)">
          {(props) => (
            <Select {...props} name="departmentId" defaultValue="">
              <option value="">Qualquer vendedor</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Observação (opcional, sem dados pessoais)">{(props) => <Input {...props} name="note" maxLength={80} autoComplete="off" />}</Field>
      </div>
      <SubmitButton pendingLabel="Registrando…" className="h-14 w-full text-base">
        Registrar chegada
      </SubmitButton>
    </form>
  );
}

function CallNext() {
  const [state, action] = useFormAction(callNextAction);
  return (
    <form action={action} className="space-y-3">
      <StateNotice state={state} />
      <SubmitButton pendingLabel="Chamando…" className="h-14 w-full text-base">
        Chamar próximo
      </SubmitButton>
    </form>
  );
}

function AbandonDialog({ entry }: { entry: PanelData["waiting"][number] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormAction(abandonAction, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen} title={`Desistência da senha ${entry.ticket}`} trigger={<Button variant="ghost" size="sm">Desistiu</Button>}>
      <form action={action} className="space-y-3" noValidate>
        <StateNotice state={state} />
        <input type="hidden" name="entryId" value={entry.id} />
        <Field label="Motivo" required>{(props) => <Textarea {...props} name="reason" maxLength={240} required />}</Field>
        <SubmitButton variant="danger" pendingLabel="Registrando…">Registrar desistência</SubmitButton>
      </form>
    </Dialog>
  );
}

function FinishForm({ entry, onDone }: { entry: PanelData["inService"][number]; onDone: () => void }) {
  const [outcome, setOutcome] = useState<"sale" | "no_sale">("sale");
  const [sales, setSales] = useState<{ saleId: string; label: string }[] | null>(null);
  const [state, action] = useFormAction(finishAction, onDone);
  useEffect(() => {
    let active = true;
    void eligibleSalesAction(entry.id).then((rows) => {
      if (active) setSales(rows);
    });
    return () => {
      active = false;
    };
  }, [entry.id]);
  return (
    <form action={action} className="space-y-3" noValidate>
      <StateNotice state={state} />
      <input type="hidden" name="entryId" value={entry.id} />
      <input type="hidden" name="outcome" value={outcome} />
      <div className="flex gap-2" role="radiogroup" aria-label="Resultado">
        <Button variant={outcome === "sale" ? "primary" : "secondary"} role="radio" aria-checked={outcome === "sale"} onClick={() => setOutcome("sale")}>Com venda</Button>
        <Button variant={outcome === "no_sale" ? "primary" : "secondary"} role="radio" aria-checked={outcome === "no_sale"} onClick={() => setOutcome("no_sale")}>Sem venda</Button>
      </div>
      {outcome === "sale" ? (
        sales === null ? (
          <p className="text-sm text-ink-muted" aria-live="polite">Carregando as vendas…</p>
        ) : sales.length === 0 ? (
          <Notice tone="warning" title="Nenhuma venda deste vendedor depois da chegada ainda." />
        ) : (
          <Field label="Venda" required>
            {(props) => (
              <Select {...props} name="saleId" required>
                {sales.map((sale) => (
                  <option key={sale.saleId} value={sale.saleId}>{sale.label}</option>
                ))}
              </Select>
            )}
          </Field>
        )
      ) : (
        <Field label="Motivo" required>{(props) => <Textarea {...props} name="reason" maxLength={240} required />}</Field>
      )}
      <SubmitButton pendingLabel="Encerrando…">Encerrar atendimento</SubmitButton>
    </form>
  );
}

function FinishDialog({ entry }: { entry: PanelData["inService"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen} title={`Encerrar a senha ${entry.ticket}`} description={`Atendimento de ${entry.salesperson}.`} trigger={<Button size="sm">Encerrar</Button>}>
      <FinishForm entry={entry} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function PresenceRow({ row }: { row: PanelData["presence"][number] }) {
  const [state, action] = useFormAction(presenceAction);
  const presence = PRESENCE[row.status];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <span>
        <span className="font-medium">{row.name}</span> <span className="text-xs text-ink-muted">{row.code} · desde {row.since}</span>
        {state.status === "error" && state.message ? <span className="block text-xs text-critical" role="alert">{state.message}</span> : null}
      </span>
      <span className="flex items-center gap-2">
        <Badge tone={presence.tone}>{presence.label}</Badge>
        {row.status === "busy" ? null : (
          <form action={action}>
            <input type="hidden" name="salespersonId" value={row.salespersonId} />
            <input type="hidden" name="status" value={row.status === "available" ? "away" : "available"} />
            <SubmitButton variant="secondary" pendingLabel="…">{row.status === "available" ? "Sair da fila" : "Entrar na fila"}</SubmitButton>
          </form>
        )}
      </span>
    </li>
  );
}

export function QueuePanel({ data }: { data: PanelData }) {
  const router = useRouter();
  // The queue changes from other tablets and the PDV: refresh what the server says.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold">Fila · {data.deviceName}</p>
          <p className="text-sm text-ink-muted">{data.memberName}</p>
        </div>
        <form action={lockAction}>
          <Button type="submit" variant="secondary">Sair</Button>
        </form>
      </header>
      {data.canOperate ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader title="Nova chegada" /><CardBody><ArrivalForm departments={data.departments} /></CardBody></Card>
          <Card><CardHeader title="Rodízio" description={`${data.waiting.length} aguardando`} /><CardBody><CallNext /></CardBody></Card>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aguardando" />
          {data.waiting.length === 0 ? <CardBody><p className="text-sm text-ink-muted">Ninguém aguardando.</p></CardBody> : (
            <ul className="divide-y divide-line" aria-label="Aguardando">
              {data.waiting.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <span><span className="font-mono text-lg font-semibold">{entry.ticket}</span> <span className="text-sm text-ink-muted">{entry.at}{entry.sector ? ` · ${entry.sector}` : ""}{entry.note ? ` · ${entry.note}` : ""}</span></span>
                  {data.canOperate ? <AbandonDialog entry={entry} /> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Em atendimento" />
          {data.inService.length === 0 ? <CardBody><p className="text-sm text-ink-muted">Nenhum atendimento em andamento.</p></CardBody> : (
            <ul className="divide-y divide-line" aria-label="Em atendimento">
              {data.inService.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <span><span className="font-mono text-lg font-semibold">{entry.ticket}</span> <span className="text-sm text-ink-muted">{entry.salesperson} · desde {entry.at}</span></span>
                  <FinishDialog entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Vendedores" description="Ordem do rodízio: disponíveis há mais tempo primeiro." />
        {data.presence.length === 0 ? <CardBody><p className="text-sm text-ink-muted">Nenhum vendedor entrou na fila hoje.</p></CardBody> : (
          <ul className="divide-y divide-line" aria-label="Vendedores">{data.presence.map((row) => <PresenceRow key={row.salespersonId} row={row} />)}</ul>
        )}
      </Card>
    </div>
  );
}

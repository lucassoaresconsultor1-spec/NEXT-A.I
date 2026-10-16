"use client";

import { KeyRound, PauseCircle, PlayCircle, UserMinus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { removeMemberAction, resetMemberPasswordAction, setMemberStatusAction } from "./actions";
import type { MemberStatusValue } from "./member-badges";

interface MemberRef {
  membershipId: string;
  name: string;
}

function DialogActions({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      {children}
    </div>
  );
}

// Each form lives inside the dialog content, which unmounts on close: every opening starts fresh.
function StatusForm({ member, next, onDone }: { member: MemberRef; next: MemberStatusValue; onDone: () => void }) {
  const [state, action] = useFormAction(setMemberStatusAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={member.membershipId} />
      <input type="hidden" name="status" value={next} />
      <DialogActions onCancel={onDone}>
        <SubmitButton variant={next === "suspended" ? "danger" : "primary"} pendingLabel="Aplicando…">
          {next === "suspended" ? "Suspender acesso" : "Reativar acesso"}
        </SubmitButton>
      </DialogActions>
    </form>
  );
}

export function MemberStatusDialog({ member, status }: { member: MemberRef; status: MemberStatusValue }) {
  const [open, setOpen] = useState(false);
  const suspending = status === "active";
  const Icon = suspending ? PauseCircle : PlayCircle;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={suspending ? `Suspender o acesso de ${member.name}?` : `Reativar o acesso de ${member.name}?`}
      description={
        suspending
          ? "A pessoa perde o acesso a esta empresa imediatamente. Perfil e escopo são mantidos para uma eventual reativação."
          : "A pessoa volta a acessar a empresa com o perfil e o escopo atuais. Membros ativos contam no limite do plano."
      }
      trigger={
        <Button variant="secondary">
          <Icon className="size-4" aria-hidden /> {suspending ? "Suspender" : "Reativar"}
        </Button>
      }
    >
      <StatusForm member={member} next={suspending ? "suspended" : "active"} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function RemoveForm({ member, onDone }: { member: MemberRef; onDone: () => void }) {
  const [state, action] = useFormAction(removeMemberAction, onDone);
  return (
    <form action={action} className="space-y-4">
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={member.membershipId} />
      <DialogActions onCancel={onDone}>
        <SubmitButton variant="danger" pendingLabel="Removendo…">
          Remover da equipe
        </SubmitButton>
      </DialogActions>
    </form>
  );
}

export function RemoveMemberDialog({ member }: { member: MemberRef }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Remover ${member.name} da equipe?`}
      description="A pessoa perde o acesso a esta empresa. A conta dela continua existindo e pode ser adicionada de novo depois."
      trigger={
        <Button variant="secondary" className="text-critical">
          <UserMinus className="size-4" aria-hidden /> Remover
        </Button>
      }
    >
      <RemoveForm member={member} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

function PasswordForm({ member, onDone }: { member: MemberRef; onDone: () => void }) {
  const [state, action] = useFormAction(resetMemberPasswordAction);
  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <Notice tone="success" title={state.message} />
        <div className="flex justify-end">
          <Button onClick={onDone}>Fechar</Button>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="id" value={member.membershipId} />
      <Field
        label="Senha provisória"
        error={state.fieldErrors?.temporaryPassword}
        hint="Mínimo de 10 caracteres. A pessoa troca no próximo acesso e as sessões abertas dela são encerradas."
        required
      >
        {(props) => <Input {...props} name="temporaryPassword" type="text" maxLength={128} autoComplete="off" spellCheck={false} required />}
      </Field>
      <DialogActions onCancel={onDone}>
        <SubmitButton pendingLabel="Definindo…">Definir senha provisória</SubmitButton>
      </DialogActions>
    </form>
  );
}

export function TemporaryPasswordDialog({ member }: { member: MemberRef }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Definir senha provisória para ${member.name}`}
      description="Disponível apenas para quem participa somente desta empresa. Nos demais casos, a própria pessoa altera a senha."
      trigger={
        <Button variant="secondary">
          <KeyRound className="size-4" aria-hidden /> Senha provisória
        </Button>
      }
    >
      <PasswordForm member={member} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

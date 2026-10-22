"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { useFormAction } from "@/components/ui/use-form-action";
import { UserRound } from "lucide-react";
import { unlockAction } from "./actions";

export function UnlockForm({ deviceName, members }: { deviceName: string; members: { membershipId: string; name: string }[] }) {
  const [selected, setSelected] = useState<{ membershipId: string; name: string } | null>(null);
  const [state, action] = useFormAction(unlockAction);
  return (
    <Card className="mx-auto mt-8 max-w-2xl">
      <CardHeader title="Quem é você?" description={`${deviceName} · toque no seu nome e digite o seu PIN de fila.`} />
      <CardBody className="space-y-4">
        {members.length === 0 ? (
          <EmptyState icon={UserRound} title="Ninguém com PIN de fila nesta loja" description="Cada pessoa define o próprio PIN em Fila, no sistema, antes de usar o tablet." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Pessoas">
            {members.map((member) => (
              <li key={member.membershipId}>
                <Button variant={selected?.membershipId === member.membershipId ? "primary" : "secondary"} className="h-14 w-full text-base" aria-pressed={selected?.membershipId === member.membershipId} onClick={() => setSelected(member)}>
                  {member.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {selected ? (
          // Keyed by person so each choice starts a fresh form state.
          <form key={selected.membershipId} action={action} className="space-y-4" noValidate>
            {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
            <input type="hidden" name="membershipId" value={selected.membershipId} />
            <Field label={`PIN de ${selected.name}`} required>
              {(props) => <Input {...props} name="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} className="text-center font-mono text-2xl tracking-widest" autoFocus required />}
            </Field>
            <SubmitButton pendingLabel="Conferindo…" className="w-full">
              Entrar
            </SubmitButton>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}

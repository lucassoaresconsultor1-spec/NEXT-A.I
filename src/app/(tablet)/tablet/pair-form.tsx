"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/layout";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { pairAction } from "./actions";

export function PairForm() {
  const [state, action] = useFormAction(pairAction);
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardHeader title="Parear este tablet" description="Peça ao gerente o código de pareamento da loja. Ele vale 10 minutos e só pode ser usado uma vez." />
      <CardBody>
        <form action={action} className="space-y-4" noValidate>
          {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
          <Field label="Código de pareamento" required>
            {(props) => <Input {...props} name="code" autoComplete="off" autoCapitalize="characters" maxLength={12} className="text-center font-mono text-2xl tracking-widest" required />}
          </Field>
          <SubmitButton pendingLabel="Pareando…" className="w-full">
            Parear
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}

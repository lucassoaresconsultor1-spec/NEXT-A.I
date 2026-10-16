"use client";

import { Layers } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Select, SubmitButton } from "@/components/ui/form";
import { idleState } from "@/lib/action-state";
import { changeOrganizationPlanAction, type PlanChangeState } from "./actions";

export interface PlanOption {
  key: string;
  name: string;
  maxStores: number | null;
  maxMembers: number | null;
}

interface PlanTarget {
  id: string;
  name: string;
  planKey: string;
}

export function limits(plan: PlanOption) {
  const stores = plan.maxStores === null ? "lojas sem limite" : `até ${plan.maxStores} ${plan.maxStores === 1 ? "loja" : "lojas"}`;
  const members =
    plan.maxMembers === null ? "membros sem limite" : `até ${plan.maxMembers} ${plan.maxMembers === 1 ? "membro" : "membros"}`;
  return `${stores}, ${members}`;
}

// Rendered inside the dialog content, so each opening starts with a fresh state.
function PlanForm({ organization, plans, onDone }: { organization: PlanTarget; plans: PlanOption[]; onDone: () => void }) {
  const [state, action] = useActionState(async (previous: PlanChangeState, formData: FormData) => {
    const result = await changeOrganizationPlanAction(previous, formData);
    // Without warnings there is nothing more to read: close right away.
    if (result.status === "success" && !result.warnings?.length) onDone();
    return result;
  }, idleState as PlanChangeState);

  if (state.status === "success" && state.warnings?.length) {
    return (
      <div className="space-y-4">
        <Notice tone="success" title={state.message ?? "Plano alterado."} />
        <Notice tone="warning" title="A empresa está acima dos limites do novo plano">
          <ul className="list-disc space-y-1 pl-4">
            {state.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
        <div className="flex justify-end">
          <Button onClick={onDone}>Fechar</Button>
        </div>
      </div>
    );
  }

  const known = plans.some((plan) => plan.key === organization.planKey);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <input type="hidden" name="organizationId" value={organization.id} />
      <Field
        label="Novo plano"
        hint="Os limites valem para novos cadastros. Lojas e membros existentes não são removidos se a empresa ficar acima deles."
        error={state.fieldErrors?.planKey}
        required
      >
        {(props) => (
          <Select {...props} name="planKey" defaultValue={known ? organization.planKey : ""} required>
            {known ? null : <option value="">Selecione</option>}
            {plans.map((plan) => (
              <option key={plan.key} value={plan.key}>
                {`${plan.name} — ${limits(plan)}${plan.key === organization.planKey ? " (atual)" : ""}`}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton pendingLabel="Alterando…">Alterar plano</SubmitButton>
      </div>
    </form>
  );
}

export function PlanDialog({ organization, plans }: { organization: PlanTarget; plans: PlanOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={`Alterar o plano de ${organization.name}`}
      description="A alteração vale imediatamente e fica registrada na auditoria da empresa."
      trigger={
        <Button variant="ghost" size="sm" aria-label={`Alterar plano de ${organization.name}`}>
          <Layers className="size-4" aria-hidden /> Plano
        </Button>
      }
    >
      <PlanForm organization={organization} plans={plans} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

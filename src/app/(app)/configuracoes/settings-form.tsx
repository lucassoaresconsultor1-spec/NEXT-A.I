"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/feedback";
import { Field, Input, Select, SubmitButton } from "@/components/ui/form";
import { useFormAction } from "@/components/ui/use-form-action";
import { BRAZIL_TIMEZONES } from "@/lib/brazil";
import { formatCnpj } from "@/lib/documents";
import { updateOrganizationProfileAction } from "./actions";

export interface ProfileValues {
  name: string;
  legalName: string | null;
  document: string | null;
  timezone: string;
}

// Rendered inside the dialog content, so each opening starts with a fresh form state.
function CompanyProfileForm({ profile, onDone }: { profile: ProfileValues; onDone: () => void }) {
  const [state, action] = useFormAction(updateOrganizationProfileAction, onDone);
  const knownZone = BRAZIL_TIMEZONES.some((zone) => zone.value === profile.timezone);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      <Field label="Nome da empresa" hint="Nome exibido no sistema para toda a equipe." error={state.fieldErrors?.name} required>
        {(props) => <Input {...props} name="name" defaultValue={profile.name} maxLength={120} autoComplete="organization" required />}
      </Field>
      <Field label="Razão social" error={state.fieldErrors?.legalName}>
        {(props) => <Input {...props} name="legalName" defaultValue={profile.legalName ?? ""} maxLength={160} />}
      </Field>
      <Field label="CNPJ" hint="Opcional. Aceita o CNPJ alfanumérico." error={state.fieldErrors?.document}>
        {(props) => (
          <Input
            {...props}
            name="document"
            defaultValue={profile.document ? formatCnpj(profile.document) : ""}
            maxLength={18}
            autoCapitalize="characters"
            placeholder="00.000.000/0000-00"
          />
        )}
      </Field>
      <Field
        label="Fuso horário"
        hint="Usado nas datas exibidas e nas lojas que não definem fuso próprio."
        error={state.fieldErrors?.timezone}
        required
      >
        {(props) => (
          <Select {...props} name="timezone" defaultValue={knownZone ? profile.timezone : ""} required>
            {knownZone ? null : <option value="">Selecione</option>}
            {BRAZIL_TIMEZONES.map((zone) => (
              <option key={zone.value} value={zone.value}>
                {zone.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
        <SubmitButton>Salvar</SubmitButton>
      </div>
    </form>
  );
}

export function CompanyProfileDialog({ profile }: { profile: ProfileValues }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Editar dados da empresa"
      description="Plano e situação da empresa são definidos pela administração da plataforma."
      trigger={
        <Button variant="secondary" size="sm">
          <Pencil className="size-4" aria-hidden /> Editar
        </Button>
      }
    >
      <CompanyProfileForm profile={profile} onDone={() => setOpen(false)} />
    </Dialog>
  );
}

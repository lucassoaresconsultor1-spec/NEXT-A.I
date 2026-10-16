"use client";

import { Notice } from "@/components/ui/feedback";
import { useFormAction } from "@/components/ui/use-form-action";
import { updateMemberAccessAction } from "./actions";
import { PendingSubmit, RoleField, submitKeepingValues, type RoleOption } from "./member-form-parts";
import { MemberScopeFields, type ScopeOptions, type ScopeValues } from "./member-scope-fields";

/** Role and scope of another member; the links are replaced as a whole on save. */
export function MemberAccessForm({
  membershipId,
  roles,
  scope,
  current,
}: {
  membershipId: string;
  roles: RoleOption[];
  scope: ScopeOptions;
  current: ScopeValues & { roleId: string };
}) {
  const [state, action, pending] = useFormAction(updateMemberAccessAction);
  return (
    <form action={action} onSubmit={submitKeepingValues(action)} className="space-y-5" noValidate>
      {state.status === "error" && state.message ? <Notice tone="error" title={state.message} /> : null}
      {state.status === "success" && state.message ? <Notice tone="success" title={state.message} /> : null}
      <input type="hidden" name="id" value={membershipId} />
      <RoleField roles={roles} defaultValue={current.roleId} error={state.fieldErrors?.roleId} />
      <MemberScopeFields options={scope} defaults={current} errors={state.fieldErrors} />
      <div className="flex justify-end">
        <PendingSubmit pending={pending} pendingLabel="Salvando…">
          Salvar acesso
        </PendingSubmit>
      </div>
    </form>
  );
}

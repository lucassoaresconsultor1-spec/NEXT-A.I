"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { invalidState, pick } from "@/server/forms";
import { organizationProfileSchema, updateOrganizationProfile } from "@/server/organizations/service";

export async function updateOrganizationProfileAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = organizationProfileSchema.safeParse(pick(formData, ["name", "legalName", "document", "timezone"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateOrganizationProfile(context, parsed.data);
      // The organization name and time zone appear across the whole shell.
      revalidatePath("/", "layout");
    },
    "Dados da empresa atualizados.",
    "updateOrganizationProfile",
  );
}

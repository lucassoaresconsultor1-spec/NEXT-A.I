"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { recordLogout, listUserOrganizations } from "@/server/auth/service";
import { deleteSessionCookie, getCurrentSession, invalidateSession, updateSessionContext } from "@/server/auth/session";
import { requireTenantContext } from "@/server/authz/context";
import { listStoreOptions } from "@/server/stores/options";
import { getRequestMeta } from "@/server/http";

export async function signOutAction() {
  const session = await getCurrentSession();
  if (session) {
    await invalidateSession(session.id);
    await recordLogout(session.user.id, await getRequestMeta());
  }
  await deleteSessionCookie();
  redirect("/entrar");
}

const idSchema = z.uuid();

/** Switches organization only when the user holds an active membership there. */
export async function switchOrganizationAction(formData: FormData) {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  const parsed = idSchema.safeParse(formData.get("organizationId"));
  if (!parsed.success) redirect("/selecionar-empresa");
  const allowed = await listUserOrganizations(session.user.id);
  if (!allowed.some((organization) => organization.id === parsed.data && organization.status === "active")) {
    redirect("/selecionar-empresa?indisponivel=1");
  }
  await updateSessionContext(session.id, { activeOrganizationId: parsed.data, activeStoreId: null });
  redirect("/painel");
}

/** Empty value clears the selection ("todas as lojas do escopo"). */
export async function selectStoreAction(formData: FormData) {
  const context = await requireTenantContext();
  const raw = formData.get("storeId");
  const storeId = typeof raw === "string" && raw !== "" ? idSchema.safeParse(raw).data : null;
  if (storeId === undefined) return;
  // Must be an active store of this organization inside the member's scope.
  if (storeId && !(await listStoreOptions(context)).some((store) => store.id === storeId)) return;
  await updateSessionContext(context.sessionId, { activeStoreId: storeId });
  revalidatePath("/", "layout");
}

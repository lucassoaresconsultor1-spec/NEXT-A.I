"use server";

import { redirect } from "next/navigation";
import { changePasswordSchema, signInSchema, signUpSchema } from "@/server/auth/schemas";
import { changePassword, signIn, signUp } from "@/server/auth/service";
import { getCurrentSession, setSessionCookie } from "@/server/auth/session";
import { isDomainError } from "@/server/errors";
import { invalidState, pick, type ActionState } from "@/server/forms";
import { getRequestMeta } from "@/server/http";
import { logger } from "@/lib/logger";

function failure(error: unknown, action: string): ActionState {
  if (isDomainError(error)) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
  logger.error({ action, err: { name: (error as Error)?.name, code: (error as { code?: string })?.code } }, "Auth action failed");
  return { status: "error", message: "Não foi possível concluir agora. Tente novamente em instantes." };
}

/** Only same-site relative paths, so `next` cannot become an open redirect. */
function safeNext(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : null;
}

export async function signInAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(pick(formData, ["email", "password"]));
  if (!parsed.success) return invalidState(parsed.error);
  let destination: string;
  try {
    const result = await signIn(parsed.data, await getRequestMeta());
    await setSessionCookie(result.token);
    if (result.mustChangePassword) destination = "/alterar-senha";
    else if (result.organizationCount === 1) destination = safeNext(formData.get("next")) ?? "/painel";
    else if (result.organizationCount === 0 && result.isPlatformAdmin) destination = "/plataforma";
    else destination = "/selecionar-empresa";
  } catch (error) {
    return failure(error, "signIn");
  }
  redirect(destination);
}

export async function signUpAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(
    pick(formData, ["name", "email", "password", "organizationName", "organizationDocument"]),
  );
  if (!parsed.success) return invalidState(parsed.error);
  try {
    const session = await signUp(parsed.data, await getRequestMeta());
    await setSessionCookie(session.token);
  } catch (error) {
    return failure(error, "signUp");
  }
  redirect("/painel?boas-vindas=1");
}

export async function changePasswordAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getCurrentSession();
  if (!session) redirect("/entrar");
  const parsed = changePasswordSchema.safeParse(pick(formData, ["currentPassword", "newPassword", "confirmPassword"]));
  if (!parsed.success) return invalidState(parsed.error);
  try {
    await changePassword({ id: session.id, userId: session.user.id }, parsed.data, await getRequestMeta());
  } catch (error) {
    return failure(error, "changePassword");
  }
  redirect(session.activeOrganizationId ? "/painel?senha-alterada=1" : "/selecionar-empresa");
}

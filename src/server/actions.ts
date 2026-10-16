import "server-only";
import { unstable_rethrow } from "next/navigation";
import { logger } from "@/lib/logger";
import { isDomainError } from "./errors";
import type { ActionState } from "@/lib/action-state";

/**
 * Runs a Server Action body and maps the outcome to form state. Domain errors
 * keep their safe message; anything else is logged and shown generically, so
 * stack traces and SQL details never reach the browser.
 */
export async function runAction(work: () => Promise<void>, successMessage: string, action: string): Promise<ActionState> {
  try {
    await work();
    return { status: "success", message: successMessage };
  } catch (error) {
    unstable_rethrow(error);
    if (isDomainError(error)) return { status: "error", message: error.message, fieldErrors: error.fieldErrors };
    logger.error({ action, err: { name: (error as Error)?.name, code: (error as { code?: string })?.code } }, "Action failed");
    return { status: "error", message: "Não foi possível concluir a operação. Tente novamente." };
  }
}

"use client";

import { useActionState } from "react";
import { idleState, type ActionState } from "@/lib/action-state";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** useActionState plus a callback on success (e.g. closing the dialog that hosts the form). */
export function useFormAction(action: FormAction, onSuccess?: () => void) {
  return useActionState(async (state: ActionState, formData: FormData) => {
    const result = await action(state, formData);
    if (result.status === "success") onSuccess?.();
    return result;
  }, idleState);
}

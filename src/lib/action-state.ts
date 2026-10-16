// State returned by Server Actions and read by client forms (useActionState).
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export const idleState: ActionState = { status: "idle" };

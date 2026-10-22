"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { deleteHoliday, saveHoliday, setStoreWorkWeek } from "@/server/calendar/service";
import { holidaySchema, workWeekSchema } from "@/server/calendar/schemas";
import { invalidState, pick, pickAll } from "@/server/forms";

const idSchema = z.uuid();
const invalidId = { status: "error", message: "Data inválida." } as const satisfies ActionState;

export async function saveHolidayAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = z.union([z.literal(""), z.uuid()]).safeParse(pick(formData, ["id"]).id);
  if (!id.success) return invalidState(id.error);
  const input = holidaySchema.safeParse(pick(formData, ["storeId", "day", "name", "kind", "closed"]));
  if (!input.success) return invalidState(input.error);
  return runAction(async () => {
    await saveHoliday(context, input.data, id.data || undefined);
    revalidatePath("/calendario");
  }, "Calendário salvo.", "saveCalendarHoliday");
}

export async function deleteHolidayAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return invalidId;
  return runAction(async () => {
    await deleteHoliday(context, id.data);
    revalidatePath("/calendario");
  }, "Data excluída.", "deleteCalendarHoliday");
}

export async function saveWorkWeekAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = z.object({ storeId: z.uuid() }).safeParse(pick(formData, ["storeId"]));
  if (!parsed.success) return invalidState(parsed.error);
  const weekdays = workWeekSchema.safeParse({ weekdays: pickAll(formData, "weekdays") });
  if (!weekdays.success) return invalidState(weekdays.error);
  return runAction(async () => {
    await setStoreWorkWeek(context, parsed.data.storeId, weekdays.data);
    revalidatePath("/calendario");
  }, "Calendário salvo.", "saveStoreWorkWeek");
}

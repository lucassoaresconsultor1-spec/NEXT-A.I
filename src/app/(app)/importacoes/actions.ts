"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/guard";
import { invalid } from "@/server/errors";
import { confirmImport, createImport, discardImport } from "@/server/imports/service";
import { autoMapping, IMPORT_FIELDS, IMPORT_KINDS, type ImportKind } from "@/server/imports/schemas";
import { invalidState, pick } from "@/server/forms";

const INVALID = { status: "error", message: "Importação inválida." } as const satisfies ActionState;
const idSchema = z.uuid();
export type HeaderActionState = ActionState & { kind?: ImportKind; fileName?: string; headers?: string[]; suggestedMapping?: Record<string, string> };
export type CreateActionState = ActionState & { importId?: string };

function uploadedFile(formData: FormData): File | null {
  const value = formData.get("file");
  return typeof File !== "undefined" && value instanceof File && value.name !== "" ? value : null;
}

export async function readCsvHeadersAction(formData: FormData): Promise<HeaderActionState> {
  const context = await requireTenantContext();
  assertCan(context, "imports.manage");
  const input = z.object({ kind: z.enum(IMPORT_KINDS), storeId: z.union([z.literal(""), z.uuid()]) }).safeParse(pick(formData, ["kind", "storeId"]));
  if (!input.success) return invalidState(input.error);
  const file = uploadedFile(formData);
  if (!file) return { ...INVALID, fieldErrors: { file: ["Selecione um arquivo CSV."] } };
  const safeName = z.string().trim().min(1).max(200).safeParse(file.name);
  if (!safeName.success) return { ...INVALID, fieldErrors: { file: ["O nome do arquivo precisa ter até 200 caracteres."] } };
  if (!safeName.data.toLowerCase().endsWith(".csv")) return { ...INVALID, fieldErrors: { file: ["Envie um arquivo com extensão .csv."] } };
  let result: Pick<HeaderActionState, "kind" | "fileName" | "headers" | "suggestedMapping"> | undefined;
  const state = await runAction(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = decodeCsv(bytes);
    if (!decoded.ok) throw invalid(decoded.message, { file: [decoded.message] });
    const csv = parseCsv(decoded.text);
    if (!csv.ok) throw invalid(csv.message, { file: [csv.message] });
    result = { kind: input.data.kind, fileName: safeName.data, headers: csv.header, suggestedMapping: autoMapping(input.data.kind, csv.header) };
  }, "Cabeçalho do CSV lido.", "readImportCsvHeaders");
  return { ...state, ...result };
}

export async function createImportAction(formData: FormData): Promise<CreateActionState> {
  const context = await requireTenantContext();
  assertCan(context, "imports.manage");
  const file = uploadedFile(formData);
  const kind = z.enum(IMPORT_KINDS).safeParse(formData.get("kind"));
  if (!file) return { ...INVALID, fieldErrors: { file: ["Selecione novamente o arquivo CSV."] } };
  if (!kind.success) return { ...INVALID, fieldErrors: { kind: ["Escolha um tipo de importação válido."] } };
  if (!file.name.toLowerCase().endsWith(".csv")) return { ...INVALID, fieldErrors: { file: ["Envie um arquivo com extensão .csv."] } };
  const mapping = Object.fromEntries(IMPORT_FIELDS[kind.data].map(({ key }) => [key, formData.get(`mapping.${key}`) ?? ""]));
  const rawInput = { ...pick(formData, ["kind", "storeId"]), fileName: file.name, mapping };
  let importId: string | undefined;
  const state = await runAction(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const created = await createImport(context, rawInput, bytes);
    importId = created.id;
    revalidatePath("/importacoes");
    revalidatePath(`/importacoes/${created.id}`);
  }, "Prévia da importação criada.", "createImport");
  return { ...state, ...(state.status === "success" && importId ? { importId } : {}) };
}

async function executeImportAction(context: Awaited<ReturnType<typeof requireTenantContext>>, importId: string, operation: "confirm" | "discard"): Promise<ActionState> {
  return runAction(async () => {
    if (operation === "confirm") await confirmImport(context, importId);
    else await discardImport(context, importId);
    revalidatePath("/importacoes");
    revalidatePath(`/importacoes/${importId}`);
  }, operation === "confirm" ? "Importação confirmada." : "Prévia descartada.", `${operation}Import`);
}

export async function confirmImportAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  assertCan(context, "imports.manage");
  const id = idSchema.safeParse(formData.get("importId"));
  if (!id.success) return INVALID;
  return executeImportAction(context, id.data, "confirm");
}

export async function discardImportAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  assertCan(context, "imports.manage");
  const id = idSchema.safeParse(formData.get("importId"));
  if (!id.success) return INVALID;
  return executeImportAction(context, id.data, "discard");
}




"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/authz/context";
import { searchVariants } from "@/server/catalog/variant-search";
import { getProduct } from "@/server/catalog/service";
import { listCustomers } from "@/server/customers/service";
import { listSalespeople } from "@/server/salespeople/service";
import { completeSale, findSaleByCompletionKey } from "@/server/sales/complete";
import { getSuspendedSale, listSuspendedSales, suspendSale, discardSuspendedSale } from "@/server/sales/suspend";
import { pick } from "@/server/forms";
import { can } from "@/server/authz/guard";

const uuid = z.uuid();
const jsonInput = z.string().min(2).max(100_000).transform((text, ctx) => { try { return JSON.parse(text) as unknown; } catch { ctx.addIssue({ code: "custom", message: "Dados inválidos." }); return z.NEVER; } });
type ResultState = ActionState & { data?: unknown };

export async function searchVariantsAction(q: string): Promise<ResultState> {
  const context = await requireTenantContext();
  if (!can(context, "sales.create")) return { status: "error", message: "Acesso não permitido." };
  const query = z.string().trim().min(2).max(80).safeParse(q);
  if (!query.success) return { status: "success", data: [] };
  let data: unknown;
  const state = await runAction(async () => {
    const hits = await searchVariants(context, query.data, { activeOnly: true });
    const prices = new Map<string, Map<string, number | null>>();
    await Promise.all([...new Set(hits.map((hit) => hit.productId))].map(async (productId) => {
      const product = await getProduct(context, productId);
      prices.set(productId, new Map(product?.variants.map((variant) => [variant.id, variant.priceCents]) ?? []));
    }));
    data = hits.map((hit) => ({ ...hit, priceCents: prices.get(hit.productId)?.get(hit.variantId) ?? null })).filter((hit) => hit.priceCents !== null);
  }, "", "searchPdvVariants");
  return { ...state, ...(data ? { data } : {}) };
}

export async function searchCustomersAction(q: string): Promise<ResultState> {
  const context = await requireTenantContext();
  if (!can(context, "sales.create") || !can(context, "customers.read")) return { status: "error", message: "Acesso não permitido." };
  const query = z.string().trim().min(2).max(80).safeParse(q);
  if (!query.success) return { status: "success", data: [] };
  let data: unknown;
  const state = await runAction(async () => { data = (await listCustomers(context, { q: query.data, status: "active", page: 1 })).rows.slice(0, 10).map(({ id, name, document }) => ({ id, name, document })); }, "", "searchPdvCustomers");
  return { ...state, ...(data ? { data } : {}) };
}

export async function listPdvSalespeopleAction(storeId: string): Promise<ResultState> {
  const context = await requireTenantContext();
  if (!can(context, "sales.create") || !can(context, "members.read")) return { status: "error", message: "Acesso não permitido." };
  const id = uuid.safeParse(storeId);
  if (!id.success) return { status: "error", message: "Loja inválida." };
  let data: unknown;
  const state = await runAction(async () => { data = (await listSalespeople(context, { storeId: id.data, status: "active", page: 1 })).rows.map(({ userId, name, nickname, code }) => ({ userId, label: nickname || name, code })); }, "", "listPdvSalespeople");
  return { ...state, ...(data ? { data } : {}) };
}

export async function completeSaleAction(formData: FormData): Promise<ResultState> {
  const context = await requireTenantContext();
  const parsed = z.object({ input: jsonInput }).safeParse(pick(formData, ["input"]));
  if (!parsed.success) return { status: "error", message: "Revise os dados da venda." };
  let data: unknown;
  const state = await runAction(async () => { data = await completeSale(context, parsed.data.input); revalidatePath("/pdv"); }, "Venda finalizada.", "completePdvSale");
  return { ...state, ...(data ? { data } : {}) };
}

export async function findSaleByCompletionKeyAction(key: string): Promise<ResultState> {
  const context = await requireTenantContext();
  const parsed = uuid.safeParse(key);
  if (!parsed.success) return { status: "error", message: "Chave de finalização inválida." };
  let data: unknown;
  const state = await runAction(async () => { data = await findSaleByCompletionKey(context, parsed.data); }, "", "verifyPdvSale");
  return { ...state, ...(data ? { data } : {}) };
}

export async function suspendSaleAction(formData: FormData): Promise<ResultState> {
  const context = await requireTenantContext();
  const parsed = z.object({ input: jsonInput }).safeParse(pick(formData, ["input"]));
  if (!parsed.success) return { status: "error", message: "Revise os dados da venda." };
  let data: unknown;
  const state = await runAction(async () => { data = await suspendSale(context, parsed.data.input); revalidatePath("/pdv"); }, "Venda suspensa.", "suspendPdvSale");
  return { ...state, ...(data ? { data } : {}) };
}

export async function listSuspendedAction(storeId: string): Promise<ResultState> {
  const context = await requireTenantContext();
  const id = uuid.safeParse(storeId);
  if (!id.success) return { status: "error", message: "Loja inválida." };
  let data: unknown;
  const state = await runAction(async () => { data = await listSuspendedSales(context, id.data); }, "", "listPdvSuspended");
  return { ...state, ...(data ? { data } : {}) };
}

export async function resumeSaleAction(saleId: string): Promise<ResultState> {
  const context = await requireTenantContext();
  const id = uuid.safeParse(saleId);
  if (!id.success) return { status: "error", message: "Venda inválida." };
  let data: unknown;
  const state = await runAction(async () => { data = await getSuspendedSale(context, id.data); }, "Venda carregada.", "resumePdvSale");
  return { ...state, ...(data ? { data } : {}) };
}

export async function discardSaleAction(formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = z.object({ saleId: z.uuid(), reason: z.string().trim().min(3).max(240) }).safeParse(pick(formData, ["saleId", "reason"]));
  if (!parsed.success) return { status: "error", message: "Informe o motivo do descarte." };
  return runAction(async () => { await discardSuspendedSale(context, parsed.data.saleId, { reason: parsed.data.reason }); revalidatePath("/pdv"); }, "Venda descartada.", "discardPdvSale");
}

export async function rotatePdvKeysAction(): Promise<ResultState> {
  const context = await requireTenantContext();
  if (!can(context, "sales.create")) return { status: "error", message: "Acesso não permitido." };
  return { status: "success", data: { completionKey: randomUUID(), suspensionKey: randomUUID() } };
}


"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { parseBrlToCents } from "@/lib/money";
import { runAction } from "@/server/actions";
import { requireTenantContext, type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { setVariantCost, setVariantPrice } from "@/server/catalog/pricing";
import { createProductSchema, newVariantSchema, productInputSchema, variantInputSchema } from "@/server/catalog/schemas";
import { createProduct, setProductActive, updateProduct } from "@/server/catalog/service";
import { addVariant, setVariantActive, updateVariant } from "@/server/catalog/variants";
import { invalidState, pick } from "@/server/forms";
import { formFieldErrors, readVariantRows } from "./variant-form-data";

const INVALID_PRODUCT = { status: "error", message: "Produto inválido." } as const satisfies ActionState;
const INVALID_VARIANT = { status: "error", message: "Variação inválida." } as const satisfies ActionState;
const MONEY_MESSAGE = "Informe um valor em reais, como 12,90.";
const UNCHANGED_MESSAGE = "O valor informado já era o vigente.";
const PRODUCT_FIELDS = ["name", "description", "categoryId", "brandId", "supplierId"] as const;

const idSchema = z.uuid();
const statusSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

/** Costs are only read from the form when the member could set them; the service refuses anyway. */
const canManageCosts = (context: TenantContext) =>
  can(context, "catalog.manage") && context.storeScope.all && can(context, "catalog.costs.read");

const fieldErrorState = (fieldErrors: Record<string, string[]>): ActionState => ({
  status: "error",
  message: "Revise os campos destacados.",
  fieldErrors,
});

function revalidateProduct(productId?: string) {
  revalidatePath("/produtos");
  if (productId) revalidatePath(`/produtos/${productId}`);
}

/** Optional money field typed in reais: "" -> undefined, invalid -> null. */
function optionalMoney(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return parseBrlToCents(value);
}

export async function createProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const read = readVariantRows(formData, { withCost: canManageCosts(context) });
  const input = { ...pick(formData, [...PRODUCT_FIELDS, "unit"]), variants: read.rows };
  // Same schema as the service, checked here so variant errors land on the right form row.
  const parsed = createProductSchema.safeParse(input);
  const fieldErrors = { ...read.fieldErrors, ...(parsed.success ? {} : formFieldErrors(parsed.error, read.formIndexes)) };
  if (!parsed.success || Object.keys(fieldErrors).length > 0) return fieldErrorState(fieldErrors);
  let createdId: string | undefined;
  const state = await runAction(
    async () => {
      createdId = (await createProduct(context, parsed.data)).id;
      revalidateProduct();
    },
    "Produto cadastrado.",
    "createProduct",
  );
  if (createdId) redirect(`/produtos/${createdId}?criado=1`);
  return state;
}

export async function updateProductAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const id = idSchema.safeParse(formData.get("productId"));
  if (!id.success) return INVALID_PRODUCT;
  const parsed = productInputSchema.safeParse(pick(formData, PRODUCT_FIELDS));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateProduct(context, id.data, parsed.data);
      revalidateProduct(id.data);
    },
    "Produto atualizado.",
    "updateProduct",
  );
}

export async function setProductActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  if (!parsed.success) return INVALID_PRODUCT;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setProductActive(context, parsed.data.id, active);
      revalidateProduct(parsed.data.id);
    },
    active ? "Produto ativado." : "Produto desativado.",
    "setProductActive",
  );
}

export async function addVariantAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const productId = idSchema.safeParse(formData.get("productId"));
  if (!productId.success) return INVALID_PRODUCT;
  const priceCents = optionalMoney(formData, "price");
  const costCents = canManageCosts(context) ? optionalMoney(formData, "cost") : undefined;
  const moneyErrors: Record<string, string[]> = {};
  if (priceCents === null) moneyErrors.price = [MONEY_MESSAGE];
  if (costCents === null) moneyErrors.cost = [MONEY_MESSAGE];
  if (Object.keys(moneyErrors).length > 0) return fieldErrorState(moneyErrors);
  const parsed = newVariantSchema.safeParse({ ...pick(formData, ["name", "sku", "barcode"]), priceCents, costCents });
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await addVariant(context, productId.data, parsed.data);
      revalidateProduct(productId.data);
    },
    "Variação adicionada.",
    "addVariant",
  );
}

export async function updateVariantAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const variantId = idSchema.safeParse(formData.get("variantId"));
  const productId = idSchema.safeParse(formData.get("productId"));
  if (!variantId.success || !productId.success) return INVALID_VARIANT;
  const parsed = variantInputSchema.safeParse(pick(formData, ["name", "sku", "barcode"]));
  if (!parsed.success) return invalidState(parsed.error);
  return runAction(
    async () => {
      await updateVariant(context, variantId.data, parsed.data);
      revalidateProduct(productId.data);
    },
    "Variação atualizada.",
    "updateVariant",
  );
}

export async function setVariantActiveAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireTenantContext();
  const parsed = statusSchema.safeParse(pick(formData, ["id", "active"]));
  const productId = idSchema.safeParse(formData.get("productId"));
  if (!parsed.success || !productId.success) return INVALID_VARIANT;
  const active = parsed.data.active === "true";
  return runAction(
    async () => {
      await setVariantActive(context, parsed.data.id, active);
      revalidateProduct(productId.data);
    },
    active ? "Variação ativada." : "Variação desativada.",
    "setVariantActive",
  );
}

/** Price or cost change; "no change" is reported as success with its own message. */
async function changeAmount(formData: FormData, field: "price" | "cost", stableName: string): Promise<ActionState> {
  const context = await requireTenantContext();
  const variantId = idSchema.safeParse(formData.get("variantId"));
  const productId = idSchema.safeParse(formData.get("productId"));
  if (!variantId.success || !productId.success) return INVALID_VARIANT;
  const cents = optionalMoney(formData, field);
  if (cents === undefined || cents === null) return fieldErrorState({ [field]: [MONEY_MESSAGE] });
  let changed = true;
  const state = await runAction(
    async () => {
      const result = field === "price" ? await setVariantPrice(context, variantId.data, cents) : await setVariantCost(context, variantId.data, cents);
      changed = result.changed;
      revalidateProduct(productId.data);
    },
    field === "price" ? "Preço atualizado." : "Custo atualizado.",
    stableName,
  );
  return state.status === "success" && !changed ? { ...state, message: UNCHANGED_MESSAGE } : state;
}

export async function setVariantPriceAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return changeAmount(formData, "price", "setVariantPrice");
}

export async function setVariantCostAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  return changeAmount(formData, "cost", "setVariantCost");
}

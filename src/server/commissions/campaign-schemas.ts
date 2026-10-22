import { z } from "zod";
import { isValidCalendarDay, type CalendarDay } from "@/lib/business-days";
import { requiredText } from "@/server/forms";
import { parsePage } from "@/server/pagination";

// Pure rules of the commission campaigns (m35a): validation and the bonus of a sale
// item. Overlapping campaigns do not add up: the highest bonus wins.

const MAX_DAYS = 366;
const day = (label: string) => z.string({ error: `Informe ${label}.` }).refine(isValidCalendarDay, { error: "Informe uma data válida." });
const ids = z.array(z.uuid({ error: "Item inválido." })).max(200, { error: "Use no máximo 200 itens." }).default([]);
const unique = (values: string[]) => new Set(values).size === values.length;

export const campaignInputSchema = z
  .object({
    name: requiredText("o nome da campanha", 80, 3),
    storeId: z.preprocess((value) => (value === "" ? undefined : value), z.uuid({ error: "Loja inválida." }).optional()),
    startsOn: day("o início"),
    endsOn: day("o fim"),
    bonusRateBps: z.coerce.number({ error: "Informe o bônus." }).int({ error: "Use o bônus em pontos-base (1% = 100)." }).min(1, { error: "O bônus precisa ser maior que zero." }).max(10_000, { error: "O bônus vai até 100%." }),
    productIds: ids,
    categoryIds: ids,
  })
  .superRefine((input, context) => {
    if (input.endsOn < input.startsOn) context.addIssue({ code: "custom", path: ["endsOn"], message: "O fim não pode ser anterior ao início." });
    else if ((Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000 + 1 > MAX_DAYS) {
      context.addIssue({ code: "custom", path: ["endsOn"], message: `Use um período de até ${MAX_DAYS} dias.` });
    }
    if (input.productIds.length + input.categoryIds.length === 0) context.addIssue({ code: "custom", path: ["productIds"], message: "Escolha ao menos um produto ou categoria." });
    if (!unique(input.productIds)) context.addIssue({ code: "custom", path: ["productIds"], message: "Produto repetido." });
    if (!unique(input.categoryIds)) context.addIssue({ code: "custom", path: ["categoryIds"], message: "Categoria repetida." });
  });
export type CampaignInput = z.input<typeof campaignInputSchema>;

export const endCampaignSchema = z.object({ reason: requiredText("o motivo", 240, 3) });

export const CAMPAIGN_STATUSES = ["scheduled", "active", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const campaignFiltersSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES).optional().catch(undefined),
  page: z.unknown().optional().transform(parsePage),
});
export type CampaignFilters = z.input<typeof campaignFiltersSchema>;

export interface CampaignVersion {
  id: string;
  storeId: string | null;
  startsOn: CalendarDay;
  endsOn: CalendarDay;
  bonusRateBps: number;
  productIds: Set<string>;
  categoryIds: Set<string>;
}

/** Bonus of an item sold on `day` in `storeId`: the highest of the campaigns in force; ties go to the earlier start, then the lower id. */
export function campaignBonus(campaigns: CampaignVersion[], storeId: string, day: CalendarDay, productId: string, categoryId: string | null) {
  let best: CampaignVersion | null = null;
  for (const campaign of campaigns) {
    if (campaign.storeId !== null && campaign.storeId !== storeId) continue;
    if (day < campaign.startsOn || day > campaign.endsOn) continue;
    if (!campaign.productIds.has(productId) && !(categoryId && campaign.categoryIds.has(categoryId))) continue;
    if (!best || campaign.bonusRateBps > best.bonusRateBps || (campaign.bonusRateBps === best.bonusRateBps && (campaign.startsOn < best.startsOn || (campaign.startsOn === best.startsOn && campaign.id < best.id)))) best = campaign;
  }
  return best ? { campaignId: best.id, bonusRateBps: best.bonusRateBps } : { campaignId: null, bonusRateBps: 0 };
}

import { describe, expect, it } from "vitest";
import { campaignBonus, campaignInputSchema, type CampaignVersion } from "./campaign-schemas";

const campaign = (values: Partial<CampaignVersion> & { id: string }): CampaignVersion => ({
  storeId: null,
  startsOn: "2027-03-01",
  endsOn: "2027-03-31",
  bonusRateBps: 100,
  productIds: new Set(["p1"]),
  categoryIds: new Set(["c1"]),
  ...values,
});

describe("campaignBonus", () => {
  it("applies only inside the period, store and items, and breaks ties by start then id", () => {
    const campaigns = [campaign({ id: "b", bonusRateBps: 300 }), campaign({ id: "a", bonusRateBps: 300 }), campaign({ id: "c", bonusRateBps: 300, startsOn: "2027-02-01" }), campaign({ id: "s", bonusRateBps: 900, storeId: "store-2" })];
    expect(campaignBonus(campaigns, "store-1", "2027-03-10", "p1", null)).toEqual({ campaignId: "c", bonusRateBps: 300 });
    expect(campaignBonus(campaigns.slice(0, 2), "store-1", "2027-03-10", "px", "c1")).toEqual({ campaignId: "a", bonusRateBps: 300 });
    expect(campaignBonus(campaigns, "store-2", "2027-03-31", "p1", null)).toEqual({ campaignId: "s", bonusRateBps: 900 });
    expect(campaignBonus(campaigns, "store-1", "2027-04-01", "p1", "c1")).toEqual({ campaignId: null, bonusRateBps: 0 });
    expect(campaignBonus(campaigns, "store-1", "2027-03-10", "px", null)).toEqual({ campaignId: null, bonusRateBps: 0 });
  });

  it("requires items and a period of up to 366 days", () => {
    const base = { name: "Verão", startsOn: "2027-03-01", endsOn: "2027-03-31", bonusRateBps: 100 };
    expect(campaignInputSchema.safeParse(base).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, productIds: ["00000000-0000-4000-8000-000000000001"], endsOn: "2028-03-31" }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, categoryIds: ["00000000-0000-4000-8000-000000000001"] }).success).toBe(true);
  });
});

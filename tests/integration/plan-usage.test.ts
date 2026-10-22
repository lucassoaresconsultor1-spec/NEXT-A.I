import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { organizations, planFeatures, plans, users } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setModelProviderForTests } from "@/server/ai/registry";
import { callModel } from "@/server/ai/service";
import { getPlanUsage } from "@/server/plans/usage";
import { setPlanAiLimit } from "@/server/platform/service";
import { createFakeModelProvider, textResponse } from "../support/fake-model-provider";
import { createOrganizationFixture, uniqueEmail } from "./fixtures";

afterEach(() => setModelProviderForTests(undefined));

const call = { feature: "assistant" as const, system: "Teste.", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Oi" }] }] };

describe("plan usage", () => {
  it("measures the monthly AI usage and enforces the plan limit only when configured", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    // A plan of this test only, so other tests never see its limit.
    const planKey = `teste-${randomUUID().slice(0, 8)}`;
    const adminId = randomUUID();
    await getDb().insert(plans).values({ key: planKey, name: "Plano de teste", description: "Somente para testes." });
    await getDb().insert(planFeatures).values({ planKey, feature: "ai_assistant" });
    await getDb().insert(users).values({ id: adminId, email: uniqueEmail("platform"), name: "Admin", passwordHash: "unused", isPlatformAdmin: true, status: "active" });
    await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey }).where(eq(organizations.id, organizationId)));

    const provider = createFakeModelProvider();
    setModelProviderForTests(provider);
    expect((await getPlanUsage(owner)).ai).toMatchObject({ calls: 0, tokens: 0, maxTokens: null });

    await expect(setPlanAiLimit(owner.user.id, planKey, 1000)).rejects.toMatchObject({ code: "forbidden" });
    await setPlanAiLimit(adminId, planKey, 1000);
    for (let index = 0; index < 3; index += 1) provider.script.push(textResponse("Ok.", { inputTokens: 500, outputTokens: 100 }));
    await callModel(owner, call);
    await callModel(owner, call);
    // 1.200 tokens used >= 1.000: the third call is refused before reaching the provider.
    await expect(callModel(owner, call)).rejects.toMatchObject({ code: "limit", message: expect.stringContaining("limite mensal") });
    expect(provider.requests).toHaveLength(2);
    expect(await getPlanUsage(owner)).toMatchObject({ plan: { key: planKey }, ai: { calls: 2, tokens: 1200, maxTokens: 1000, costComplete: false } });

    await setPlanAiLimit(adminId, planKey, null);
    await expect(callModel(owner, call)).resolves.toMatchObject({ stopReason: "end" });
  });
});

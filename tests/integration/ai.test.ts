import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { aiUsageRecords, organizations } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { ModelProviderError } from "@/server/ai/port";
import { setModelProviderForTests } from "@/server/ai/registry";
import { aiStatus, callModel } from "@/server/ai/service";
import { createFakeModelProvider, textResponse } from "../support/fake-model-provider";
import { addMemberFixture, createOrganizationFixture } from "./fixtures";

afterEach(() => setModelProviderForTests(undefined));

const call = { feature: "assistant" as const, system: "Responda em português.", messages: [{ role: "user" as const, content: [{ type: "text" as const, text: "Como foram as vendas?" }] }] };

describe("model adapter", () => {
  it("is pending without a provider, follows plan and permission, and records usage without the conversation", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    setModelProviderForTests(null);
    expect(aiStatus(owner)).toEqual({ configured: false, provider: null, model: null });

    const provider = createFakeModelProvider({ pricing: { inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 } });
    setModelProviderForTests(provider);
    // The default plan has no assistant.
    await expect(callModel(owner, call)).rejects.toMatchObject({ code: "limit" });
    await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey: "inteligencia" }).where(eq(organizations.id, organizationId)));
    setModelProviderForTests(null);
    await expect(callModel(owner, call)).rejects.toMatchObject({ code: "limit", message: expect.stringContaining("pendente") });
    setModelProviderForTests(provider);

    provider.script.push(textResponse("Vendas estáveis.", { inputTokens: 1000, outputTokens: 200 }), new ModelProviderError("rate_limited"));
    expect((await callModel(owner, call)).content).toEqual([{ type: "text", text: "Vendas estáveis." }]);
    await expect(callModel(owner, call)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("muitas solicitações") });
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier" });
    await expect(callModel(cashier.context, call)).rejects.toMatchObject({ code: "forbidden" });

    const rows = await withScope({ organizationId }, (tx) => tx.select().from(aiUsageRecords).where(eq(aiUsageRecords.organizationId, organizationId)));
    expect(rows.map((row) => [row.status, row.inputTokens, row.outputTokens, row.costMicros, row.errorKind]).sort()).toEqual(
      [
        ["error", 0, 0, 0, "rate_limited"],
        ["ok", 1000, 200, 6000, null],
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("Como foram as vendas");
  });
});

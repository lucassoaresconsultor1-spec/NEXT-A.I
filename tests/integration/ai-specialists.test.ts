import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { aiToolRuns, organizations } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { askAssistant, evaluateSpecialistAgainstCentral } from "@/server/ai/agent";
import type { ModelResponse } from "@/server/ai/port";
import { setModelProviderForTests } from "@/server/ai/registry";
import { recordMovement } from "@/server/inventory/service";
import { completeSale } from "@/server/sales/complete";
import { todayIn } from "@/server/targets/schemas";
import { saveProcedure } from "@/server/tasks/procedures";
import { createFakeModelProvider, textResponse } from "../support/fake-model-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, createVariantFixture, openCashSessionFixture, setPriceFixture } from "./fixtures";

afterEach(() => setModelProviderForTests(undefined));

const usage = { inputTokens: 100, outputTokens: 20 };
const toolUse = (name: string, input: unknown): ModelResponse => ({ content: [{ type: "tool_use", id: `call-${name}`, name, input }], stopReason: "tool_use", usage });

describe("assistant specialists", () => {
  it("consults a specialist only after an evaluation measured its benefit", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    await withScope({ organizationId }, (tx) => tx.update(organizations).set({ planKey: "inteligencia" }).where(eq(organizations.id, organizationId)));
    const storeId = await createStoreFixture(organizationId);
    const { variantId } = await createVariantFixture(organizationId);
    await setPriceFixture(organizationId, variantId, 1000);
    await recordMovement(owner, { storeId, variantId, type: "entry", quantity: "5", reason: "Estoque" });
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
    await openCashSessionFixture(organizationId, storeId, cashier.userId, 0);
    await completeSale(cashier.context, { completionKey: randomUUID(), storeId, items: [{ variantId, quantity: "2", expectedUnitPriceCents: 1000 }], payments: [{ method: "cash", amountCents: 2000, tenderedCents: 2000 }] });
    await saveProcedure(owner, { title: "Abertura da loja", body: "Conferir o troco e ligar as luzes da vitrine." });
    const day = todayIn("America/Sao_Paulo");
    const provider = createFakeModelProvider();
    setModelProviderForTests(provider);

    // Without an evaluation the orchestrator has no delegation tool; procedures are searchable.
    provider.script.push(toolUse("search_company_procedures", { query: "vitrine" }), textResponse("Veja o procedimento de abertura."));
    await askAssistant(owner, { question: "Como abrir a loja?" });
    expect(provider.requests[0].tools?.map((tool) => tool.name)).not.toContain("consult_specialist");
    expect(JSON.stringify(provider.requests[1].messages.at(-1))).toContain("Abertura da loja");

    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeId] });
    const cases = { cases: [{ question: "Quanto vendemos hoje?", expectTools: ["get_sales_summary"], expectTexts: ["20,00"] }] };
    await expect(evaluateSpecialistAgainstCentral(manager.context, "vendas", cases)).rejects.toMatchObject({ code: "forbidden" });
    // Central answers without data; the specialist uses the tool and the right number.
    provider.script.push(textResponse("Não sei."), toolUse("get_sales_summary", { from: day, to: day }), textResponse("Líquido de R$ 20,00."));
    expect(await evaluateSpecialistAgainstCentral(owner, "vendas", cases)).toMatchObject({ centralPassed: 0, specialistPassed: 1, enabled: true });

    const before = provider.requests.length;
    provider.script.push(
      toolUse("consult_specialist", { specialist: "vendas", question: "Faturamento de hoje" }),
      toolUse("get_sales_summary", { from: day, to: day }),
      textResponse("Hoje: R$ 20,00."),
      textResponse("O especialista em vendas informa R$ 20,00 hoje."),
    );
    const result = await askAssistant(owner, { question: "Como foram as vendas?" });
    expect(provider.requests[before].tools?.find((tool) => tool.name === "consult_specialist")?.inputSchema).toMatchObject({ properties: { specialist: { enum: ["vendas"] } } });
    // The specialist only sees its own tools.
    expect(provider.requests[before + 1].tools?.map((tool) => tool.name).sort()).toEqual(["compare_stores", "get_sales_summary", "get_salesperson_ranking"]);
    expect(result).toMatchObject({ answer: "O especialista em vendas informa R$ 20,00 hoje.", sources: [{ tool: "consult_specialist" }] });
    const runs = await withScope({ organizationId }, (tx) => tx.select({ tool: aiToolRuns.tool }).from(aiToolRuns).where(eq(aiToolRuns.conversationId, result.conversationId)));
    expect(runs.map((run) => run.tool).sort()).toEqual(["consult_specialist", "get_sales_summary"]);

    // A new evaluation without benefit (same score, no token saving) disables it again.
    provider.script.push(toolUse("get_sales_summary", { from: day, to: day }), textResponse("R$ 20,00"), toolUse("get_sales_summary", { from: day, to: day }), textResponse("R$ 20,00"));
    expect(await evaluateSpecialistAgainstCentral(owner, "vendas", cases)).toMatchObject({ centralPassed: 1, specialistPassed: 1, enabled: false });
    const last = provider.requests.length;
    provider.script.push(textResponse("Sem especialista."));
    await askAssistant(owner, { question: "E agora?" });
    expect(provider.requests[last].tools?.map((tool) => tool.name)).not.toContain("consult_specialist");
  });
});

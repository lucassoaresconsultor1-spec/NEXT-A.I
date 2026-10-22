import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/escritorio/eventos/route";
import { aiConversations, aiMessages, aiToolRuns } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setModelProviderForTests } from "@/server/ai/registry";
import { sessionCookieName } from "@/server/auth/cookie";
import { createSession } from "@/server/auth/session";
import { officeSnapshot } from "@/server/office/snapshot";
import { createFakeModelProvider } from "../support/fake-model-provider";
import { addMemberFixture, createOrganizationFixture, createStoreFixture } from "./fixtures";

afterEach(() => setModelProviderForTests(undefined));

describe("virtual office state", () => {
  it("derives every agent state from recorded executions and streams it with authorization per event", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const supervisor = await addMemberFixture(organizationId, { roleKey: "supervisor", storeIds: [storeId] });
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    await withScope({ organizationId }, async (tx) => {
      const [chat] = await tx.insert(aiConversations).values({ organizationId, userId: owner.user.id, title: "Pergunta" }).returning({ id: aiConversations.id });
      await tx.insert(aiMessages).values({ organizationId, conversationId: chat.id, role: "user", text: "Como estão as filas?", createdAt: ago(30_000) });
      await tx.insert(aiToolRuns).values([
        { organizationId, conversationId: chat.id, tool: "get_sales_summary", params: '{"from":"2027-01-01"}', status: "ok", durationMs: 50, createdAt: ago(5_000) },
        { organizationId, conversationId: chat.id, tool: "get_queue_metrics", params: null, status: "error", durationMs: 10, error: "Parâmetros inválidos.", createdAt: ago(60_000) },
        { organizationId, conversationId: chat.id, tool: "get_open_cash_sessions", params: null, status: "ok", durationMs: 20, createdAt: ago(10 * 60_000) },
      ]);
    });

    setModelProviderForTests(null);
    expect((await officeSnapshot(owner, now)).agents.every((agent) => agent.state === "unavailable")).toBe(true);

    setModelProviderForTests(createFakeModelProvider());
    const snapshot = await officeSnapshot(owner, now);
    const state = Object.fromEntries(snapshot.agents.map((agent) => [agent.name, agent.state]));
    expect(state).toEqual({ Otto: "analyzing", Bia: "done", Caio: "available", Duda: "unavailable", Iara: "available", Léo: "error", Rui: "available", Sofia: "available" });
    expect(snapshot.agents.find((agent) => agent.name === "Léo")?.lastError).toBe("Parâmetros inválidos.");
    expect(snapshot.history).toHaveLength(3);
    expect(JSON.stringify(snapshot.history)).not.toContain("2027-01-01");
    expect(snapshot.panels).toEqual({ openAlerts: 0, waitingInQueue: 0 });

    // The supervisor cannot use the expense tool: the financial agent is unavailable to them.
    expect((await officeSnapshot(supervisor.context, now)).agents.find((agent) => agent.name === "Iara")?.state).toBe("unavailable");
    const cashier = await addMemberFixture(organizationId, { roleKey: "cashier", storeIds: [storeId] });
    await expect(officeSnapshot(cashier.context, now)).rejects.toMatchObject({ code: "forbidden" });
    const other = await createOrganizationFixture();
    expect((await officeSnapshot(other.owner, now)).history).toEqual([]);

    // SSE: no session = 401; a valid session receives a snapshot event.
    expect((await GET(new Request("http://localhost/api/escritorio/eventos"))).status).toBe(401);
    const { token } = await createSession(owner.user.id, organizationId);
    const controller = new AbortController();
    const response = await GET(new Request("http://localhost/api/escritorio/eventos", { headers: { cookie: `${sessionCookieName()}=${token}` }, signal: controller.signal }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toMatch(/^event: snapshot\ndata: \{"generatedAt"/);
    controller.abort();
    await reader.cancel();
  });
});

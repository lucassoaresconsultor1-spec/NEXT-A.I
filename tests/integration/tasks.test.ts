import { describe, expect, it } from "vitest";
import { aiConversations, alerts } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { getProcedure, listProcedures, saveProcedure, setProcedureActive } from "@/server/tasks/procedures";
import { assignTask, commentTask, createTask, getTask, listTasks, updateTaskStatus } from "@/server/tasks/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture } from "./fixtures";

describe("tasks and procedures", () => {
  it("creates tasks only by people, lets the assignee move their own and keeps the timeline", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const managerA = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const managerB = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeB] });
    const sellerA = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const sellerB = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeB] });
    const [alert] = await withScope({ organizationId }, (tx) =>
      tx.insert(alerts).values({ organizationId, kind: "low_stock", dedupeKey: "low_stock:x", storeId: storeA, severity: "warning", title: "Estoque baixo", detail: "Disponível 1" }).returning({ id: alerts.id }),
    );
    const [ownChat, otherChat] = await withScope({ organizationId }, (tx) =>
      tx.insert(aiConversations).values([{ organizationId, userId: owner.user.id, title: "Minha" }, { organizationId, userId: managerA.userId, title: "Outra" }]).returning({ id: aiConversations.id }),
    );

    await expect(createTask(managerA.context, { title: "Repor estoque", storeId: storeA, alertId: alert.id, assigneeMembershipId: sellerB.membershipId })).rejects.toMatchObject({ fieldErrors: { assigneeMembershipId: expect.any(Array) } });
    await expect(createTask(managerA.context, { title: "Tarefa geral" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createTask(owner, { title: "Da conversa alheia", conversationId: otherChat.id })).rejects.toMatchObject({ code: "not_found" });
    const fromChat = await createTask(owner, { title: "Da minha conversa", conversationId: ownChat.id });
    expect(await getTask(owner, fromChat.id)).toMatchObject({ source: "assistant" });

    const task = await createTask(managerA.context, { title: "Repor estoque", storeId: storeA, alertId: alert.id, assigneeMembershipId: sellerA.membershipId, priority: "high" });
    await updateTaskStatus(sellerA.context, task.id, { status: "in_progress" });
    await expect(updateTaskStatus(sellerB.context, task.id, { status: "done" })).rejects.toMatchObject({ code: "not_found" });
    await commentTask(sellerA.context, task.id, { text: "Pedido feito ao fornecedor" });
    await expect(updateTaskStatus(managerA.context, task.id, { status: "cancelled" })).rejects.toMatchObject({ fieldErrors: { note: expect.any(Array) } });
    await updateTaskStatus(sellerA.context, task.id, { status: "done", note: "Reposto" });
    await expect(updateTaskStatus(managerA.context, task.id, { status: "in_progress" })).rejects.toMatchObject({ code: "invalid" });
    await expect(assignTask(managerA.context, task.id, sellerA.membershipId)).rejects.toMatchObject({ code: "invalid" });
    expect((await getTask(managerA.context, task.id))?.events.map((entry) => entry.kind)).toEqual(["created", "status_changed", "comment", "status_changed"]);
    expect(await getTask(owner, task.id)).toMatchObject({ source: "alert", status: "done" });

    expect((await listTasks(managerB.context)).rows).toEqual([]);
    expect((await listTasks(sellerA.context, { mine: true })).rows.map((row) => row.id)).toEqual([task.id]);
    expect((await listTasks(managerA.context)).rows.map((row) => row.id)).toEqual([task.id]);

    const other = await createOrganizationFixture();
    expect(await getTask(other.owner, task.id)).toBeNull();
  });

  it("shows only active procedures to readers and searches title and text", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeId = await createStoreFixture(organizationId);
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeId] });
    const opening = await saveProcedure(owner, { title: "Abertura da loja", body: "Conferir o troco e ligar as luzes da vitrine." });
    const old = await saveProcedure(owner, { title: "Fechamento antigo", body: "Procedimento substituído pelo novo fechamento." });
    await expect(saveProcedure(owner, { title: "abertura da loja", body: "Repetido com outro texto." })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveProcedure(seller.context, { title: "Do vendedor", body: "Vendedor não escreve procedimentos." })).rejects.toMatchObject({ code: "forbidden" });
    await setProcedureActive(owner, old.id, false);
    expect((await listProcedures(seller.context)).map((row) => row.id)).toEqual([opening.id]);
    expect((await listProcedures(seller.context, { q: "vitrine" })).map((row) => row.id)).toEqual([opening.id]);
    expect(await getProcedure(seller.context, old.id)).toBeNull();
    expect((await listProcedures(owner)).map((row) => row.title)).toEqual(["Abertura da loja", "Fechamento antigo"]);
  });
});

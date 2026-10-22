import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceCredentials } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { setOwnQueuePin } from "@/server/devices/pin";
import { createDevice, deviceActor, deviceFromToken, deviceMembers, pairDevice, revokeDevice } from "@/server/devices/service";
import { callNext, finishAttendance, registerArrival, setPresence } from "@/server/queue/service";
import { saveSalesperson } from "@/server/salespeople/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture } from "./fixtures";

describe("queue tablets", () => {
  it("pairs once, acts only through queue permissions of the PIN owner and stops when revoked", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    const reception = await addMemberFixture(organizationId, { roleKey: "reception", storeIds: [storeA] });
    const seller = await addMemberFixture(organizationId, { roleKey: "salesperson", storeIds: [storeA] });
    const { id: salespersonId } = await saveSalesperson(owner, { membershipId: seller.membershipId, code: "V01", nickname: "Ana", storeIds: [storeA] });
    const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

    await expect(createDevice(manager.context, { storeId: storeB, name: "Entrada" })).rejects.toMatchObject({ code: "not_found" });
    const device = await createDevice(manager.context, { storeId: storeA, name: "Entrada" });
    const { token } = await pairDevice(device.pairingCode.toLowerCase(), ip);
    await expect(pairDevice(device.pairingCode, ip)).rejects.toMatchObject({ code: "invalid" });
    const stored = await withScope({ organizationId }, (tx) => tx.select({ hash: deviceCredentials.hash }).from(deviceCredentials).where(eq(deviceCredentials.deviceId, device.id)));
    expect(stored).toHaveLength(1);
    expect(stored[0].hash).not.toBe(token);
    expect(await deviceFromToken(token)).toMatchObject({ id: device.id, storeId: storeA });

    const late = await createDevice(manager.context, { storeId: storeA, name: "Caixa" });
    await withScope({ organizationId }, (tx) => tx.update(deviceCredentials).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(deviceCredentials.deviceId, late.id)));
    await expect(pairDevice(late.pairingCode, ip)).rejects.toMatchObject({ code: "invalid" });

    await expect(setOwnQueuePin(seller.context, { pin: "123456" })).rejects.toMatchObject({ code: "invalid" });
    for (const [member, pin] of [[reception, "482916"], [seller, "739251"], [manager, "915372"]] as const) await setOwnQueuePin(member.context, { pin });
    expect((await deviceMembers(token)).map((row) => row.membershipId).sort()).toEqual([reception.membershipId, seller.membershipId, manager.membershipId].sort());

    // Five wrong PINs lock the member, even for the right PIN afterwards.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(deviceActor(token, { membershipId: manager.membershipId, pin: "000001" })).rejects.toMatchObject({ code: "invalid" });
    }
    await expect(deviceActor(token, { membershipId: manager.membershipId, pin: "915372" })).rejects.toMatchObject({ message: expect.stringContaining("Muitas tentativas") });

    const desk = await deviceActor(token, { membershipId: reception.membershipId, pin: "482916" });
    expect([...desk.permissions].sort()).toEqual(["queue.operate", "queue.read"]);
    expect(desk.storeScope).toEqual({ all: false, storeIds: [storeA] });
    const ana = await deviceActor(token, { membershipId: seller.membershipId, pin: "739251" });
    expect([...ana.permissions]).toEqual(["queue.read"]);

    await setPresence(ana, { storeId: storeA, salespersonId, status: "available" });
    const arrival = await registerArrival(desk, { storeId: storeA, requestKey: randomUUID() });
    await expect(registerArrival(desk, { storeId: storeB, requestKey: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    await expect(registerArrival(ana, { storeId: storeA, requestKey: randomUUID() })).rejects.toMatchObject({ code: "forbidden" });
    expect(await callNext(desk, { storeId: storeA })).toEqual({ entryId: arrival.id, salespersonId });
    await finishAttendance(ana, arrival.id, { outcome: "no_sale", reason: "Só olhando" });

    const other = await createOrganizationFixture();
    await expect(revokeDevice(other.owner, device.id)).rejects.toMatchObject({ code: "not_found" });
    await revokeDevice(manager.context, device.id);
    expect(await deviceFromToken(token)).toBeNull();
    await expect(deviceActor(token, { membershipId: reception.membershipId, pin: "482916" })).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

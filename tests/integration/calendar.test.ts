import { describe, expect, it } from "vitest";
import { rolePermissions, roles } from "@/db/schema";
import { withScope } from "@/db/tenant";
import { countBusinessDays } from "@/lib/business-days";
import { deleteHoliday, getStoreWorkWeek, listHolidays, loadCalendarOptions, saveHoliday, setStoreWorkWeek } from "@/server/calendar/service";
import { addMemberFixture, createOrganizationFixture, createStoreFixture, uniqueSuffix } from "./fixtures";

async function januaryBusinessDays(organizationId: string, storeId: string) {
  const options = await withScope({ organizationId }, (tx) => loadCalendarOptions(tx, organizationId, storeId, "2027-01-01", "2027-01-31"));
  return countBusinessDays("2027-01-01", "2027-01-31", options);
}

describe("company calendar", () => {
  it("combines organization and store days, counts optional days only when closed and uses the store work week", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    // January 2027 has 21 weekdays; 01/01 is a national holiday (m01) -> 20.
    expect(await januaryBusinessDays(organizationId, storeA)).toBe(20);
    await saveHoliday(owner, { day: "2027-01-20", name: "São Sebastião", kind: "holiday" });
    await saveHoliday(owner, { day: "2027-01-22", name: "Feriado da loja", kind: "holiday", storeId: storeA });
    const optional = await saveHoliday(owner, { day: "2027-01-25", name: "Ponto facultativo", kind: "optional" });
    expect(await januaryBusinessDays(organizationId, storeA)).toBe(18);
    expect(await januaryBusinessDays(organizationId, storeB)).toBe(19);

    await saveHoliday(owner, { day: "2027-01-25", name: "Ponto facultativo", kind: "optional", closed: "on" }, optional.id);
    expect(await januaryBusinessDays(organizationId, storeB)).toBe(18);
    await setStoreWorkWeek(owner, storeA, { weekdays: ["1", "2", "3", "4", "5", "6"] });
    expect(await getStoreWorkWeek(owner, storeA)).toEqual([1, 2, 3, 4, 5, 6]);
    // Five Saturdays in January 2027.
    expect(await januaryBusinessDays(organizationId, storeA)).toBe(22);

    await expect(saveHoliday(owner, { day: "2027-01-20", name: "Repetido", kind: "holiday" })).rejects.toMatchObject({ code: "conflict" });
    await expect(saveHoliday(owner, { day: "2027-01-20", name: "Só na loja", kind: "holiday", storeId: storeB })).resolves.toMatchObject({ id: expect.any(String) });
    expect((await listHolidays(owner, { year: 2027 })).map((row) => row.day)).toEqual(["2027-01-20", "2027-01-20", "2027-01-22", "2027-01-25"]);
    expect((await listHolidays(owner, { year: 2027, storeId: storeB })).map((row) => row.day)).toEqual(["2027-01-20", "2027-01-20", "2027-01-25"]);

    await deleteHoliday(owner, optional.id);
    expect(await januaryBusinessDays(organizationId, storeB)).toBe(19);
  });

  it("limits management to the store scope, keeps organization days for full access and isolates organizations", async () => {
    const { organizationId, owner } = await createOrganizationFixture();
    const storeA = await createStoreFixture(organizationId);
    const storeB = await createStoreFixture(organizationId);
    const orgDay = await saveHoliday(owner, { day: "2027-03-01", name: "Da empresa", kind: "holiday" });
    const otherDay = await saveHoliday(owner, { day: "2027-03-02", name: "Da loja B", kind: "holiday", storeId: storeB });

    const key = `calendario_${uniqueSuffix()}`;
    await withScope({ organizationId }, async (tx) => {
      const [role] = await tx.insert(roles).values({ organizationId, key, name: `Calendário ${key}`, isSystem: false, rank: 45 }).returning({ id: roles.id });
      await tx.insert(rolePermissions).values(["organization.settings.read", "settings.operations.manage"].map((permission) => ({ organizationId, roleId: role.id, permission })));
    });
    const scoped = await addMemberFixture(organizationId, { roleKey: key, storeAccess: "stores", storeIds: [storeA] });
    await expect(saveHoliday(scoped.context, { day: "2027-03-03", name: "Da loja A", kind: "holiday", storeId: storeA })).resolves.toBeDefined();
    await expect(saveHoliday(scoped.context, { day: "2027-03-04", name: "Da empresa", kind: "holiday" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(saveHoliday(scoped.context, { day: "2027-03-04", name: "Da loja B", kind: "holiday", storeId: storeB })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteHoliday(scoped.context, orgDay.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(deleteHoliday(scoped.context, otherDay.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(setStoreWorkWeek(scoped.context, storeB, { weekdays: [1] })).rejects.toMatchObject({ code: "not_found" });
    expect((await listHolidays(scoped.context, { year: 2027 })).map((row) => row.name)).toEqual(["Da empresa", "Da loja A"]);
    expect((await listHolidays(owner, { year: 2027 })).map((row) => row.name)).toEqual(["Da empresa", "Da loja B", "Da loja A"]);

    const manager = await addMemberFixture(organizationId, { roleKey: "store_manager", storeIds: [storeA] });
    await expect(saveHoliday(manager.context, { day: "2027-03-05", name: "Gerente", kind: "holiday", storeId: storeA })).rejects.toMatchObject({ code: "forbidden" });

    const other = await createOrganizationFixture();
    expect(await listHolidays(other.owner, { year: 2027 })).toEqual([]);
    await expect(deleteHoliday(other.owner, orgDay.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

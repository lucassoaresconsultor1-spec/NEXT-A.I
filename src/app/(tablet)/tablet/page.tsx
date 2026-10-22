import { deviceDepartments, deviceFromToken, deviceMembers } from "@/server/devices/service";
import { actorFromTicket } from "@/server/devices/tickets";
import { getQueue } from "@/server/queue/service";
import { readTabletCookies } from "./cookies";
import { PairForm } from "./pair-form";
import { QueuePanel, type PanelData } from "./queue-panel";
import { UnlockForm } from "./unlock-form";

// Entrance tablet (m13b): pairing, then "who are you?" with PIN, then the queue
// operations of that member. No management screen opens here.

const time = (value: Date | null, timeZone: string) => (value ? new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(value) : "");

export default async function TabletPage() {
  const { token, ticket } = await readTabletCookies();
  const device = await deviceFromToken(token);
  if (!device) return <PairForm />;

  const actor = await actorFromTicket(token, ticket);
  if (!actor) return <UnlockForm deviceName={device.name} members={await deviceMembers(token)} />;

  const context = actor.context;
  const tz = context.organization.timezone;
  const [queue, departments] = await Promise.all([getQueue(context, device.storeId), deviceDepartments(token)]);
  const sectorName = new Map(departments.map((department) => [department.id, department.name]));
  const data: PanelData = {
    deviceName: device.name,
    memberName: context.user.name,
    canOperate: context.permissions.has("queue.operate"),
    departments,
    waiting: queue.entries.filter((entry) => entry.status === "waiting").map((entry) => ({ id: entry.id, ticket: entry.ticket, note: entry.note, sector: entry.departmentId ? (sectorName.get(entry.departmentId) ?? null) : null, at: time(entry.arrivedAt, tz) })),
    inService: queue.entries.filter((entry) => entry.status === "in_service").map((entry) => ({ id: entry.id, ticket: entry.ticket, note: entry.note, salesperson: entry.nickname ?? "", at: time(entry.startedAt, tz) })),
    presence: queue.presence.map((row) => ({ salespersonId: row.salespersonId, name: row.nickname, code: row.code, status: row.status, since: time(row.since, tz) })),
  };
  return <QueuePanel data={data} />;
}

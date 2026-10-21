import { Store } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { listRegisters } from "@/server/cash/registers";
import { listStoreOptions } from "@/server/stores/options";
import { saveRegisterAction, setRegisterActiveAction } from "../actions";
import { RegisterFormDialog, RegisterStatusDialog } from "./register-dialogs";

export const metadata: Metadata = { title: "Caixas" };
export default async function RegistersPage() {
  const context = await requireTenantContext();
  if (!can(context, "cash.manage")) return <AccessDenied />;
  const stores = await listStoreOptions(context, { includeInactive: true });
  let rows: Awaited<ReturnType<typeof listRegisters>> = [];
  let planMessage: string | undefined;
  try { rows = await listRegisters(context); } catch (error) { if (!isDomainError(error) || error.code !== "limit") throw error; planMessage = error.message; }
  if (planMessage) return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa", href: "/caixa" }, { label: "Caixas" }]} /><PageHeader title="Caixas" description="Caixas cadastrados nas lojas do seu acesso." /><Card><CardBody><Notice tone="warning" title={planMessage} /></CardBody></Card></>;
  const availableStores = stores.filter((store) => store.status === "active");
  const tz = context.organization.timezone;
  return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa", href: "/caixa" }, { label: "Caixas" }]} /><PageHeader title="Caixas" description="Caixas cadastrados nas lojas do seu acesso." actions={<RegisterFormDialog action={saveRegisterAction} stores={availableStores} />} /><Card>{rows.length === 0 ? <EmptyState icon={Store} title="Nenhum caixa cadastrado" description="Cadastre um caixa para permitir a abertura de sessões." action={<RegisterFormDialog action={saveRegisterAction} stores={availableStores} />} /> : <Table caption="Caixas cadastrados"><thead><tr><Th>Loja</Th><Th>Caixa</Th><Th>Situação</Th><Th>Sessão aberta</Th><Th className="text-right">Ações</Th></tr></thead><tbody>{rows.map((row) => <Tr key={row.id}><Td>{row.storeName}</Td><Td className="font-medium">{row.name}</Td><Td><Badge tone={row.isActive ? "positive" : "neutral"}>{row.isActive ? "Ativo" : "Inativo"}</Badge></Td><Td>{row.openSession ? `${row.openSession.openedByName ?? "Operador"} · ${row.openSession.openedAt ? formatDateTime(row.openSession.openedAt, tz) : "—"}` : "—"}</Td><Td><div className="flex justify-end gap-1"><RegisterFormDialog action={saveRegisterAction} stores={availableStores} row={row} /><RegisterStatusDialog action={setRegisterActiveAction} row={row} /></div></Td></Tr>)}</tbody></Table>}</Card></>;
}




import { ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardBody } from "@/components/ui/layout";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { isDomainError } from "@/server/errors";
import { listSessions } from "@/server/cash/session-queries";
import { sessionFiltersSchema } from "@/server/cash/schemas";
import { listRegisters } from "@/server/cash/registers";
import { listStoreOptions } from "@/server/stores/options";
import { SessionFilters } from "./session-filters";

export const metadata: Metadata = { title: "Sessões de caixa" };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function SessionsPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "cash.read") && !can(context, "cash.operate")) return <AccessDenied />;
  const raw = await searchParams;
  const filters = sessionFiltersSchema.parse({ storeId: one(raw.loja), registerId: one(raw.caixa), status: one(raw.situacao) === "aberta" ? "open" : one(raw.situacao) === "fechada" ? "closed" : undefined, from: one(raw.de), to: one(raw.ate), page: one(raw.page) });
  let result: Awaited<ReturnType<typeof listSessions>>;
  try { result = await listSessions(context, filters); } catch (error) { if (!isDomainError(error) || error.code !== "limit") throw error; return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa", href: "/caixa" }, { label: "Sessões de caixa" }]} /><Card><CardBody><Notice tone="warning" title={error.message} /></CardBody></Card></>; }
  const [stores, registers] = await Promise.all([listStoreOptions(context, { includeInactive: true }), listRegisters(context)]);
  const values = { storeId: filters.storeId ?? "", registerId: filters.registerId ?? "", status: filters.status === "open" ? "aberta" : filters.status === "closed" ? "fechada" : "", from: filters.from ?? "", to: filters.to ?? "" };
  const tz = context.organization.timezone;
  return <><Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Caixa", href: "/caixa" }, { label: "Sessões de caixa" }]} /><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="font-display text-xl font-semibold text-ink">Sessões de caixa</h1><p className="mt-1 text-sm text-ink-muted">Consulte aberturas e fechamentos nos caixas do seu acesso.</p></div><LinkButton href="/caixa">Meu caixa</LinkButton></div><Card className="mt-4"><SessionFilters stores={stores.map(({ id, code, name }) => ({ id, code, name }))} registers={registers.map(({ id, name }) => ({ id, name }))} values={values} />{result.rows.length === 0 ? <EmptyState icon={ReceiptText} title="Nenhuma sessão encontrada" description="Ajuste os filtros ou consulte novamente mais tarde." /> : <><Table caption="Sessões de caixa"><thead><tr><Th>Caixa</Th><Th>Loja</Th><Th>Operador</Th><Th>Abertura</Th><Th>Fechamento</Th><Th>Situação</Th><Th className="text-right">Diferença</Th></tr></thead><tbody>{result.rows.map((row) => <Tr key={row.id}><Td className="font-medium"><Link href={`/caixa/sessoes/${row.id}`} className="text-brand underline-offset-2 hover:underline">{row.registerName}</Link></Td><Td>{row.storeName}</Td><Td>{row.openedByName}</Td><Td className="whitespace-nowrap">{formatDateTime(row.openedAt, tz)}</Td><Td className="whitespace-nowrap">{row.closedAt ? formatDateTime(row.closedAt, tz) : "—"}</Td><Td><Badge tone={row.status === "open" ? "positive" : "neutral"}>{row.status === "open" ? "Aberta" : "Fechada"}</Badge></Td><Td className={`text-right tabular-nums ${row.differenceCents && row.differenceCents !== 0 ? "text-critical" : ""}`}>{row.status === "open" || row.differenceCents == null ? "—" : formatCurrencyCents(row.differenceCents)}</Td></Tr>)}</tbody></Table><Pagination page={result.page} pageCount={result.pageCount} total={result.total} basePath="/caixa/sessoes" params={{ loja: values.storeId || undefined, caixa: values.registerId || undefined, situacao: values.status || undefined, de: values.from || undefined, ate: values.to || undefined }} /></>}</Card></>;
}




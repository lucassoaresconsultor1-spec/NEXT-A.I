import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge, Notice } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatQuantity, type QuantityUnit } from "@/lib/quantity-format";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { COUNT_STATUS_LABELS } from "@/server/inventory/count-schemas";
import { getCount } from "@/server/inventory/counts";
import { InventoryUnavailable, withInventoryPlan } from "../../feature-guard";
import { STATUS_TONES } from "../status";
import { CountReasonDialog } from "./count-dialogs";
import { CountSheet, type SheetItem } from "./count-sheet";

export const metadata: Metadata = { title: "Inventário" };

type Params = Promise<{ countId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CountPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!can(context, "inventory.read") && !can(context, "inventory.count.record")) return <AccessDenied />;
  const { countId } = await params;
  // "?cega=1" lets a manager count without seeing balances; members who only count are always blind.
  const blind = (await searchParams).cega === "1";
  const loaded = await withInventoryPlan(() => getCount(context, countId, { blind }));
  const crumbs = (
    <Breadcrumbs
      items={[
        { label: "Painel", href: "/painel" },
        { label: "Estoque", href: "/estoque" },
        { label: "Inventários", href: "/estoque/inventarios" },
        { label: "Inventário" },
      ]}
    />
  );
  if ("unavailable" in loaded) {
    return (
      <>
        {crumbs}
        <InventoryUnavailable message={loaded.unavailable} />
      </>
    );
  }
  const count = loaded.data;
  if (!count) notFound();
  const tz = context.organization.timezone;
  const isOpen = count.status === "open";
  const items = count.items.map((item) => ({ ...item, label: `${item.productName} · ${item.variantName}`, unit: item.unit as QuantityUnit }));
  const reviewOf = (item: (typeof items)[number]) =>
    "expectedQuantity" in item
      ? { expectedQuantity: item.expectedQuantity, currentQuantity: item.currentQuantity, difference: item.difference, movedDuringCount: item.movedDuringCount, adjustment: item.adjustment }
      : undefined;
  const counted = items.filter((item) => item.countedQuantity !== null).length;
  const divergent = items.filter((item) => {
    const review = reviewOf(item);
    return review?.difference !== null && review?.difference !== undefined && review.difference !== "0.000";
  }).length;

  return (
    <>
      {crumbs}
      <PageHeader
        title={`Inventário nº ${count.number}`}
        description={count.storeName}
        actions={
          isOpen ? (
            <>
              {can(context, "inventory.count.manage") ? <CountReasonDialog countId={count.id} number={count.number} kind="cancel" /> : null}
              {can(context, "inventory.count.approve") ? <CountReasonDialog countId={count.id} number={count.number} kind="approve" /> : null}
            </>
          ) : undefined
        }
      />
      <Card>
        <CardBody>
          <DetailList
            items={[
              { label: "Situação", value: <Badge tone={STATUS_TONES[count.status]}>{COUNT_STATUS_LABELS[count.status]}</Badge> },
              { label: "Aberto em", value: `${formatDateTime(count.openedAt, tz)}${count.openedByName ? ` por ${count.openedByName}` : ""}` },
              { label: "Itens contados", value: `${counted} de ${items.length}` },
              ...(count.blind || !isOpen ? [] : [{ label: "Com diferença", value: String(divergent) }]),
              ...(count.note ? [{ label: "Observação", value: count.note }] : []),
              ...(count.approvedAt ? [{ label: "Aprovado em", value: `${formatDateTime(count.approvedAt, tz)} · ${count.approvalReason ?? ""}` }] : []),
              ...(count.cancelledAt ? [{ label: "Cancelado em", value: `${formatDateTime(count.cancelledAt, tz)} · ${count.cancelReason ?? ""}` }] : []),
            ]}
          />
        </CardBody>
      </Card>
      {isOpen ? (
        <Card>
          <CardHeader
            title="Contagem"
            description={count.blind ? "Digite a quantidade encontrada de cada item. Vale a última quantidade salva." : "Revise as diferenças antes de aprovar. A diferença é calculada contra o saldo atual."}
          />
          <CardBody>
            <CountSheet
              countId={count.id}
              canRecord={can(context, "inventory.count.record")}
              items={items.map((item): SheetItem => {
                const review = reviewOf(item);
                return {
                  id: item.id,
                  label: item.label,
                  sku: item.sku,
                  unit: item.unit,
                  countedQuantity: item.countedQuantity,
                  ...(review ? { review: { expectedQuantity: review.expectedQuantity, currentQuantity: review.currentQuantity, difference: review.difference, movedDuringCount: review.movedDuringCount } } : {}),
                };
              })}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Itens" description={count.status === "approved" ? "Ajustes lançados no livro de estoque na aprovação." : "Inventário cancelado: nada foi ajustado."} />
          {count.status === "approved" && items.length > counted ? (
            <CardBody>
              <Notice tone="info" title={`${items.length - counted} itens não foram contados e ficaram como estavam.`} />
            </CardBody>
          ) : null}
          <Table caption="Itens do inventário">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th className="text-right">Contado</Th>
                {count.blind ? null : <Th className="text-right">Na abertura</Th>}
                {count.blind ? null : <Th className="text-right">Ajuste</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const review = reviewOf(item);
                return (
                  <Tr key={item.id}>
                    <Td>
                      <span className="font-medium">{item.label}</span>
                      <span className="block text-xs text-ink-muted">{item.sku}</span>
                      {review?.movedDuringCount ? <Badge tone="attention">Movimentado durante a contagem</Badge> : null}
                    </Td>
                    <Td className="text-right tabular-nums">{item.countedQuantity === null ? "Não contado" : formatQuantity(item.countedQuantity, item.unit)}</Td>
                    {review ? <Td className="text-right tabular-nums">{formatQuantity(review.expectedQuantity, item.unit)}</Td> : null}
                    {review ? <Td className="text-right tabular-nums">{review.adjustment ? formatQuantity(review.adjustment, item.unit) : "—"}</Td> : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

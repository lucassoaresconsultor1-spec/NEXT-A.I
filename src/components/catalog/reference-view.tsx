import type { LucideIcon } from "lucide-react";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatInteger } from "@/lib/format";
import {
  ReferenceFormDialog,
  ReferenceStatusDialog,
  type FormAction,
  type ReferenceCopy,
  type ReferenceRow,
} from "./reference-dialogs";
import { StatusFilter } from "./status-filter";
import { statusToParam, type CatalogStatus } from "./status-param";

export function ReferenceView({
  basePath,
  icon: Icon,
  copy,
  rows,
  status,
  canManage,
  limit,
  saveAction,
  statusAction,
}: {
  basePath: "/categorias" | "/marcas";
  icon: LucideIcon;
  copy: ReferenceCopy;
  rows: ReferenceRow[];
  status: CatalogStatus | undefined;
  canManage: boolean;
  limit: number;
  saveAction: FormAction;
  statusAction: FormAction;
}) {
  const filterValue = statusToParam(status);

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: copy.title }]} />
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={canManage ? <ReferenceFormDialog copy={copy} saveAction={saveAction} /> : undefined}
      />
      <Card>
        {rows.length > 0 || status ? (
          <StatusFilter
            key={filterValue}
            basePath={basePath}
            value={filterValue}
            label={copy.filterLabel}
            options={copy.filterOptions}
          />
        ) : null}
        {rows.length === 0 ? (
          status ? (
            <EmptyState
              icon={Icon}
              title={status === "active" ? copy.emptyFilteredActive : copy.emptyFilteredInactive}
              description={`Altere o filtro de situação para ver as demais ${copy.plural}.`}
              action={
                <LinkButton href={basePath} variant="secondary">
                  Ver todas
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={Icon}
              title={copy.emptyTitle}
              description={
                canManage ? copy.emptyDescriptionManage : copy.emptyDescriptionReadOnly
              }
              action={canManage ? <ReferenceFormDialog copy={copy} saveAction={saveAction} /> : undefined}
            />
          )
        ) : (
          <>
            <Table caption={copy.caption}>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Situação</Th>
                  {canManage ? <Th className="text-right">Ações</Th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td>
                      <Badge tone={row.isActive ? "positive" : "neutral"}>
                        {row.isActive ? copy.activeBadge : copy.inactiveBadge}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <ReferenceFormDialog copy={copy} saveAction={saveAction} row={row} />
                          <ReferenceStatusDialog copy={copy} statusAction={statusAction} row={row} />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="px-4 py-3 text-sm text-ink-muted">
              {formatInteger(rows.length)} {rows.length === 1 ? copy.singular : copy.plural}
              {rows.length >= limit ? ` · exibindo as primeiras ${formatInteger(limit)} em ordem alfabética` : ""}
            </p>
          </>
        )}
      </Card>
    </>
  );
}

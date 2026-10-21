import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Badge } from "@/components/ui/feedback";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { CUSTOMER_REQUIREMENT_LABELS, formatBpsInput } from "@/server/settings/schemas";
import { getOperationalSettings } from "@/server/settings/service";
import { OrganizationOperationsForm, StoreOperationsDialog } from "./operation-forms";

export const metadata: Metadata = { title: "Regras de operação" };

const percent = (bps: number) => `${formatBpsInput(bps)} %`;

function MultilineText({ value }: { value: string | null }) {
  return value ? <span className="whitespace-pre-line">{value}</span> : <span className="text-ink-muted">—</span>;
}

/** Effective value of a store, with a badge when it comes from the organization. */
function StoreValue({ inherited, children }: { inherited: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span>{children}</span>
      {inherited ? <Badge>Padrão da empresa</Badge> : null}
    </div>
  );
}

export default async function OperationRulesPage() {
  const context = await requireTenantContext();
  if (!can(context, "organization.settings.read")) return <AccessDenied />;
  const settings = await getOperationalSettings(context);
  const canManageOrganization = can(context, "settings.operations.manage") && context.storeScope.all;
  // Store overrides are checked against the member's store scope by the service.
  const canManageStores = can(context, "settings.operations.manage");
  const { organization } = settings;

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Configurações", href: "/configuracoes" }, { label: "Regras de operação" }]} />
      <PageHeader
        title="Regras de operação"
        description="Cliente na venda, teto de desconto e textos do comprovante que o caixa e o PDV seguem. Cada loja pode ter exceções."
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Padrão da empresa" description="Vale para todas as lojas sem exceção própria." />
          <CardBody>
            {canManageOrganization ? (
              <OrganizationOperationsForm values={organization} />
            ) : (
              <DetailList
                items={[
                  { label: "Cliente na venda", value: CUSTOMER_REQUIREMENT_LABELS[organization.customerRequirement] },
                  { label: "Teto de desconto sem autorização", value: percent(organization.maxDiscountBps) },
                  { label: "Cabeçalho do comprovante", value: <MultilineText value={organization.receiptHeader} /> },
                  { label: "Rodapé do comprovante", value: <MultilineText value={organization.receiptFooter} /> },
                ]}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Exceções por loja" description="Lojas do seu acesso. Campos sem exceção seguem o padrão da empresa." />
          {settings.stores.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">Nenhuma loja no seu acesso.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table caption="Regras por loja">
                <thead>
                  <tr>
                    <Th>Loja</Th>
                    <Th>Cliente</Th>
                    <Th>Teto de desconto</Th>
                    <Th>Cabeçalho</Th>
                    {canManageStores ? <Th className="text-right">Ações</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {settings.stores.map((store) => (
                    <Tr key={store.storeId}>
                      <Td>
                        <span className="font-medium">{store.name}</span>
                        <span className="block text-xs text-ink-muted">{store.code}</span>
                      </Td>
                      <Td>
                        <StoreValue inherited={store.override.customerRequirement === null}>
                          {CUSTOMER_REQUIREMENT_LABELS[store.effective.customerRequirement]}
                        </StoreValue>
                      </Td>
                      <Td className="tabular-nums">
                        <StoreValue inherited={store.override.maxDiscountBps === null}>{percent(store.effective.maxDiscountBps)}</StoreValue>
                      </Td>
                      <Td>
                        <StoreValue inherited={store.override.receiptHeader === null}>
                          <MultilineText value={store.effective.receiptHeader} />
                        </StoreValue>
                      </Td>
                      {canManageStores ? (
                        <Td className="text-right">
                          <StoreOperationsDialog store={{ storeId: store.storeId, name: store.name, override: store.override }} />
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

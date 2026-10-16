import { Map } from "lucide-react";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { EmptyState } from "@/components/ui/feedback";
import { Card, PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { AccessDenied } from "@/components/shell/access-denied";
import { listRegions } from "@/server/regions/service";
import { DeleteRegionDialog, RegionFormDialog } from "./region-dialogs";

export const metadata: Metadata = { title: "Regiões" };

export default async function RegionsPage() {
  const context = await requireTenantContext();
  if (!can(context, "regions.read")) return <AccessDenied />;
  const regions = await listRegions(context);
  const canManage = can(context, "regions.manage") && context.storeScope.all;
  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Regiões" }]} />
      <PageHeader
        title="Regiões"
        description="Agrupe lojas por região para consolidar resultados e definir o acesso de gestores regionais."
        actions={canManage ? <RegionFormDialog /> : undefined}
      />
      <Card>
        {regions.length === 0 ? (
          <EmptyState
            icon={Map}
            title="Nenhuma região cadastrada"
            description={canManage ? "Crie regiões para agrupar lojas e atribuir gestores regionais." : "Nenhuma região do seu escopo."}
            action={canManage ? <RegionFormDialog /> : undefined}
          />
        ) : (
          <Table caption="Regiões cadastradas">
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Descrição</Th>
                <Th className="text-right">Lojas</Th>
                {canManage ? <Th className="text-right">Ações</Th> : null}
              </tr>
            </thead>
            <tbody>
              {regions.map((region) => (
                <Tr key={region.id}>
                  <Td className="font-medium">{region.name}</Td>
                  <Td className="text-ink-soft">{region.description ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{region.storeCount}</Td>
                  {canManage ? (
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <RegionFormDialog region={region} />
                        <DeleteRegionDialog region={region} storeCount={region.storeCount} />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

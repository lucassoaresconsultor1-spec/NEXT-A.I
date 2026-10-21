import { randomUUID } from "node:crypto";
import { Wallet } from "lucide-react";
import { AccessDenied } from "@/components/shell/access-denied";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { findOpenSessionForOperator } from "@/server/cash/session-queries";
import { listStoreOptions } from "@/server/stores/options";
import { PosScreen } from "./pos-screen";

export const metadata = { title: "PDV" };

export default async function PdvPage() {
  const context = await requireTenantContext();
  if (!can(context, "sales.create")) return <AccessDenied />;
  const stores = await listStoreOptions(context);
  const store = stores.find((item) => item.id === context.activeStoreId) ?? stores[0];
  const session = store ? await findOpenSessionForOperator(context, store.id) : null;
  if (!store || !session) return <Card><EmptyState icon={Wallet} title="Abra o caixa para vender." description="Abra um caixa na loja selecionada para iniciar as vendas." action={<a className="rounded-full bg-brand px-4 py-2 text-sm text-white" href="/caixa">Abrir caixa</a>} /></Card>;
  return <PosScreen storeId={store.id} sessionId={session.sessionId} storeName={store.name} completionKey={randomUUID()} suspensionKey={randomUUID()} canReadCustomers={can(context, "customers.read")} canReadMembers={can(context, "members.read")} />;
}

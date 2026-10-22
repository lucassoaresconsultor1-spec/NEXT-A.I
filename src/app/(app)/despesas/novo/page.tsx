import { listStoreOptions } from "@/server/stores/options";
import { listCategories } from "@/server/expenses/service";
import { requireTenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/guard";
import { AccessDenied } from "@/components/shell/access-denied";
import NewExpenseForm from "./form";

export default async function NewExpensePage() {
  const context = await requireTenantContext();
  if (!can(context, "expenses.manage")) return <AccessDenied />;
  const [stores, categories] = await Promise.all([
    listStoreOptions(context),
    listCategories(context),
  ]);
  return <NewExpenseForm stores={stores} categories={categories} />;
}

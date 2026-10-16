import { AppShell } from "@/components/shell/app-shell";
import { requireTenantContext } from "@/server/authz/context";
import { getShellData } from "@/server/shell";

export default async function TenantLayout({ children }: LayoutProps<"/">) {
  const context = await requireTenantContext();
  const shell = await getShellData(context);
  return <AppShell {...shell}>{children}</AppShell>;
}

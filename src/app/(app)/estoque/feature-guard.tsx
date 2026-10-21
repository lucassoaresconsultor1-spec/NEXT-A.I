import { PackageX } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";
import { Card } from "@/components/ui/layout";
import { isDomainError } from "@/server/errors";

/** Shown when the organization's plan does not include inventory control. */
export function InventoryUnavailable({ message }: { message: string }) {
  return (
    <Card>
      <EmptyState icon={PackageX} title="Controle de estoque indisponível no plano" description={message} />
    </Card>
  );
}

/**
 * Runs a stock service call; a plan limit becomes `{ unavailable: message }`
 * so the page can render InventoryUnavailable. Any other error is rethrown
 * (the route error boundary handles it).
 */
export async function withInventoryPlan<T>(load: () => Promise<T>): Promise<{ data: T } | { unavailable: string }> {
  try {
    return { data: await load() };
  } catch (error) {
    if (isDomainError(error) && error.code === "limit") return { unavailable: error.message };
    throw error;
  }
}

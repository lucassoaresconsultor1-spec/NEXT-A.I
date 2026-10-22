"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/layout";

export default function ExpensesError({ retry }: { error: unknown; retry: () => void }) {
  return <div role="alert"><Card className="space-y-3 p-6">
    <h1 className="text-base font-semibold text-ink">Não foi possível carregar as despesas. Tente novamente.</h1>
    <Button onClick={retry} variant="secondary">Tentar novamente</Button>
  </Card></div>;
}

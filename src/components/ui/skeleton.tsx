import type * as React from "react";
import { Card, CardBody } from "@/components/ui/layout";
import { cn } from "@/lib/utils";

/** Placeholder block; decorative, so screen readers skip it. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div aria-hidden="true" className={cn("motion-safe:animate-pulse rounded bg-line", className)} />;
}

/** Page placeholder: title, subtitle and a card with table-like lines. */
export function PageSkeleton({ rows = 6 }: { rows?: number }): React.JSX.Element {
  const rowCount = Math.min(12, Math.max(1, Math.floor(rows)));
  const widths = ["w-full", "w-5/6", "w-2/3"];

  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Carregando…</span>
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Card>
        <CardBody className="space-y-4">
          {Array.from({ length: rowCount }, (_, index) => (
            <div key={index} className="border-b border-line pb-4 last:border-0 last:pb-0">
              <Skeleton className={`h-4 ${widths[index % widths.length]}`} />
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

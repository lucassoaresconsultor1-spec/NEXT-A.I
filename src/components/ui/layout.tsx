import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/** Definition list for read-only record details. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-0.5">
          <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{item.label}</dt>
          <dd className="text-sm text-ink">{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

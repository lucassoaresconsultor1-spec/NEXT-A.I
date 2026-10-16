import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("border-b border-line bg-canvas/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-4 py-3 align-middle text-ink", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("hover:bg-canvas/50", className)} {...props} />;
}

function withParams(basePath: string, params: Record<string, string | undefined>, changes: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) if (value) search.set(key, value);
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Column header that toggles server-side sorting through the URL. */
export function SortableTh({
  label,
  column,
  basePath,
  params,
}: {
  label: string;
  column: string;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const active = params.sort === column;
  const nextDir = active && params.dir !== "desc" ? "desc" : "asc";
  const Icon = params.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <Th aria-sort={active ? (params.dir === "desc" ? "descending" : "ascending") : "none"}>
      <Link
        href={withParams(basePath, params, { sort: column, dir: nextDir, page: undefined })}
        className="inline-flex items-center gap-1 hover:text-ink"
      >
        {label}
        {active ? <Icon className="size-3" aria-hidden /> : null}
      </Link>
    </Th>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  if (total === 0) return null;
  const link = (target: number) => withParams(basePath, params, { page: target > 1 ? String(target) : undefined });
  const navClass = "inline-flex size-8 items-center justify-center rounded-md border border-line-strong bg-surface";
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-ink-muted">
      <span>
        {total} {total === 1 ? "registro" : "registros"} · página {page} de {pageCount}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className={navClass} aria-label="Página anterior">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
        ) : null}
        {page < pageCount ? (
          <Link href={link(page + 1)} className={navClass} aria-label="Próxima página">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

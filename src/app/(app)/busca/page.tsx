import { Building2, Map, Search, SearchX, Store, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccessDenied } from "@/components/shell/access-denied";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Notice } from "@/components/ui/feedback";
import { Card, CardHeader, PageHeader } from "@/components/ui/layout";
import { requireTenantContext } from "@/server/authz/context";
import {
  canSearch,
  SEARCH_GROUP_LIMIT,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  searchEverything,
  type SearchResult,
} from "@/server/search/service";

export const metadata: Metadata = { title: "Busca" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type OkResult = Extract<SearchResult, { status: "ok" }>;

interface Hit {
  key: string;
  href: string;
  title: string;
  detail?: string;
  badge?: ReactNode;
}

function ResultGroup({ icon: Icon, title, hits, more }: { icon: LucideIcon; title: string; hits: Hit[]; more?: { href: string; label: string } }) {
  return (
    <Card>
      <CardHeader
        title={`${title} (${hits.length})`}
        description={hits.length === SEARCH_GROUP_LIMIT ? `Mostrando os primeiros ${SEARCH_GROUP_LIMIT} resultados.` : undefined}
        actions={
          more && hits.length === SEARCH_GROUP_LIMIT ? (
            <Link href={more.href} className="text-sm font-medium text-brand hover:underline">
              {more.label}
            </Link>
          ) : undefined
        }
      />
      <ul className="divide-y divide-line">
        {hits.map((hit) => (
          <li key={hit.key}>
            <Link href={hit.href} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas/60 focus-visible:bg-canvas/60">
              <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{hit.title}</span>
                {hit.detail ? <span className="block truncate text-xs text-ink-muted">{hit.detail}</span> : null}
              </span>
              {hit.badge}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function groupsOf(result: OkResult) {
  const q = encodeURIComponent(result.query);
  const groups: { key: string; icon: LucideIcon; title: string; hits: Hit[]; more?: { href: string; label: string } }[] = [];
  if (result.stores?.length) {
    groups.push({
      key: "stores",
      icon: Store,
      title: "Lojas",
      more: { href: `/lojas?q=${q}`, label: "Ver todas em Lojas" },
      hits: result.stores.map((store) => ({
        key: store.id,
        href: `/lojas/${store.id}`,
        title: store.name,
        detail: [store.code, [store.city, store.state].filter(Boolean).join("/")].filter(Boolean).join(" · "),
        badge: store.status === "inactive" ? <Badge>Inativa</Badge> : undefined,
      })),
    });
  }
  if (result.regions?.length) {
    groups.push({
      key: "regions",
      icon: Map,
      title: "Regiões",
      more: { href: "/regioes", label: "Ver regiões" },
      hits: result.regions.map((region) => ({ key: region.id, href: "/regioes", title: region.name, detail: region.description ?? undefined })),
    });
  }
  if (result.departments?.length) {
    groups.push({
      key: "departments",
      icon: Building2,
      title: "Departamentos",
      more: { href: "/departamentos", label: "Ver departamentos" },
      hits: result.departments.map((department) => ({
        key: department.id,
        href: "/departamentos",
        title: department.name,
        badge: department.isActive ? undefined : <Badge>Inativo</Badge>,
      })),
    });
  }
  if (result.members?.length) {
    groups.push({
      key: "members",
      icon: Users,
      title: "Pessoas",
      more: { href: `/equipe?q=${q}`, label: "Ver todas em Equipe" },
      hits: result.members.map((member) => ({
        key: member.membershipId,
        href: `/equipe/${member.membershipId}`,
        title: member.name,
        detail: `${member.email} · ${member.roleName}`,
        badge: member.status === "suspended" ? <Badge tone="attention">Suspenso</Badge> : undefined,
      })),
    });
  }
  return groups;
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await requireTenantContext();
  if (!canSearch(context)) return <AccessDenied detail="Seu perfil não inclui nenhuma área pesquisável." />;
  const raw = (await searchParams).q;
  const query = typeof raw === "string" ? raw : "";
  const result = query.trim() ? await searchEverything(context, query) : null;
  const groups = result?.status === "ok" ? groupsOf(result) : [];

  return (
    <>
      <Breadcrumbs items={[{ label: "Painel", href: "/painel" }, { label: "Busca" }]} />
      <PageHeader title="Busca" description="Encontre lojas, regiões, departamentos e pessoas que você tem permissão para ver." />
      <Card>
        <Form action="/busca" role="search" aria-label="Buscar na empresa" className="space-y-1.5 px-4 py-4">
          <label htmlFor="busca-q" className="block text-sm font-medium text-ink">
            Termo de busca
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="busca-q"
              name="q"
              type="search"
              defaultValue={result?.query ?? query}
              minLength={SEARCH_MIN_LENGTH}
              maxLength={SEARCH_MAX_LENGTH}
              placeholder="Nome, código ou e-mail"
              aria-describedby="busca-q-hint"
              className="block h-10 min-w-56 flex-1 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-brand/25 focus:outline-none"
            />
            <Button type="submit">
              <Search className="size-4" aria-hidden /> Buscar
            </Button>
          </div>
          <p id="busca-q-hint" className="text-xs text-ink-muted">
            De {SEARCH_MIN_LENGTH} a {SEARCH_MAX_LENGTH} caracteres. Até {SEARCH_GROUP_LIMIT} resultados por grupo.
          </p>
        </Form>
      </Card>
      {result === null ? (
        <Card>
          <EmptyState icon={Search} title="O que você procura?" description="Digite parte do nome de uma loja, região, departamento ou pessoa." />
        </Card>
      ) : result.status === "too_short" ? (
        <Notice tone="info" title={`Digite ao menos ${SEARCH_MIN_LENGTH} caracteres para buscar.`} />
      ) : result.status === "too_long" ? (
        <Notice tone="warning" title={`Use no máximo ${SEARCH_MAX_LENGTH} caracteres.`} />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={SearchX}
            title={`Nada encontrado para “${result.query}”`}
            description="Confira a grafia ou tente um trecho menor do nome. A busca considera apenas o que o seu perfil permite ver."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <ResultGroup key={group.key} icon={group.icon} title={group.title} hits={group.hits} more={group.more} />
          ))}
        </div>
      )}
    </>
  );
}

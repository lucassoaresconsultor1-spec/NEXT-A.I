import {
  Building2,
  History,
  LayoutDashboard,
  Map,
  Settings,
  ShieldCheck,
  Store,
  Users,
  type LucideIcon,
} from "lucide-react";

// Only implemented modules appear here; future modules are added with their code.
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Visão geral",
    items: [{ href: "/painel", label: "Painel", icon: LayoutDashboard }],
  },
  {
    label: "Estrutura",
    items: [
      { href: "/lojas", label: "Lojas", icon: Store },
      { href: "/regioes", label: "Regiões", icon: Map },
      { href: "/departamentos", label: "Departamentos", icon: Building2 },
    ],
  },
  {
    label: "Pessoas e acesso",
    items: [
      { href: "/equipe", label: "Equipe", icon: Users },
      { href: "/perfis", label: "Perfis de acesso", icon: ShieldCheck },
    ],
  },
  {
    label: "Administração",
    items: [
      { href: "/auditoria", label: "Auditoria", icon: History },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

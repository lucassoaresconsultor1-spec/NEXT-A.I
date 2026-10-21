import {
  ArrowLeftRight,
  Award,
  Boxes,
  Contact,
  Building2,
  ClipboardList,
  History,
  LayoutDashboard,
  Map,
  Package,
  Settings,
  ShieldCheck,
  Store,
  Tags,
  Truck,
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
    label: "Catálogo",
    items: [
      { href: "/produtos", label: "Produtos", icon: Package },
      { href: "/categorias", label: "Categorias", icon: Tags },
      { href: "/marcas", label: "Marcas", icon: Award },
      { href: "/fornecedores", label: "Fornecedores", icon: Truck },
    ],
  },
  {
    label: "Estoque",
    items: [
      { href: "/estoque", label: "Saldos", icon: Boxes },
      { href: "/estoque/movimentacoes", label: "Movimentações", icon: ArrowLeftRight },
      { href: "/compras", label: "Compras", icon: ClipboardList },
    ],
  },
  {
    label: "Vendas",
    items: [{ href: "/clientes", label: "Clientes", icon: Contact }],
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

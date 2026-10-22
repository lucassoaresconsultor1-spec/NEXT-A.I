import {
  ArrowLeftRight,
  Award,
  Boxes,
  Contact,
  Building2,
  ClipboardCheck,
  ClipboardList,
  History,
  LayoutDashboard,
  Map,
  Repeat,
  ReceiptText,
  CalendarDays,
  ContactRound,
  Target,
  HandCoins,
  Banknote,
  ScrollText,
  ShoppingCart,
  Upload,
  Wallet,
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
      { href: "/importacoes", label: "Importar dados", icon: Upload },
    ],
  },
  {
    label: "Estoque",
    items: [
      { href: "/estoque", label: "Saldos", icon: Boxes },
      { href: "/estoque/movimentacoes", label: "Movimentações", icon: ArrowLeftRight },
      { href: "/estoque/transferencias", label: "Transferências", icon: Repeat },
      { href: "/compras", label: "Compras", icon: ClipboardList },
      { href: "/estoque/inventarios", label: "Inventários", icon: ClipboardCheck },
    ],
  },
  {
    label: "Vendas",
    items: [
      { href: "/pdv", label: "PDV", icon: ShoppingCart },
      { href: "/vendas", label: "Histórico de vendas", icon: ScrollText },
      { href: "/caixa", label: "Caixa", icon: Wallet },
      { href: "/caixa/sessoes", label: "Sessões de caixa", icon: ReceiptText },
      { href: "/clientes", label: "Clientes", icon: Contact },
      { href: "/metas", label: "Metas", icon: Target },
      { href: "/comissoes", label: "Comissões", icon: HandCoins },
      { href: "/despesas", label: "Despesas", icon: Banknote },
    ],
  },
  {
    label: "Pessoas e acesso",
    items: [
      { href: "/equipe", label: "Equipe", icon: Users },
      { href: "/vendedores", label: "Vendedores", icon: ContactRound },
      { href: "/perfis", label: "Perfis de acesso", icon: ShieldCheck },
    ],
  },
  {
    label: "Administração",
    items: [
      { href: "/auditoria", label: "Auditoria", icon: History },
      { href: "/calendario", label: "Calendário", icon: CalendarDays },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

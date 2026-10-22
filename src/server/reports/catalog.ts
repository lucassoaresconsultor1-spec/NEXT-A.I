import "server-only";
import type { CsvCell } from "@/lib/csv";
import type { TenantContext } from "@/server/authz/context";
import { listClosings } from "@/server/closings/service";
import { invalid } from "@/server/errors";
import { EXPENSE_STATUS_LABELS } from "@/server/expenses/schemas";
import { listExpenses } from "@/server/expenses/service";
import type { SalesMetrics } from "@/server/metrics/definitions";
import { salesSeries } from "@/server/metrics/sales";
import { listStoreOptions } from "@/server/stores/options";

// Report catalog (m18): every report reads the existing services, so permissions,
// store scope and formulas are theirs; this file only shapes rows for the CSV.

export const REPORT_KINDS = ["sales_by_period", "sales_by_store", "sales_by_salesperson", "expenses", "daily_closings"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  sales_by_period: "Vendas por período",
  sales_by_store: "Vendas por loja",
  sales_by_salesperson: "Vendas por vendedor",
  expenses: "Despesas",
  daily_closings: "Fechamentos diários",
};
export const MAX_REPORT_ROWS = 10_000;

export interface ReportParams {
  kind: ReportKind;
  from: string;
  to: string;
  storeId?: string;
  groupBy?: "day" | "week" | "month";
}

const SALES_HEADER = ["Bruto", "Descontos", "Cancelado", "Devolvido", "Líquido", "Vendas", "Ticket médio", "Itens por venda"];
const salesCells = (metrics: SalesMetrics): CsvCell[] => [
  { cents: metrics.grossRevenueCents },
  { cents: metrics.discountCents },
  { cents: metrics.cancelledCents },
  { cents: metrics.returnedCents },
  { cents: metrics.netRevenueCents },
  metrics.saleCount,
  { cents: metrics.averageTicketCents },
  { decimal: metrics.itemsPerSale },
];

const RECONCILIATION_LABELS: Record<string, string> = { not_configured: "Pendente (sem provedor)", no_payments: "Sem pagamentos integrados", reconciled: "Conciliado", divergent: "Com divergência" };

export async function buildReport(context: TenantContext, params: ReportParams): Promise<{ header: string[]; rows: CsvCell[][] }> {
  const period = { from: params.from, to: params.to, ...(params.storeId ? { storeIds: [params.storeId] } : {}) };
  if (params.kind === "sales_by_period" || params.kind === "sales_by_store" || params.kind === "sales_by_salesperson") {
    const groupBy = params.kind === "sales_by_store" ? "store" : params.kind === "sales_by_salesperson" ? "salesperson" : (params.groupBy ?? "day");
    const series = await salesSeries(context, { ...period, groupBy });
    const first = params.kind === "sales_by_store" ? "Loja" : params.kind === "sales_by_salesperson" ? "Vendedor" : "Período";
    return { header: [first, ...SALES_HEADER], rows: series.map((row) => [row.label, ...salesCells(row.metrics)]) };
  }
  if (params.kind === "expenses") {
    const rows: CsvCell[][] = [];
    for (let page = 1; ; page += 1) {
      const result = await listExpenses(context, { from: params.from, to: params.to, storeId: params.storeId, page });
      for (const row of result.rows) {
        rows.push([row.competenceDate, row.storeName, row.categoryName, row.description, { cents: row.amountCents }, row.dueDate, EXPENSE_STATUS_LABELS[row.status], row.paidOn]);
      }
      if (page >= result.pageCount || rows.length > MAX_REPORT_ROWS) break;
    }
    return { header: ["Competência", "Loja", "Categoria", "Descrição", "Valor", "Vencimento", "Situação", "Pago em"], rows };
  }
  const closings = await listClosings(context, { from: params.from, to: params.to, storeId: params.storeId });
  const names = new Map((await listStoreOptions(context, { includeInactive: true })).map((store) => [store.id, store.name]));
  return {
    header: ["Dia", "Loja", "Versão", "Vendas", "Total", "Cancelado", "Devolvido", "Dinheiro", "Maquininha", "Pix", "Cartão integrado", "Diferença de caixa", "Conciliação"],
    rows: closings.map((row) => [
      row.day,
      names.get(row.storeId) ?? row.storeId,
      row.version,
      row.saleCount,
      { cents: row.salesCents },
      { cents: row.cancelledCents },
      { cents: row.returnedCents },
      { cents: row.cashCents },
      { cents: row.cardExternalCents },
      { cents: row.pixCents },
      { cents: row.cardProviderCents },
      { cents: row.cashDifferenceCents },
      RECONCILIATION_LABELS[row.reconciliation] ?? row.reconciliation,
    ]),
  };
}

export function assertRowLimit(rows: unknown[]) {
  if (rows.length > MAX_REPORT_ROWS) throw invalid(`O relatório passa de ${MAX_REPORT_ROWS.toLocaleString("pt-BR")} linhas. Reduza o período ou filtre por loja.`);
}

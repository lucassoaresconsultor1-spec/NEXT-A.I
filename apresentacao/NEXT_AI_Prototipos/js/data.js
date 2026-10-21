// Dados FICTÍCIOS da demonstração "NEXT Varejo Demonstração".
// Fonte única: telas, slides, inventário e respostas do assistente leem daqui,
// então todo número exibido sai destes registros. Valores em centavos.

export const COMPANY = { name: "NEXT Varejo Demonstração", short: "NEXT Varejo", plan: "Rede" };
export const TODAY = "30/09/2026";
export const PERIOD = { label: "Setembro/2026", previous: "Agosto/2026", days: 30, firstWeekday: 2 }; // 01/09/2026 = terça

export const REGIONS = [
  { id: "capital", name: "Capital" },
  { id: "interior", name: "Interior e Litoral" },
];

const S = (name, revenue, sales) => ({ name, revenue: revenue * 100, sales });

export const STORES = [
  {
    id: "L01", name: "Centro", city: "São Paulo", region: "capital", manager: "Ricardo Almeida",
    revenue: 118_420_00, previous: 106_200_00, target: 120_000_00, sales: 296, octTarget: 125_000_00,
    sellers: [S("Ana Ribeiro", 27850, 68), S("Lucas Mendes", 25300, 63), S("Camila Torres", 23940, 60), S("Rafael Nunes", 22180, 56), S("Beatriz Lima", 19150, 49)],
  },
  {
    id: "L02", name: "Jardins", city: "São Paulo", region: "capital", manager: "Fernanda Lopes",
    revenue: 126_900_00, previous: 113_500_00, target: 130_000_00, sales: 290, octTarget: 135_000_00,
    sellers: [S("Gabriel Souza", 31200, 71), S("Larissa Martins", 28450, 65), S("Diego Carvalho", 25900, 59), S("Patrícia Gomes", 22300, 51), S("Thiago Barros", 19050, 44)],
  },
  {
    id: "L03", name: "Moema", city: "São Paulo", region: "capital", manager: "Bruno Castro",
    revenue: 92_380_00, previous: 86_900_00, target: 110_000_00, sales: 242, octTarget: 112_000_00,
    sellers: [S("Isabela Freitas", 22840, 60), S("Mateus Rocha", 20110, 53), S("Vanessa Pires", 18630, 49), S("Felipe Araújo", 16900, 44), S("Natália Dias", 13900, 36)],
  },
  {
    id: "L04", name: "Campinas", city: "Campinas", region: "interior", manager: "Juliana Prado",
    revenue: 84_150_00, previous: 72_400_00, target: 100_000_00, sales: 228, octTarget: 95_000_00,
    sellers: [S("Eduardo Moraes", 21300, 58), S("Carolina Reis", 18750, 51), S("Gustavo Pinto", 16400, 44), S("Aline Cardoso", 15200, 41), S("Rodrigo Lima", 12500, 34)],
  },
  {
    id: "L05", name: "Santos", city: "Santos", region: "interior", manager: "Marcos Vieira",
    revenue: 65_500_00, previous: 70_585_00, target: 90_000_00, sales: 192, octTarget: 85_000_00,
    sellers: [S("Renata Costa", 16900, 49), S("André Batista", 14300, 42), S("Simone Farias", 13100, 38), S("Leandro Melo", 11400, 34), S("Priscila Neves", 9800, 29)],
  },
];

export const PEOPLE = {
  owner: { name: "Marina Duarte", role: "Dono", email: "marina.duarte@nextvarejo.example" },
  coordinator: { name: "Helena Rocha", role: "Coordenador", scope: "Região Capital (Centro, Jardins, Moema)", email: "helena.rocha@nextvarejo.example" },
  finance: [
    { name: "Paulo Teixeira", role: "Financeiro", email: "paulo.teixeira@nextvarejo.example" },
    { name: "Débora Santana", role: "Financeiro", email: "debora.santana@nextvarejo.example" },
  ],
  platform: { name: "Equipe NEXT A.I", role: "Administrador da plataforma" },
};

// ---------- Derivados (nunca digitados à mão) ----------
const sum = (list, pick) => list.reduce((total, item) => total + pick(item), 0);
const pct = (value, base) => (base ? (value / base) * 100 : 0);

for (const store of STORES) {
  store.sellers.forEach((seller, index) => {
    seller.id = `${store.id}-V${index + 1}`;
    seller.store = store.id;
    seller.target = store.target / store.sellers.length;
    seller.attainment = pct(seller.revenue, seller.target);
    seller.ticket = seller.revenue / seller.sales;
  });
  if (sum(store.sellers, (s) => s.revenue) !== store.revenue) throw new Error(`Receita de ${store.name} não fecha`);
  if (sum(store.sellers, (s) => s.sales) !== store.sales) throw new Error(`Vendas de ${store.name} não fecham`);
  store.attainment = pct(store.revenue, store.target);
  store.growth = pct(store.revenue - store.previous, store.previous);
  store.ticket = store.revenue / store.sales;
  store.octProjection = Math.round((store.revenue / PERIOD.days) * 31);
}

export const SELLERS = STORES.flatMap((store) => store.sellers);

export const TOTAL = {
  revenue: sum(STORES, (s) => s.revenue),
  previous: sum(STORES, (s) => s.previous),
  target: sum(STORES, (s) => s.target),
  sales: sum(STORES, (s) => s.sales),
  octTarget: sum(STORES, (s) => s.octTarget),
};
TOTAL.attainment = pct(TOTAL.revenue, TOTAL.target);
TOTAL.growth = pct(TOTAL.revenue - TOTAL.previous, TOTAL.previous);
TOTAL.ticket = TOTAL.revenue / TOTAL.sales;
TOTAL.octProjection = sum(STORES, (s) => s.octProjection);

export const BELOW_TARGET = SELLERS.filter((s) => s.attainment < 100);
export const CRITICAL_SELLERS = SELLERS.filter((s) => s.attainment < 80).sort((a, b) => a.attainment - b.attainment);
export const RANKED_SELLERS = [...SELLERS].sort((a, b) => b.revenue - a.revenue);
export const RANKED_STORES = [...STORES].sort((a, b) => b.revenue - a.revenue);
export const capital = (list) => list.filter((s) => (s.store ? storeById(s.store) : s).region === "capital");

export function storeById(id) {
  return STORES.find((s) => s.id === id);
}

// Vendas diárias: peso por dia da semana (dom..sáb), fechamento exato no último dia.
const WEEKDAY_WEIGHT = [0.8, 0.85, 0.9, 0.95, 1.0, 1.15, 1.35];
export function weekdayOf(day) {
  return (PERIOD.firstWeekday + day - 1) % 7;
}
// Tendência de alta ao longo do mês, picos após o pagamento (dias 5-6 e 20) e
// uma variação determinística pequena: semanas diferentes, total exato.
function dayWeight(day, seed) {
  const payday = [5, 6, 20].includes(day) ? 1.12 : 1;
  return WEEKDAY_WEIGHT[weekdayOf(day)] * (0.92 + (0.16 * (day - 1)) / 29) * payday * (1 + 0.05 * Math.sin(day * 1.7 + seed));
}
function distribute(total, days, seed = 0) {
  const weights = Array.from({ length: days }, (_, i) => dayWeight(i + 1, seed));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const values = weights.map((w) => Math.round((total * w) / totalWeight));
  values[days - 1] += total - values.reduce((a, b) => a + b, 0);
  return values;
}
STORES.forEach((store, index) => {
  store.daily = distribute(store.revenue, PERIOD.days, index);
  store.dailySales = distribute(store.sales, PERIOD.days, index);
});
export const DAILY = Array.from({ length: PERIOD.days }, (_, i) => sum(STORES, (s) => s.daily[i]));
export const DAILY_SALES = Array.from({ length: PERIOD.days }, (_, i) => sum(STORES, (s) => s.dailySales[i]));
export const DAILY_PREVIOUS = distribute(TOTAL.previous, 30, 9);

const weekSum = (series, from, to) => series.slice(from - 1, to).reduce((a, b) => a + b, 0);
export const WEEKS = {
  last: { label: "21 a 27/09", revenue: weekSum(DAILY, 21, 27), sales: weekSum(DAILY_SALES, 21, 27) },
  before: { label: "14 a 20/09", revenue: weekSum(DAILY, 14, 20), sales: weekSum(DAILY_SALES, 14, 20) },
};
WEEKS.change = pct(WEEKS.last.revenue - WEEKS.before.revenue, WEEKS.before.revenue);

// Categorias: participação fixa da receita total, com fechamento exato.
const CATEGORY_SHARE = [
  ["Vestuário", 34], ["Calçados", 28], ["Esportes", 16], ["Acessórios", 14], ["Serviços", 8],
];
export const CATEGORIES = (() => {
  const list = CATEGORY_SHARE.map(([name, share]) => ({ name, share, revenue: Math.round((TOTAL.revenue * share) / 100) }));
  list[0].revenue += TOTAL.revenue - sum(list, (c) => c.revenue);
  return list;
})();

export const PRODUCTS = [
  { sku: "CAL-0142", name: "Tênis Runner Pro 42", category: "Calçados", price: 459_90, cost: 238_00, units: 96, status: "Ativo", stock: 38 },
  { sku: "VES-0310", name: "Jaqueta Corta-Vento Urban", category: "Vestuário", price: 329_90, cost: 151_00, units: 118, status: "Ativo", stock: 64 },
  { sku: "VES-0122", name: "Calça Jeans Slim Azul", category: "Vestuário", price: 219_90, cost: 98_00, units: 204, status: "Ativo", stock: 151 },
  { sku: "ESP-0507", name: "Kit Treino Dry-Fit", category: "Esportes", price: 189_90, cost: 82_00, units: 167, status: "Ativo", stock: 92 },
  { sku: "CAL-0088", name: "Sapatênis Couro Café", category: "Calçados", price: 349_90, cost: 171_00, units: 81, status: "Ativo", stock: 27 },
  { sku: "ACE-0215", name: "Mochila Executiva 22L", category: "Acessórios", price: 279_90, cost: 126_00, units: 74, status: "Ativo", stock: 45 },
  { sku: "ESP-0611", name: "Bola Oficial Futsal", category: "Esportes", price: 149_90, cost: 64_00, units: 88, status: "Ativo", stock: 6 },
  { sku: "ACE-0033", name: "Relógio Digital Sport", category: "Acessórios", price: 239_90, cost: 109_00, units: 52, status: "Ativo", stock: 19 },
  { sku: "VES-0408", name: "Camiseta Básica Algodão", category: "Vestuário", price: 69_90, cost: 24_00, units: 412, status: "Ativo", stock: 520 },
  { sku: "SRV-0001", name: "Garantia Estendida 12 meses", category: "Serviços", price: 89_90, cost: 0, units: 210, status: "Ativo", stock: null },
  { sku: "SRV-0002", name: "Ajuste e Personalização", category: "Serviços", price: 39_90, cost: 0, units: 145, status: "Ativo", stock: null },
  { sku: "CAL-0019", name: "Chinelo Slide Conforto", category: "Calçados", price: 79_90, cost: 31_00, units: 0, status: "Inativo", stock: 0 },
];
for (const product of PRODUCTS) product.revenue = product.price * product.units;

// Formas de pagamento das vendas de setembro (participação da receita).
export const PAYMENTS = (() => {
  const list = [["Cartão de crédito", 52], ["PIX", 22], ["Cartão de débito", 18], ["Dinheiro", 8]].map(([name, share]) => ({
    name, share, amount: Math.round((TOTAL.revenue * share) / 100),
  }));
  list[0].amount += TOTAL.revenue - sum(list, (p) => p.amount);
  return list;
})();

// ---------- Financeiro (competência setembro e caixa) ----------
const credit = PAYMENTS[0].amount;
const settledNow = sum(PAYMENTS.slice(1), (p) => p.amount);
export const FINANCE = {
  openingBalance: 185_200_00,
  creditFromPreviousMonths: 168_400_00,
  settledNow,
  receivables: [
    { month: "Outubro/2026", amount: Math.round(credit * 0.4) },
    { month: "Novembro/2026", amount: Math.round(credit * 0.35) },
  ],
  expenses: [
    { category: "Fornecedores (mercadorias)", amount: 236_800_00 },
    { category: "Folha de pagamento", amount: 98_500_00 },
    { category: "Aluguel das lojas", amount: 42_000_00 },
    { category: "Comissões (3% das vendas)", amount: Math.round(TOTAL.revenue * 0.03) },
    { category: "Marketing", amount: 12_300_00 },
    { category: "Taxas de meios de pagamento", amount: 9_870_00 },
    { category: "Energia e utilidades", amount: 8_940_00 },
    { category: "Sistemas e serviços", amount: 3_450_00 },
  ],
  payables: [
    { id: "CP-0912", supplier: "Energia Litoral S.A. (Santos)", category: "Energia e utilidades", due: "25/09/2026", amount: 1_640_00, status: "Vencida" },
    { id: "CP-0931", supplier: "Comissões de setembro", category: "Comissões (3% das vendas)", due: "05/10/2026", amount: Math.round(TOTAL.revenue * 0.03), status: "A vencer" },
    { id: "CP-0927", supplier: "Malharia Horizonte Ltda.", category: "Fornecedores (mercadorias)", due: "10/10/2026", amount: 22_400_00, status: "A vencer" },
    { id: "CP-0929", supplier: "Calçados Passo Firme Ltda.", category: "Fornecedores (mercadorias)", due: "15/10/2026", amount: 16_200_00, status: "A vencer" },
  ],
  paidSamples: [
    { id: "CP-0901", supplier: "Imobiliária Paulista (5 lojas)", category: "Aluguel das lojas", due: "05/09/2026", amount: 42_000_00, status: "Paga" },
    { id: "CP-0905", supplier: "Folha de pagamento — setembro", category: "Folha de pagamento", due: "05/09/2026", amount: 98_500_00, status: "Paga" },
    { id: "CP-0918", supplier: "Agência Vitrine Digital", category: "Marketing", due: "20/09/2026", amount: 12_300_00, status: "Paga" },
  ],
};
FINANCE.receivables.push({ month: "Dezembro/2026", amount: credit - sum(FINANCE.receivables, (r) => r.amount) });
FINANCE.totalExpenses = sum(FINANCE.expenses, (e) => e.amount);
FINANCE.pending = sum(FINANCE.payables, (p) => p.amount);
FINANCE.paid = FINANCE.totalExpenses - FINANCE.pending;
FINANCE.inflows = FINANCE.settledNow + FINANCE.creditFromPreviousMonths;
FINANCE.closingBalance = FINANCE.openingBalance + FINANCE.inflows - FINANCE.paid;
FINANCE.result = TOTAL.revenue - FINANCE.totalExpenses;
FINANCE.margin = pct(FINANCE.result, TOTAL.revenue);
FINANCE.credit = credit;
FINANCE.overdue = FINANCE.payables.filter((p) => p.status === "Vencida");

// ---------- Clientes ----------
export const CUSTOMERS = {
  total: 3184, newThisMonth: 412, returningShare: 37,
  list: [
    { name: "Juliana Ferraz", city: "São Paulo", store: "L02", lastPurchase: "29/09/2026", purchases: 9, spent12m: 4_380_50, segment: "Recorrente" },
    { name: "Roberto Sampaio", city: "São Paulo", store: "L01", lastPurchase: "28/09/2026", purchases: 6, spent12m: 2_915_80, segment: "Recorrente" },
    { name: "Marcela Guimarães", city: "Campinas", store: "L04", lastPurchase: "27/09/2026", purchases: 4, spent12m: 1_779_60, segment: "Ativo" },
    { name: "Otávio Bernardes", city: "Santos", store: "L05", lastPurchase: "26/09/2026", purchases: 2, spent12m: 689_80, segment: "Novo" },
    { name: "Clara Montenegro", city: "São Paulo", store: "L03", lastPurchase: "25/09/2026", purchases: 11, spent12m: 5_204_10, segment: "Recorrente" },
    { name: "Henrique Vasques", city: "Campinas", store: "L04", lastPurchase: "22/09/2026", purchases: 3, spent12m: 1_049_70, segment: "Ativo" },
    { name: "Sofia Albuquerque", city: "São Paulo", store: "L02", lastPurchase: "20/09/2026", purchases: 5, spent12m: 2_199_50, segment: "Ativo" },
    { name: "Fábio Quintana", city: "Santos", store: "L05", lastPurchase: "12/08/2026", purchases: 1, spent12m: 459_90, segment: "Inativo há 49 dias" },
  ],
};

// ---------- Vendas de exemplo (lista) ----------
export const SALES = [
  { id: "V-L01-002481", date: "30/09 18:42", store: "L01", seller: "Ana Ribeiro", customer: "Roberto Sampaio", items: 3, total: 879_70, payment: "Crédito 3x", status: "Concluída" },
  { id: "V-L02-002377", date: "30/09 18:15", store: "L02", seller: "Gabriel Souza", customer: "Juliana Ferraz", items: 2, total: 789_80, payment: "PIX", status: "Concluída" },
  { id: "V-L03-001902", date: "30/09 17:58", store: "L03", seller: "Isabela Freitas", customer: "Consumidor", items: 1, total: 219_90, payment: "Débito", status: "Concluída" },
  { id: "V-L04-001766", date: "30/09 17:31", store: "L04", seller: "Eduardo Moraes", customer: "Marcela Guimarães", items: 4, total: 1_009_60, payment: "Crédito 4x", status: "Concluída" },
  { id: "V-L05-001511", date: "30/09 17:02", store: "L05", seller: "Renata Costa", customer: "Otávio Bernardes", items: 2, total: 349_80, payment: "PIX", status: "Concluída" },
  { id: "V-L01-002480", date: "30/09 16:47", store: "L01", seller: "Lucas Mendes", customer: "Consumidor", items: 1, total: 459_90, payment: "Crédito 2x", status: "Cancelada" },
  { id: "V-L02-002376", date: "30/09 16:20", store: "L02", seller: "Larissa Martins", customer: "Sofia Albuquerque", items: 3, total: 669_70, payment: "Crédito 3x", status: "Concluída" },
  { id: "V-L03-001901", date: "30/09 15:54", store: "L03", seller: "Mateus Rocha", customer: "Clara Montenegro", items: 2, total: 549_80, payment: "Dinheiro", status: "Concluída" },
];

export const SALE_DETAIL = {
  id: "V-L01-002481", date: "30/09/2026 18:42", store: "L01", seller: "Ana Ribeiro", customer: "Roberto Sampaio", cashier: "Caixa 01 · Operador Júlio Faria",
  items: [
    { sku: "CAL-0142", name: "Tênis Runner Pro 42", qty: 1, price: 459_90, discount: 0 },
    { sku: "VES-0310", name: "Jaqueta Corta-Vento Urban", qty: 1, price: 329_90, discount: 0 },
    { sku: "SRV-0001", name: "Garantia Estendida 12 meses", qty: 1, price: 89_90, discount: 0 },
  ],
  payments: [{ method: "Cartão de crédito", installments: "3x de R$ 293,23", amount: 879_70, status: "Aprovado (NSU 784512)" }],
};

// ---------- Formatação pt-BR ----------
export const brl = (cents) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brlShort = (cents) => {
  const value = cents / 100;
  return value >= 1000 ? `R$ ${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : brl(cents);
};
export const num = (value) => value.toLocaleString("pt-BR");
export const pctFmt = (value, digits = 1) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
export const signed = (value, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${pctFmt(Math.abs(value), digits)}`;

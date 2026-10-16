// FICTITIOUS master data for the demo. Every company, person, product, brand and
// document below is invented; none of it is a real record.
import { ean13 } from "./lib.js";

export const ORGANIZATION = {
  id: "org-demo",
  name: "Grupo Vitrine Sul",
  segment: "Calçados e moda",
  plan: "Rede",
  timezone: "America/Sao_Paulo",
};

export const REGIONS = [
  { id: "r-cap", name: "Capital" },
  { id: "r-int", name: "Interior e litoral" },
];

// factor = relative traffic; wait = typical minutes in the queue.
export const STORES = [
  { id: "s1", code: "L01", name: "Loja Centro", city: "Porto Alegre", uf: "RS", regionId: "r-cap", factor: 1.2, wait: 3 },
  { id: "s2", code: "L02", name: "Loja Shopping Norte", city: "Porto Alegre", uf: "RS", regionId: "r-cap", factor: 1.1, wait: 5 },
  { id: "s3", code: "L03", name: "Loja Serra", city: "Caxias do Sul", uf: "RS", regionId: "r-int", factor: 0.85, wait: 3 },
  { id: "s4", code: "L04", name: "Loja Litoral", city: "Capão da Canoa", uf: "RS", regionId: "r-int", factor: 0.75, wait: 2 },
];

// skill = probability of turning an attendance into a sale.
export const SALESPEOPLE = [
  { id: "p-ana", name: "Ana Souza", storeId: "s1", skill: 0.52, specialty: "Calçados" },
  { id: "p-bruno", name: "Bruno Reis", storeId: "s1", skill: 0.44, specialty: "Vestuário" },
  { id: "p-carla", name: "Carla Mendes", storeId: "s1", skill: 0.38, specialty: "Acessórios" },
  { id: "p-diego", name: "Diego Prado", storeId: "s2", skill: 0.49, specialty: "Calçados" },
  { id: "p-elisa", name: "Elisa Farias", storeId: "s2", skill: 0.55, specialty: "Vestuário" },
  { id: "p-fabio", name: "Fábio Nunes", storeId: "s2", skill: 0.33, specialty: "Calçados" },
  { id: "p-gabriela", name: "Gabriela Rocha", storeId: "s3", skill: 0.5, specialty: "Vestuário" },
  { id: "p-henrique", name: "Henrique Alves", storeId: "s3", skill: 0.42, specialty: "Calçados" },
  { id: "p-isabela", name: "Isabela Costa", storeId: "s3", skill: 0.46, specialty: "Acessórios" },
  { id: "p-joao", name: "João Pires", storeId: "s4", skill: 0.4, specialty: "Calçados" },
  { id: "p-karina", name: "Karina Melo", storeId: "s4", skill: 0.47, specialty: "Vestuário" },
  { id: "p-lucas", name: "Lucas Teixeira", storeId: "s4", skill: 0.31, specialty: "Vestuário" },
];

export const STORE_MANAGERS = {
  s1: "Marcos Lima",
  s2: "Patrícia Gomes",
  s3: "Rafael Moura",
  s4: "Sílvia Ramos",
};

const CATEGORY_PREFIX = { Calçados: "CAL", Vestuário: "VES", Acessórios: "ACE" };

// [name, variant, category, brand, price (cents), cost (cents), minimum stock]
const CATALOG = [
  ["Tênis Corrida Leve", "Nº 39", "Calçados", "Passo Firme", 38990, 19500, 4],
  ["Tênis Corrida Leve", "Nº 41", "Calçados", "Passo Firme", 38990, 19500, 4],
  ["Tênis Casual Couro", "Nº 40", "Calçados", "Urbe", 44990, 23800, 3],
  ["Sandália Rasteira", "Nº 36", "Calçados", "Brisa", 12990, 5400, 5],
  ["Sandália Rasteira", "Nº 37", "Calçados", "Brisa", 12990, 5400, 5],
  ["Bota Cano Curto", "Nº 37", "Calçados", "Nórdica", 52990, 27900, 2],
  ["Sapatilha Conforto", "Nº 35", "Calçados", "Brisa", 15990, 7200, 4],
  ["Chinelo Slide", "Nº 38", "Calçados", "Urbe", 8990, 3100, 6],
  ["Tênis Infantil Luz", "Nº 30", "Calçados", "Passo Firme", 22990, 11800, 3],
  ["Mocassim Clássico", "Nº 42", "Calçados", "Urbe", 34990, 17900, 2],
  ["Camiseta Algodão Básica", "M", "Vestuário", "Trama", 5990, 2100, 8],
  ["Camiseta Algodão Básica", "G", "Vestuário", "Trama", 5990, 2100, 8],
  ["Calça Jeans Reta", "40", "Vestuário", "Trama", 18990, 8600, 4],
  ["Jaqueta Corta-vento", "M", "Vestuário", "Nórdica", 32990, 16400, 3],
  ["Moletom Capuz", "G", "Vestuário", "Trama", 21990, 9900, 3],
  ["Vestido Midi Viscose", "P", "Vestuário", "Ateliê Sul", 24990, 11200, 3],
  ["Bermuda Sarja", "42", "Vestuário", "Trama", 13990, 6100, 3],
  ["Camisa Linho", "M", "Vestuário", "Ateliê Sul", 27990, 13300, 3],
  ["Meia Esportiva (kit 3)", "Único", "Vestuário", "Passo Firme", 3990, 1300, 10],
  ["Bolsa Transversal", "Único", "Acessórios", "Ateliê Sul", 19990, 8700, 3],
  ["Cinto Couro", "95 cm", "Acessórios", "Urbe", 11990, 4600, 3],
  ["Boné Aba Curva", "Único", "Acessórios", "Urbe", 8990, 3200, 4],
  ["Mochila Urbana 20 L", "Único", "Acessórios", "Nórdica", 29990, 14100, 2],
  ["Óculos de Sol Polarizado", "Único", "Acessórios", "Brisa", 25990, 9800, 2],
];

export const CATEGORIES = ["Calçados", "Vestuário", "Acessórios"];

export const PRODUCTS = CATALOG.map(([name, variant, category, brand, priceCents, costCents, minStock], index) => ({
  id: `prod-${index + 1}`,
  sku: `${CATEGORY_PREFIX[category]}-${String(index + 1).padStart(3, "0")}`,
  ean: ean13(`2000000${String(index + 1).padStart(5, "0")}`),
  name,
  variant,
  category,
  brand,
  priceCents,
  costCents,
  minStock,
}));

export const SUPPLIERS = {
  "Passo Firme": "Passo Firme Calçados Ltda. (fictícia)",
  Urbe: "Urbe Acessórios S.A. (fictícia)",
  Brisa: "Brisa Moda Praia Ltda. (fictícia)",
  Nórdica: "Nórdica Outdoor Ltda. (fictícia)",
  Trama: "Trama Têxtil Ltda. (fictícia)",
  "Ateliê Sul": "Ateliê Sul Confecções (fictícia)",
};

export const NO_SALE_REASONS = ["Numeração ou tamanho indisponível", "Preço", "Só pesquisando", "Não encontrou o modelo"];

// Internal procedures searched by the knowledge agent (fictitious company policy).
export const PROCEDURES = [
  {
    id: "doc-trocas",
    title: "Política de trocas e devoluções",
    updated: "2026-08-04",
    text: "Trocas em até 30 dias com etiqueta e comprovante. Defeito de fabricação: troca ou devolução do valor. Devolução por arrependimento só em compras fora da loja física (art. 49 do CDC). Na loja, a devolução gera vale-troca e é registrada no PDV com motivo.",
  },
  {
    id: "doc-caixa",
    title: "Abertura e fechamento de caixa",
    updated: "2026-07-20",
    text: "Abrir o caixa com fundo de troco de R$ 200,00. Sangria para o cofre quando o dinheiro passar de R$ 500,00, sempre com justificativa. No fechamento, contar o dinheiro e informar o valor contado; divergência acima de R$ 5,00 exige justificativa do gerente no mesmo dia.",
  },
  {
    id: "doc-desconto",
    title: "Descontos e autorizações",
    updated: "2026-09-02",
    text: "Vendedores e operadores concedem até 10% de desconto. Acima de 10% e até 15%, somente com autorização do gerente da loja registrada no PDV. Acima de 15% exige aprovação da diretoria comercial.",
  },
  {
    id: "doc-recebimento",
    title: "Recebimento de mercadorias",
    updated: "2026-06-15",
    text: "Conferir quantidade e numeração contra o pedido de compra antes de dar entrada. Divergências são registradas no recebimento e comunicadas ao fornecedor em até 48 horas. A entrada no estoque é feita somente após a conferência.",
  },
  {
    id: "doc-fila",
    title: "Lista da vez (fila de atendimento)",
    updated: "2026-05-30",
    text: "O próximo cliente vai para o vendedor disponível há mais tempo. Atendimento preferencial para idosos, gestantes e pessoas com deficiência (Lei 10.048/2000). Registrar o motivo quando o atendimento terminar sem venda; desistência é registrada pelo recepcionista.",
  },
];

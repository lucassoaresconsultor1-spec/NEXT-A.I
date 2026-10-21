# Contrato do módulo `m09-fiscal-interface` — v1

> Escrito pelo Arquiteto (Opus) em 22/10/2026. Risco: **SENSÍVEL** (fiscal, terceiros). Nível: **A** (Opus).
> **Ordem de migração: 8ª da fila A**, depois da do m07 integrada.
> Se algo estiver ambíguo, o agente PERGUNTA; não presume.

## 1. Objetivo
Camada fiscal **desacoplada** (porta `FiscalProvider`) com o registro de cada documento fiscal pedido para uma venda e seus estados (pendente, autorizado, rejeitado, cancelado, contingência), sem emitir nada: nenhum número, chave, protocolo ou autorização é gerado localmente (ADR-005). Sem provedor configurado, a venda segue com o comprovante não fiscal e o documento fica `not_configured`, visível.

## 2. Fora de escopo
Emissão real de NFC-e/NF-e, certificado digital, configuração tributária (CFOP, NCM, CST), DANFE, contingência real. Tudo isso é pendência do Lucas com provedor e validação profissional.

## 3. Allowlist
```
src/db/schema/fiscal.ts
src/db/schema/index.ts
drizzle/**
src/server/fiscal/port.ts
src/server/fiscal/registry.ts                (nenhum adaptador real; injeção só em testes)
src/server/fiscal/service.ts                 (requestFiscalDocument, refreshFiscalDocument, listFiscalDocuments, getFiscalDocumentForSale)
src/server/fiscal/schemas.ts
src/server/fiscal/schemas.test.ts
src/server/authz/permissions.ts
src/server/authz/system-roles.ts
src/server/audit/labels.ts
src/server/audit/service.ts
tests/integration/fiscal.test.ts
tests/support/fake-fiscal-provider.ts
docs/data-model.md
docs/security.md
```

## 4. Interface
```ts
// port.ts
export type FiscalStatus = "not_configured" | "pending" | "authorized" | "rejected" | "cancelled" | "contingency";
export interface FiscalProvider {
  readonly key: string;
  issue(input: { saleId: string; storeDocument: string; totalCents: number; items: { description: string; quantity: string; unitPriceCents: number; totalCents: number }[] }): Promise<{ providerReference: string; status: FiscalStatus }>;
  getStatus(providerReference: string): Promise<{ status: FiscalStatus; accessKey?: string; number?: string; series?: string; protocol?: string; rejectionReason?: string }>;
  cancel(providerReference: string, reason: string): Promise<{ status: FiscalStatus }>;
}
// service.ts
export async function requestFiscalDocument(context, saleId): Promise<{ id: string; status: FiscalStatus }>;  // sales.read ou o operador da venda; venda completed; um documento por venda (UNIQUE); sem provedor → not_configured
export async function refreshFiscalDocument(context, documentId): Promise<{ status: FiscalStatus }>;        // grava só o que o provedor devolveu
export async function getFiscalDocumentForSale(context, saleId);                                              // para o detalhe da venda e o comprovante
export async function listFiscalDocuments(context, filters);                                                  // fiscal.read; pendentes/rejeitados primeiro
```
Permissão nova `fiscal.read` ("Ver documentos fiscais das lojas do escopo") para Dono, Administrador, Financeiro e Gerente. Auditoria: `fiscal_document.requested`, `.status_changed`; entidade `fiscal_document`.

## 5. Dados (`fiscal.ts`)
```
fiscal_documents
  id, organization_id, store_id, sale_id, kind ('nfce'), status, provider varchar(40) NULL, provider_reference varchar(120) NULL,
  access_key varchar(44) NULL, number varchar(20) NULL, series varchar(5) NULL, protocol varchar(40) NULL,
  rejection_reason varchar(500) NULL, requested_by, timestamps
  UNIQUE (organization_id, id); UNIQUE (organization_id, sale_id, kind); FKs compostas stores, sales
  CHECK: authorized ⇒ access_key, number e protocol não nulos; not_configured ⇒ provider nulo
  tenantIsolationPolicy()
```
Custom: FORCE RLS.

## 6. Invariantes
Campos fiscais (chave, número, série, protocolo) **só** vêm do provedor; nunca são preenchidos por código local nem por teste fora do adaptador falso; o comprovante do PDV continua dizendo "Documento sem valor fiscal" enquanto o documento não estiver `authorized`.

## 7. Critérios de aceite
- [ ] Integração (`fiscal.test.ts`): sem provedor → `not_configured` e nenhum campo fiscal; com adaptador falso → pending → authorized por `refresh` com os campos do provedor; rejeitado guarda o motivo; um documento por venda (segunda chamada devolve o mesmo); venda suspensa ou de outra empresa → não encontrada; check do banco impede `authorized` sem chave; RLS por `withScope`.
- [ ] `lint`, `typecheck`, `lint:rules`, `test`, `build`; integração verde no gate; docs atualizados (`security.md`: nada fiscal é simulado).

## 8. Dependências
Nenhuma nova.

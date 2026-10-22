# Pendências do dono

> O que só o dono pode fazer (credencial, infraestrutura, decisão comercial ou jurídica). Tudo aqui está no repositório; nenhuma integração foi simulada. Variáveis vão no ambiente (Vercel), **nunca** no repositório.

## Implantação e banco
- [ ] **Banco Neon e papel da aplicação** — `docs/onboarding.md` ("Produção gratuita (Vercel + Neon)"). Variáveis: `DATABASE_URL` (papel `next_app`, sem `BYPASSRLS`, conexão com pool), `DATABASE_MIGRATION_URL` (dono do schema). Depende: todos os módulos.
- [ ] **Vercel** — importar o repositório; variáveis `DATABASE_URL`, `AUTH_SECRET` (32+ caracteres), `ALLOW_SIGNUP=false`, `LOG_LEVEL` (opcional). Plano Hobby não é para uso comercial (`docs/onboarding.md`).
- [ ] **Migrations em produção** — workflow manual `.github/workflows/database.yml`; segredos `DATABASE_MIGRATION_URL` e `PLATFORM_ADMIN_PASSWORD` (administrador da plataforma). 60 migrations em `drizzle/` (`0000` a `0059`).
- [ ] **Domínio** — necessário para a URL do webhook de pagamento (`https://<domínio>/api/pagamentos/webhook/<chave>`) e para o cookie `__Host-` em HTTPS.

## Backup (m41)
- [ ] Criar o papel `varejo_backup` (só leitura, `BYPASSRLS`) — SQL em `docs/backup.md`.
- [ ] Segredos `BACKUP_DATABASE_URL` e `BACKUP_PASSPHRASE` para `.github/workflows/backup.yml` e primeira execução manual.
- [ ] Decidir armazenamento externo (o artefato do GitHub guarda 30 dias) e alerta quando o job falhar.

## Integrações (porta pronta, sem adaptador; a tela mostra "pendente")
- [ ] **Pagamento (m07)** — escolher provedor e escrever o adaptador; `PAYMENT_PROVIDER=<chave>` + credenciais e segredo de webhook lidos pelo adaptador; cadastrar a URL do webhook no provedor (`docs/onboarding.md`). Dependem: Pix/cartão integrado no PDV (m06a), estorno no cancelamento (m08), conciliação (m37a, hoje `not_configured`).
- [ ] **Fiscal (m09)** — escolher emissor de NFC-e e escrever o adaptador; `FISCAL_PROVIDER=<chave>` + credenciais. Hoje o documento fica `not_configured` e o comprovante "sem valor fiscal". O cancelamento de venda ainda não aciona o cancelamento da nota (m08).
- [ ] **IA (m20)** — escolher provedor e modelo, escrever o adaptador e registrar fonte, data e termos em `docs/setup.md`; `AI_PROVIDER=<chave>` + credencial. Dependem: assistente (m21), especialistas e suas avaliações (m39, `ai.manage`), escritório virtual (m24a: tudo "indisponível" sem IA).
- [ ] **Limite mensal de IA por plano (m40)** — definir o valor comercial (`setPlanAiLimit`, administração da plataforma); hoje sem limite.
- [ ] **E-mail** — não há provedor nem porta de e-mail. Dependem: envio de relatórios agendados (m18, `delivery = pending`), avisos de alertas (m23a).
- [ ] **Monitoramento externo (m25)** — APM/rastreamento de erros; hoje só logs Pino e `ops_events`.

## Disparadores periódicos (funções prontas, sem agendador em produção)
- [ ] Relatórios agendados: chamar `runDueSchedules()` (`src/server/reports/schedules.ts`) periodicamente (rota/cron protegida por segredo, a criar no deploy).
- [ ] Alertas: chamar `runAlertEvaluation()` (`src/server/alerts/service.ts`) periodicamente; até lá, avaliação manual (`evaluateNow`).
- [ ] Limpezas: `import_rows` 30 dias após a importação (m19, contém dados pessoais) e retenções propostas em `docs/security.md` (sessões, `auth_rate_limits`, `auth_events`, `audit_logs`).

## Decisões de produto, comerciais e jurídicas
- [ ] **Feriados nacionais fixos** (`NATIONAL_FIXED_HOLIDAYS`, m01) — confirmação profissional antes de alimentar folha, metas e comissões (ADR-003). Feriados estaduais/municipais são cadastrados pela empresa (m32a).
- [ ] **Planos** — valores comerciais são hipóteses (`src/db/schema/structure.ts`); limites de lojas, membros e IA.
- [ ] **LGPD** (`docs/security.md`) — enquadramento formal e contrato de operador (jurídico); retenção a validar; fluxo de direitos do titular (acesso, correção, eliminação) e anonimização de clientes a pedido (ADR-017).
- [ ] **Devolução em dinheiro de venda paga só em cartão** — avaliar se deve seguir o meio original (`docs/DECISIONS.md`, m08).
- [ ] **Gerente cadastrar feriado da própria loja** — hoje só Dono/Admin (`settings.operations.manage`, m32a).
- [ ] **Operação sem internet** — PDV e fila exigem o servidor; offline foi registrado como não feito (m15). Pedir explicitamente se for necessário.

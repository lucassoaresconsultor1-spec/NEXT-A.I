# Segurança e isolamento multiempresa

Controles **implementados** na Fase 1 e o plano para as fases seguintes. Requisitos de produto em [PRODUCT.md](../PRODUCT.md); estrutura em [architecture.md](architecture.md).

## Modelo de ameaças considerado

- Usuário autenticado de uma empresa tentando ler/alterar dados de outra (troca de id na URL, requisição manual a Server Actions).
- Membro com escopo limitado tentando ver lojas/pessoas fora do escopo ou ampliar o próprio acesso.
- Gerente concedendo a si ou a outros um perfil superior.
- Força bruta e enumeração de contas no login.
- Vazamento de segredos e dados pessoais em logs, erros e respostas.
- Futuro: prompt injection contra o agente de IA e ferramentas com efeitos colaterais.

## Isolamento em camadas (implementado)

1. **Banco — RLS forçado.** Toda tabela com `organization_id` tem política `organization_id = current_setting('app.organization_id')` para leitura e escrita, e `FORCE ROW LEVEL SECURITY` (migration `0001`), de modo que nem o dono das tabelas escapa. Sem contexto, a consulta retorna **zero** linhas (falha fechada).
2. **Contexto por transação.** `withScope()` (`src/db/tenant.ts`) abre uma transação e define `app.organization_id`, `app.user_id` e `app.platform` com `set_config(..., true)`: o valor vale só para a transação e não vaza entre conexões do pool (há teste para isso).
3. **Integridade referencial por empresa.** Tabelas filhas referenciam `(organization_id, id)` do pai (FKs compostas): é impossível ligar uma loja a uma região de outra empresa ou dar a um vínculo uma loja alheia, mesmo com um bug no código.
4. **Serviços.** Cada função recebe o `TenantContext`, verifica a permissão (`assertCan`) e o escopo, e filtra `organization_id` explicitamente — defesa em profundidade caso o app seja conectado com um papel indevido.
5. **Páginas e ações.** Toda página chama `requireTenantContext()` (layouts não protegem páginas) e toda Server Action também; o menu esconde módulos sem permissão apenas por usabilidade.
6. **Respostas.** Registros de outra empresa ou fora do escopo respondem como inexistentes (404), sem revelar existência.

Exceções controladas: `organization_memberships` permite ao usuário ler **os próprios** vínculos em outras empresas (seletor de empresa); `organizations` é legível pela empresa ativa, pelos membros ativos e pelo contexto de plataforma. A plataforma (`app.platform = on`) **não** tem política nas tabelas comerciais — o administrador da plataforma não lê lojas, equipe ou auditoria dos clientes. Para contar uso (lojas/membros) numa troca de plano, o serviço da plataforma abre uma transação no contexto da empresa alvo só para obter as duas contagens.

Tabelas globais sem RLS: `users`, `sessions`, `auth_rate_limits`, `auth_events`, `plans`, `plan_features`. São acessadas apenas por `src/server/auth`, `src/server/plans` e junções a partir de vínculos já filtrados. **Endurecimento previsto (Fase 7):** RLS em `users` com funções `SECURITY DEFINER` específicas para o login.

### Papel do banco

A aplicação **deve** conectar com um papel sem `SUPERUSER` e sem `BYPASSRLS` (`DATABASE_URL`); migrations rodam como dono do schema (`DATABASE_MIGRATION_URL`). Superusuários ignoram RLS mesmo com `FORCE`. A suíte de integração recusa rodar se o papel da aplicação puder ignorar RLS. Exemplo local em `scripts/sql/local-database.sql`.

## Autorização e escopo (implementado)

- **Permissões** em catálogo de código (`permissions.ts`); perfis do sistema resolvem permissões pelo código (atualizam com o deploy), perfis personalizados guardam permissões em `role_permissions`.
- **Escopo de lojas** por vínculo: `all`, `regions` (lojas das regiões ligadas, recalculado a cada requisição) ou `stores`.
- **Hierarquia:** cada perfil tem nível; não-donos só gerenciam níveis estritamente inferiores e só concedem permissões que possuem — ao criar perfis e também ao **atribuir** um perfil a alguém (o perfil atribuído não pode carregar permissões que o ator não tem); só donos atribuem o perfil Dono; o Financeiro (nível 80) só é atribuído por dono ou administrador; ninguém altera o próprio acesso; a empresa nunca fica sem dono ativo.
- **Visibilidade de equipe:** quem tem acesso a todas as lojas vê todos os vínculos; os demais veem a si e os vínculos de lojas/regiões que alcançam lojas do seu escopo, e só gerenciam membros de "lojas específicas" totalmente dentro do seu escopo.
- **Mudanças estruturais** (criar loja, regiões, departamentos, dados da empresa, perfis) exigem acesso a todas as lojas.
- O contexto (vínculo, perfil, permissões, escopo, situação da empresa) é recarregado a cada requisição: suspensão de membro ou empresa vale imediatamente.

## Autenticação e sessão (implementado)

- Senhas com **scrypt** (`node:crypto`, N=2¹⁶, r=8, p=2, sal de 16 bytes; parâmetros gravados no hash para evolução), normalização Unicode NFKC, mínimo de 10 caracteres.
- Token de sessão de 256 bits; o banco guarda só o **SHA-256**. Expiração deslizante de 30 dias. Troca de senha encerra as outras sessões.
- Cookie `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção.
- **Limitação de tentativas** no PostgreSQL (vale entre instâncias), contada de forma atômica **antes** de verificar a senha (requisições simultâneas não escapam do limite) e devolvida em caso de sucesso, para contar só falhas: 5 falhas/15 min por par conta+IP, 30/15 min por conta (tentativas distribuídas), 50/15 min por IP, 10 cadastros/h por IP e 5 verificações de senha atual/15 min na troca de senha. Tentativas já bloqueadas no par conta+IP não contam para a conta: um terceiro que conhece o e-mail, a partir de um endereço, bloqueia apenas o próprio par, não o titular em outra rede (bloquear a conta exige várias origens, o que o limite por conta aceita como teto de tentativas distribuídas). Erro de login genérico e verificação com hash fictício para não revelar contas por tempo de resposta.
- **Contas e vínculo entre empresas:** sem prova de posse do e-mail, uma conta só pode ser adicionada pela empresa que a criou (`users.home_organization_id`: cadastro self-service ou criação de membro). Adicionar um e-mail que já tem conta de outra empresa é recusado. Isso impede o pré-sequestro de conta (empresa A cria a conta de `pessoa@x` com senha que conhece e a empresa B, ao adicionar `pessoa@x`, entregaria acesso a A). A redefinição de senha por administrador vale só para contas da própria empresa e é reconferida na transação de escrita. Pessoas em mais de uma empresa exigem convite com confirmação por e-mail (pendente de provedor).
- **Cadastro de empresa pela plataforma** (`createOrganization`): `is_platform_admin` e a situação do ator são reconferidos dentro da transação antes de validar ou gravar (não administrador recebe "proibido", mesmo com dados inválidos). O dono é sempre conta nova com senha provisória e troca obrigatória, pelo mesmo motivo do pré-sequestro; empresa, perfis, vínculo e auditoria (`organization.created`, com o administrador como responsável) são gravados na mesma transação. Em produção, `ALLOW_SIGNUP=false` deixa a criação de empresas só com a plataforma.
- **Redirecionamento após login** (`next`) aceita apenas caminhos do mesmo site; barras invertidas, caracteres de controle e `//` são recusados (`src/lib/safe-redirect.ts`).
- Eventos de autenticação guardam e-mail e IP apenas como **HMAC** com `AUTH_SECRET`.
- CSRF: Server Actions aceitam só `POST` e o Next.js compara `Origin` com `Host`; cookies `SameSite=Lax`. Atrás de proxy reverso com domínio diferente, configure `serverActions.allowedOrigins`.
- O IP vem de `X-Forwarded-For`/`X-Real-IP`: só é confiável quando o host sobrescreve esses cabeçalhos (Vercel e plataformas gerenciadas fazem). Em outro host, ajuste `src/server/http.ts`.
- `proxy.ts` faz só a checagem otimista (cookie presente) e renova a validade do cookie; a verificação real ocorre no servidor.

## Dados, erros e logs (implementado)

- Entradas validadas com Zod lendo apenas campos permitidos; consultas parametrizadas (Drizzle); busca com curingas `LIKE` escapados.
- Erros de domínio têm mensagens seguras; erros inesperados viram mensagem genérica e log estruturado sem stack/SQL para o cliente.
- Pino com redação de senha, token, cookie, autorização e URLs de banco; código de banco e logger marcados `server-only`.
- Auditoria imutável: políticas apenas de `SELECT`/`INSERT` em `audit_logs`; alterações e exclusões são negadas pelo banco.

## LGPD — aplicação atual e pendências

- **Minimização:** a Fase 1 trata nome e e-mail de usuários, CNPJ e contatos de lojas. Identificadores de autenticação ficam em HMAC.
- **Finalidade e base legal:** execução de contrato com a empresa cliente (operadora) — o enquadramento formal e o contrato de operador são **pendência jurídica**.
- **Retenção (proposta, a validar):** sessões expiradas removíveis após 30 dias; `auth_rate_limits` com janela expirada removível; `auth_events` 12 meses; `audit_logs` 5 anos. A rotina de limpeza agendada entra com a infraestrutura de tarefas (Fase 6/7).
- **Direitos do titular** (acesso, correção, eliminação) exigem fluxo administrativo: pendente.
- IA (Fase 5): enviar ao modelo apenas agregados e campos necessários, sem dados pessoais quando possível, conforme termos do provedor.

## Plano para as próximas fases

- **PDV/pagamentos:** idempotência por operação, transações envolvendo venda, pagamento e estoque, confirmação de pagamento apenas por webhook autenticado (assinatura verificada) ou consulta de status; nenhum dado de cartão armazenado; nenhuma repetição automática de operação financeira.
- **IA:** ferramentas com contrato, validação, autorização e limites; nenhum SQL gerado pelo modelo; conteúdo de documentos tratado como não confiável; operações sensíveis exigem confirmação explícita e permissão; limites de uso por organização. Ver [ai.md](ai.md).
- **Rate limiting geral** para APIs e IA, cabeçalhos de segurança/CSP, rotação de segredos, varredura de dependências no CI, testes de segurança adicionais por módulo.

## Revisão adversarial (16/10/2026)

Rodada com revisores independentes por dimensão (isolamento, escalada de privilégio, autenticação, integridade) e verificação cética. Corrigido nesta entrega: pré-sequestro de conta entre empresas (crítico), atribuição de perfil acima das próprias permissões, corrida e bloqueio indevido no limite de login, troca de senha sem limite, redirecionamento aberto com tab/barra invertida, TOCTOU na redefinição de senha, corrida entre exclusão de região e vínculo (FK agora `RESTRICT`), contagens do painel fora do escopo, auditoria sem referência ao registro e com valores crus. Segunda passada (skill `engineering:code-review`): tentativas já bloqueadas no par conta+IP ainda somavam no limite por conta, permitindo a um único endereço bloquear o titular — corrigido, com teste. Riscos aceitos/registrados: enumeração de e-mails no cadastro e ao adicionar membros (limitada a usuários autenticados/limite por IP), confiança em `X-Forwarded-For` dependente do host, nome real do administrador da plataforma visível na auditoria do cliente (transparência).

## Testes de segurança existentes

`tests/integration/dashboard.test.ts` (regressões da revisão: atribuição de perfil com permissões a mais, painel no escopo, FK de região), `tests/integration/members.test.ts` (inclui pré-sequestro de conta), `tests/integration/platform-provisioning.test.ts` (cadastro de empresa só por administrador ativo, sem gravação parcial), `tests/integration/tenant-isolation.test.ts` (RLS sem contexto, entre empresas, inserção/movimentação cruzada, FKs compostas, auditoria imutável, vínculos próprios, vazamento no pool), `tests/integration/auth.test.ts` (hash, sessão, erros genéricos, throttling, expiração, troca de senha) e os testes de cada módulo (permissão no serviço, escopo, isolamento por id). Como executar: [quality.md](quality.md).

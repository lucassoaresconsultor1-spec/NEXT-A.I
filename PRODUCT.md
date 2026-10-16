# Varejo Inteligente — plataforma SaaS de gestão para varejo

> Nome de trabalho. Fonte: "Prompt mestre — plataforma SaaS inteligente de gestão para varejo" (outubro de 2026). Este documento guarda escopo, regras e aceite; estrutura técnica fica em [docs/architecture.md](docs/architecture.md), o plano por fases em [docs/roadmap.md](docs/roadmap.md).

## Problema e objetivo

Empresas de varejo — de uma loja independente a redes com dezenas ou centenas de filiais — operam vendas, caixa, estoque, atendimento, metas e equipe em ferramentas separadas. Os dados operacionais existem, mas não viram decisão: o gestor não sabe com confiança onde agir hoje.

O produto centraliza a operação (PDV, caixa, estoque, fila de atendimento, metas e comissões) numa plataforma multiempresa e transforma esses dados em indicadores consistentes e em análises de um agente de IA que **só usa números calculados por serviços determinísticos**.

## Público e papéis

| Perfil | Escopo | O que faz |
|---|---|---|
| Administrador da plataforma | Plataforma | Gerencia empresas clientes, planos e situação; não acessa dados comerciais dos clientes |
| Proprietário / Administrador da empresa | Todas as lojas | Configura empresa, lojas, equipe, perfis, metas e regras |
| Gestor regional | Lojas das regiões autorizadas | Compara lojas, acompanha metas, estoque e equipe |
| Gerente de loja | Lojas autorizadas | Gerencia equipe (níveis inferiores), caixa, estoque e atendimento |
| Supervisor | Lojas autorizadas | Monitora equipe, fila e indicadores |
| Vendedor | Própria loja | Vê o próprio desempenho, metas, comissões estimadas e atendimentos |
| Operador de caixa | Própria loja | Opera o PDV e o próprio caixa |

Permissões são granulares (catálogo em `src/server/authz/permissions.ts`), verificadas no servidor em toda consulta e operação, e combinadas com o **escopo de lojas** do vínculo (todas, regiões ou lojas específicas). Perfis personalizados são permitidos, sempre abaixo do nível de quem os cria.

## Fluxos da versão inicial (Fase 1 — fundação)

1. **Criar conta da empresa:** nome da empresa, CNPJ opcional, dados do proprietário → empresa no plano Essencial, perfis do sistema criados, proprietário com acesso a todas as lojas, sessão aberta.
2. **Entrar e escolher empresa:** e-mail e senha → painel da empresa (ou seletor, se houver mais de uma; ou troca de senha obrigatória, se provisória).
3. **Estruturar a empresa:** cadastrar regiões, lojas (código, CNPJ, contato, endereço, fuso) e departamentos.
4. **Montar a equipe:** adicionar membro com perfil e escopo (todas as lojas, regiões ou lojas específicas), senha provisória para e-mails novos; suspender, remover, redefinir senha provisória. E-mail que já tem conta criada por outra empresa é recusado até existir convite com confirmação por e-mail.
5. **Governar o acesso:** consultar a matriz de permissões, criar perfis personalizados, auditar alterações.
6. **Administrar a plataforma:** listar empresas, alterar plano, suspender/reativar.

## MVP

Ordem de entrega (detalhe e critérios em [docs/roadmap.md](docs/roadmap.md)):

1. **Fase 1 — Fundação:** autenticação, multiempresa com isolamento no banco, permissões, layout corporativo, cadastros de estrutura e equipe, auditoria, planos e limites. *(implementada nesta entrega)*
2. **Fase 2 — Núcleo comercial:** produtos, categorias, estoque por livro de movimentações, PDV, pagamentos por adaptadores, caixa, histórico de vendas.
3. **Fase 3 — Pessoas e atendimento:** vendedores, metas, comissões versionadas, fila e registro de atendimento ligado à venda.
4. **Fase 4 — BI e relatórios:** indicadores compartilhados, dashboards por perfil, relatórios e exportação.
5. **Fase 5 — IA:** interface conversacional, adaptador de modelo, ferramentas autorizadas, relatórios gerados com dados reais.
6. **Fase 6 — Multiagente:** especialistas, alertas, recomendações e central de tarefas.
7. **Fase 7 — Robustez e comercialização:** segurança, desempenho, observabilidade, backup, integrações fiscais.

## Fora de escopo nesta entrega

- Qualquer módulo das Fases 2–7 (vendas, PDV, estoque, fila, metas, relatórios, IA). O painel mostra apenas dados estruturais reais e declara que os indicadores comerciais chegam com seus módulos.
- E-mail transacional (convites, recuperação de senha por link): depende de provedor. Enquanto isso, administradores definem senha provisória e o usuário troca no primeiro acesso.
- Cobrança e troca de plano self-service: planos são alterados pelo administrador da plataforma.
- Exclusão definitiva de lojas: lojas são desativadas, porque terão histórico de vendas.

## Requisitos

**Multiempresa:** toda entidade comercial tem `organization_id`; isolamento por RLS forçado no PostgreSQL, chaves estrangeiras compostas e filtros explícitos nos serviços. Nenhuma consulta de uma empresa retorna dados de outra; registros fora do escopo respondem como inexistentes.

**Acesso:** autorização no servidor em toda página, ação e serviço; ocultar botões não é controle. Um membro só gerencia perfis de nível inferior, só concede lojas do próprio escopo e não altera o próprio acesso; a empresa nunca fica sem proprietário ativo.

**Auditoria:** toda alteração de estrutura, equipe, perfis, empresa e plano grava trilha imutável (somente inserção e leitura) com responsável e campos alterados.

**Idioma e formatos:** interface em português do Brasil; moeda BRL, datas `dd/mm/aaaa`, telefone com DDD, CNPJ (inclusive alfanumérico, IN RFB 2.229/2024), CPF e CEP. Fuso padrão `America/Sao_Paulo`, configurável por empresa e loja.

**Dinheiro:** valores monetários em centavos inteiros (sem ponto flutuante binário). Formatação em `src/lib/format.ts`.

**Interface:** visual corporativo (sidebar azul-marinho, destaque azul, verde/vermelho/âmbar para estados), tabelas com filtro, ordenação e paginação no servidor, estados de vazio, carregamento e erro, modais acessíveis, responsivo de celular a desktop. O PDV terá interface própria, orientada a teclado e leitor de código de barras (Fase 2).

**Segurança e LGPD:** senhas com scrypt, sessões com token aleatório guardado só como hash, cookies `HttpOnly`/`Secure`/`SameSite=Lax` com prefixo `__Host-` em produção, limitação de tentativas no banco, e-mail/IP de eventos de autenticação guardados como HMAC, logs sem segredos. Detalhes em [docs/security.md](docs/security.md).

**IA (fases 5–6):** o modelo nunca inventa ou calcula indicadores críticos; números vêm de ferramentas do backend com validação, autorização e auditoria; o agente não amplia permissões. Plano em [docs/ai.md](docs/ai.md).

## Restrições e decisões técnicas

- Next.js 16.4 (App Router), React 19.3, TypeScript strict, Tailwind 4, pnpm 10, Node.js ≥ 22.12.
- Drizzle ORM 0.45 + PostgreSQL (driver `pg`), migrations versionadas em `drizzle/`. Monólito modular; sem microsserviços até haver justificativa.
- Autenticação própria com sessões no banco (sem biblioteca externa): controle total do vínculo sessão → empresa → escopo, que é o centro do isolamento. Revisar se surgirem SSO/2FA como requisito.
- A aplicação conecta com um papel **sem** `SUPERUSER`/`BYPASSRLS`; migrations rodam com o dono do schema.

## Hipóteses e pendências

| Item | Tipo | Impacto | Próximo passo |
|---|---|---|---|
| Planos Essencial/Profissional/Inteligência/Rede, limites (1 loja nos três primeiros; 10/30/30 membros) e recursos por plano | Hipótese comercial reversível (migration `0002`) | Bloqueia criação acima do limite | Validar com o comercial; alterar por nova migration |
| Preços | Pendente (não definido) | Nenhum na Fase 1 | Decisão comercial antes de cobrança |
| Provedor de e-mail | Pendente externo | Convites, recuperação de senha por link e pessoas em mais de uma empresa (hoje recusado por segurança) | Escolher provedor e domínio; credenciais por variável de ambiente; implementar convite com confirmação |
| Provedores de pagamento (PIX/cartão) e emissão fiscal (NFC-e/NF-e) | Pendente externo | Fase 2 | Escolher provedores; homologação, certificado e configuração tributária validados por profissional |
| Provedor de IA e política de dados enviados ao modelo | Pendente externo | Fase 5 | Verificar documentação/termos do provedor; credenciais só no servidor |
| Hospedagem e PostgreSQL gerenciado | Pendente externo | Produção | Escolher host; criar papel de aplicação sem BYPASSRLS |
| Operação offline do PDV | Hipótese de arquitetura | Fase 2+ | Avaliar após PDV online testado; não declarar offline antes de testes |

## Critérios de aceitação

**Produto (Fase 1)**

- Uma empresa criada pelo cadastro tem perfis do sistema, proprietário com acesso total e plano Essencial; o proprietário entra e vê o painel.
- Usuário de uma empresa não consegue ler nem alterar dados de outra por URL, id ou requisição manual (verificado por testes de integração no banco real).
- Membro com escopo de lojas só vê e gerencia lojas e pessoas do próprio escopo; vendedor não acessa equipe nem estrutura.
- Gerente de loja não concede perfis de nível igual/superior nem lojas fora do escopo; ninguém altera o próprio acesso; o último proprietário não pode ser rebaixado, suspenso ou removido.
- Limites do plano bloqueiam lojas e membros excedentes com mensagem clara.
- Toda alteração aparece na auditoria com data no fuso da empresa e responsável.
- Administrador da plataforma altera plano e suspende empresas; empresa suspensa perde acesso imediatamente; a plataforma não lê lojas nem equipe dos clientes.
- Interface em pt-BR, utilizável no celular, com estados de vazio, erro e carregamento.

**Técnicos:** ver [docs/quality.md](docs/quality.md) e evidências em [docs/setup.md](docs/setup.md).

## Próxima entrega

Fase 2, primeiro incremento: **catálogo de produtos e categorias com estoque por livro de movimentações** (entradas, ajustes e saldo por loja), base para o PDV. Critério: cadastrar produto com SKU/código de barras e variações, lançar entrada numa loja e ver o saldo calculado pelo livro, com isolamento e auditoria testados.

## Manutenção

Atualize este documento quando objetivo, escopo, restrições ou critérios de aceitação mudarem. Decisões técnicas e evidências detalhadas ficam em docs/architecture.md e docs/setup.md. O nome do arquivo gerado é PRODUCT.md.

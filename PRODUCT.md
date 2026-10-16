# NEXT A.I — plataforma SaaS de gestão para varejo

> Nome do sistema escolhido pelo usuário (antes "Varejo Inteligente", nome de trabalho); identidade visual em [brand/next-ai/](brand/next-ai/README.md). Fontes: "Prompt mestre — plataforma SaaS inteligente de gestão para varejo" e "Documento mestre do produto — PRD + especificação técnica" (outubro de 2026), que acrescenta o Escritório Virtual 2D de agentes. Este documento guarda escopo, regras e aceite; estrutura técnica fica em [docs/architecture.md](docs/architecture.md), o plano por fases em [docs/roadmap.md](docs/roadmap.md).

## Problema e objetivo

Empresas de varejo — de uma loja independente a redes com dezenas ou centenas de filiais — operam vendas, caixa, estoque, atendimento, metas e equipe em ferramentas separadas. Os dados operacionais existem, mas não viram decisão: o gestor não sabe com confiança onde agir hoje.

O produto centraliza a operação (PDV, caixa, estoque, fila de atendimento, metas e comissões) numa plataforma multiempresa e transforma esses dados em indicadores consistentes e em análises de um agente de IA que **só usa números calculados por serviços determinísticos**. O diferencial é ligar dados, análise e execução: recomendações viram tarefas acompanháveis, e um **Escritório Virtual 2D** mostra o trabalho real dos agentes ([docs/virtual-office.md](docs/virtual-office.md)).

## Público e papéis

| Perfil | Escopo | O que faz |
|---|---|---|
| Administrador da plataforma | Plataforma | Acesso geral do desenvolvedor/operador: cadastra empresas clientes e o acesso do dono, altera plano e situação; não acessa dados comerciais dos clientes |
| Dono / Administrador da empresa | Todas as lojas | Acesso completo a lojas, indicadores, configurações, equipe, perfis, metas, regras e relatórios autorizados |
| Coordenador | Lojas das regiões ou lojas autorizadas | Visão consolidada da operação: compara as lojas do escopo e acompanha metas e equipes, conforme as permissões atribuídas |
| Financeiro | Lojas autorizadas | Faturamento, recebimentos, conciliação, fechamento de caixa, despesas e relatórios financeiros, sem as configurações operacionais |
| Gerente de loja | Própria loja | Equipe (níveis inferiores), vendas, fila, estoque, caixa e indicadores locais |
| Supervisor | Lojas autorizadas | Monitora equipe, fila e indicadores |
| Vendedor | Própria loja | Por padrão, só os próprios dados: desempenho, metas, comissões estimadas e atendimentos atribuídos |
| Operador de caixa | Própria loja | Opera o PDV e o próprio caixa |

O perfil Financeiro existe desde a Fase 1 com leitura da empresa, lojas e regiões; as permissões financeiras (faturamento, recebimentos, conciliação, caixa, despesas, relatórios) entram no catálogo junto dos módulos que as implementam (Fases 2 e 4). Só dono e administrador atribuem o Financeiro (nível acima do coordenador). Diretor comercial e responsável por estoque seguem como perfis personalizados até seus módulos.

Permissões são granulares (catálogo em `src/server/authz/permissions.ts`), verificadas no servidor em toda consulta e operação, e combinadas com o **escopo de lojas** do vínculo (todas, regiões ou lojas específicas). Perfis personalizados são permitidos, sempre abaixo do nível de quem os cria.

## Experiências e regras de acesso

Uma plataforma central (um app, um banco e os serviços compartilhados de `src/server/`) atende quatro experiências e a administração da plataforma. O que cada pessoa vê depende do perfil, do escopo de lojas e do aparelho; a autorização é sempre do servidor.

| Experiência | Quem usa | Aparelho prioritário | Fase |
|---|---|---|---|
| Gestão (painel e dashboards) | Dono, coordenador, financeiro, gerente, supervisor | Desktop e celular (responsivo) | 1 (estrutura) · 4 (indicadores) |
| App do vendedor | Vendedor | Celular | 3 |
| Fila e vez | Entrada da loja (tablet), gerente | Tablet e celular | 3 |
| PDV | Operador de caixa | Desktop do caixa | 2 |
| Administração da plataforma | Desenvolvedor/operador da plataforma | Desktop | 1 |

- **Distribuição:** aplicação web responsiva instalável (PWA) no início, sem desenvolver dois apps nativos.
- **Vendedor:** vê os próprios dados por padrão. Dados de colegas, comissões de terceiros e relatórios gerenciais dependem de permissão específica.
- **Fila:** o gerente acompanha toda a fila da loja; o vendedor vê os atendimentos atribuídos a ele e os dados adicionais autorizados. A fila se integra ao app do vendedor, ao PDV e ao dashboard sem cadastros duplicados: atendimento, venda e vendedor são os mesmos registros.
- **Coordenação:** compara as lojas às quais tem acesso, inclusive desempenho entre períodos (Fase 4).
- **Indicadores consistentes:** metas, comissões, app e dashboard leem os mesmos serviços de métricas; o faturamento segue a mesma regra de cálculo em todos os canais.
- **Estoque, compras e fornecedores:** módulo próprio na evolução do produto; a estrutura (fornecedores, livro de estoque) nasce na Fase 2 para não exigir reconstrução.
- **IA e Escritório Virtual 2D:** entram sobre os mesmos serviços, sem reconstruir os módulos existentes.

## Fluxos da versão inicial (Fase 1 — fundação)

1. **Cadastrar a empresa:** pelo administrador da plataforma em `/plataforma/nova-empresa` (empresa, CNPJ opcional, plano, nome, e-mail e senha provisória do dono) ou pelo cadastro público `/criar-conta` (plano Essencial; desligável com `ALLOW_SIGNUP=false`) → perfis do sistema criados, dono com acesso a todas as lojas. O dono cadastrado pela plataforma troca a senha no primeiro acesso.
2. **Entrar e escolher empresa:** e-mail e senha → painel da empresa (ou seletor, se houver mais de uma; ou troca de senha obrigatória, se provisória).
3. **Estruturar a empresa:** cadastrar regiões, lojas (código, CNPJ, contato, endereço, fuso) e departamentos.
4. **Montar a equipe:** adicionar membro com perfil e escopo (todas as lojas, regiões ou lojas específicas), senha provisória para e-mails novos; suspender, remover, redefinir senha provisória. E-mail que já tem conta criada por outra empresa é recusado até existir convite com confirmação por e-mail.
5. **Governar o acesso:** consultar a matriz de permissões, criar perfis personalizados, auditar alterações.
6. **Administrar a plataforma:** cadastrar empresa com o acesso do dono, listar empresas, alterar plano, suspender/reativar. O primeiro administrador é criado por `pnpm platform:admin <email>` ([docs/onboarding.md](docs/onboarding.md#desenvolver)).

## MVP

Ordem de entrega (detalhe e critérios em [docs/roadmap.md](docs/roadmap.md)):

1. **Fase 1 — Fundação:** autenticação, multiempresa com isolamento no banco, permissões, layout corporativo, cadastros de estrutura e equipe, auditoria, planos e limites. *(implementada nesta entrega)*
2. **Fase 2 — Núcleo comercial:** produtos, categorias, estoque por livro de movimentações, PDV, pagamentos por adaptadores, caixa, histórico de vendas.
3. **Fase 3 — Pessoas e atendimento:** vendedores, metas, comissões versionadas, fila e registro de atendimento ligado à venda.
4. **Fase 4 — BI e relatórios:** indicadores compartilhados, dashboards por perfil, relatórios e exportação.
5. **Fase 5 — IA:** interface conversacional, adaptador de modelo, ferramentas autorizadas, relatórios gerados com dados reais.
6. **Fase 6 — Multiagente:** especialistas, alertas, recomendações e central de tarefas.
7. **Fase 7 — Escritório Virtual 2D:** salas, personagens e estados ligados às execuções reais dos agentes, com visão em lista acessível.
8. **Fase 8 — Robustez e comercialização:** segurança, desempenho, observabilidade, backup, integrações fiscais.

**Demonstração:** a pasta `demo/` tem uma página interativa com dados **fictícios** que antecipa as Fases 2–7 para validação de telas e apresentação ([demo/README.md](demo/README.md)). É separada do produto, não usa o banco e não conta como módulo entregue.

## Fora de escopo nesta entrega

- Qualquer módulo das Fases 2–8 no produto (vendas, PDV, estoque, fila, metas, relatórios, IA, escritório virtual); existem apenas como protótipo na demonstração fictícia. O painel do produto mostra apenas dados estruturais reais e declara que os indicadores comerciais chegam com seus módulos.
- E-mail transacional (convites, recuperação de senha por link): depende de provedor. Enquanto isso, administradores definem senha provisória e o usuário troca no primeiro acesso.
- Cobrança e troca de plano self-service: planos são alterados pelo administrador da plataforma.
- Exclusão definitiva de lojas: lojas são desativadas, porque terão histórico de vendas.

## Requisitos

**Multiempresa:** toda entidade comercial tem `organization_id`; isolamento por RLS forçado no PostgreSQL, chaves estrangeiras compostas e filtros explícitos nos serviços. Nenhuma consulta de uma empresa retorna dados de outra; registros fora do escopo respondem como inexistentes.

**Acesso:** autorização no servidor em toda página, ação e serviço; ocultar botões não é controle. Um membro só gerencia perfis de nível inferior, só concede lojas do próprio escopo e não altera o próprio acesso; a empresa nunca fica sem dono ativo.

**Auditoria:** toda alteração de estrutura, equipe, perfis, empresa e plano grava trilha imutável (somente inserção e leitura) com responsável e campos alterados.

**Idioma e formatos:** interface em português do Brasil; moeda BRL, datas `dd/mm/aaaa`, telefone com DDD, CNPJ (inclusive alfanumérico, IN RFB 2.229/2024), CPF e CEP. Fuso padrão `America/Sao_Paulo`, configurável por empresa e loja.

**Dinheiro:** valores monetários em centavos inteiros (sem ponto flutuante binário). Formatação em `src/lib/format.ts`.

**Interface:** identidade NEXT A.I (sidebar verde-floresta, destaque lima, verde/vermelho/âmbar para estados), tabelas com filtro, ordenação e paginação no servidor, estados de vazio, carregamento e erro, modais acessíveis, responsivo de celular a desktop. O PDV terá interface própria, orientada a teclado e leitor de código de barras (Fase 2).

**Segurança e LGPD:** senhas com scrypt, sessões com token aleatório guardado só como hash, cookies `HttpOnly`/`Secure`/`SameSite=Lax` com prefixo `__Host-` em produção, limitação de tentativas no banco, e-mail/IP de eventos de autenticação guardados como HMAC, logs sem segredos. Detalhes em [docs/security.md](docs/security.md).

**Operação (PDV, pagamentos e fila):** nenhuma venda ou pagamento duplicado (idempotência por finalização); cada venda, atendimento e movimentação tem identificação, responsável e histórico, com trilha de auditoria; falhas de conexão e de impressão são tratadas sem perder a operação (estado pendente visível, reimpressão); cancelamentos e descontos dependem de permissão; o PDV não depende da IA para vender; contingência e operação offline só se forem necessárias ao negócio, e só declaradas depois de testadas. Emissão fiscal e pagamentos exigem planejamento próprio (provedor, homologação, certificado) e não são tratados como impressão. Pagamentos, documentos fiscais e impressoras são testados no ambiente previsto de uso.

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
| Metas numéricas de sucesso (tempo de relatório, conversão, ticket, divergência de caixa) | Pendente: sem linha de base | Medição de valor | Definir valores iniciais após testes com empresas-piloto |

## Critérios de aceitação

**Produto (Fase 1)**

- Uma empresa criada pelo cadastro tem perfis do sistema, dono com acesso total e plano Essencial; o dono entra e vê o painel.
- O administrador da plataforma cadastra empresa e dono com o plano escolhido; o dono entra com a senha provisória, troca no primeiro acesso e vê o painel; e-mail já cadastrado e CNPJ repetido são recusados sem gravar nada.
- Usuário de uma empresa não consegue ler nem alterar dados de outra por URL, id ou requisição manual (verificado por testes de integração no banco real).
- Membro com escopo de lojas só vê e gerencia lojas e pessoas do próprio escopo; vendedor não acessa equipe nem estrutura.
- Gerente de loja não concede perfis de nível igual/superior nem lojas fora do escopo; ninguém altera o próprio acesso; o último dono não pode ser rebaixado, suspenso ou removido.
- Limites do plano bloqueiam lojas e membros excedentes com mensagem clara.
- Toda alteração aparece na auditoria com data no fuso da empresa e responsável.
- Administrador da plataforma altera plano e suspende empresas; empresa suspensa perde acesso imediatamente; a plataforma não lê lojas nem equipe dos clientes.
- Interface em pt-BR, utilizável no celular, com estados de vazio, erro e carregamento.

**Técnicos:** ver [docs/quality.md](docs/quality.md) e evidências em [docs/setup.md](docs/setup.md).

## Próxima entrega

Fase 2, primeiro incremento: **catálogo de produtos e categorias com estoque por livro de movimentações** (entradas, ajustes e saldo por loja), base para o PDV. Critério: cadastrar produto com SKU/código de barras e variações, lançar entrada numa loja e ver o saldo calculado pelo livro, com isolamento e auditoria testados.

## Manutenção

Atualize este documento quando objetivo, escopo, restrições ou critérios de aceitação mudarem. Decisões técnicas e evidências detalhadas ficam em docs/architecture.md e docs/setup.md. O nome do arquivo gerado é PRODUCT.md.

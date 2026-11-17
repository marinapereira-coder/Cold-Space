# Benchmarking visual e funcional — Bacio Conecta
**Data:** 17/11/2026 · **Situação:** diagnóstico e proposta, sem alteração de produção  
**Referências:** vídeo de navegação fornecido em 17/11/2026 (Portal Tutte le Operazioni e Uni Bacio) + código da branch `main` e [Banco de Regras](BANCO_DE_REGRAS_BACIO_CONECTA.md).

## 1. Objetivo e limites

Aprimorar o Conecta como central de trabalho para lojas, consultores, regionais e administração, inspirando-se na identidade e organização dos dois portais, **sem copiar seus fluxos** ou criar sistemas paralelos. O presente documento **não autoriza deploy nem modifica regras de negócio**.

Critérios obrigatórios: preservar dados, permissões de servidor, autenticação, histórico, chat em duas abas, notificações, comunicados com confirmação explícita de leitura, avaliações, importações, aprovações, SLAs, destinatários e atualização sem F5 (BR-001 a BR-010, BR-049 a BR-061). Alterações em UI não devem reclassificar um comunicado como demanda, nem produzir novas notificações.

## 2. Referências observadas no vídeo

| Referência | Evidência visual observada | Aprendizado aplicável | Limitação |
|---|---|---|---|
| Portal **Tutte le Operazioni** | Faixa marrom/creme, banners editoriais, menu horizontal, seções de CIAO!, RH, Datas Importantes e recursos operacionais | Identidade visual corporativa, categorização por área e catálogo de recursos | Calendário visível de outubro de 2026 em uma gravação de 17/11/2026: evitar depender de imagens periódicas trocadas manualmente |
| **Uni Bacio** | Menu lateral, quadro inicial personalizado, cartões de aprendizagem, certificações, “Continuar Aprendendo”, banners de treinamento e assistente de suporte | Ações prioritárias no início, continuidade de tarefas, conteúdo organizado e auxílio contextual | Não é evidência de que o chatbot possa ser integrado ao Conecta, nem de desempenho, API, segurança ou acesso ao conteúdo interno |

O vídeo demonstra navegação em desktop. **Não foram medidos** tempos de resposta, acessibilidade, usabilidade mobile, permissões internas nem integração técnica entre plataformas.

## 3. Situação real identificada no repositório

| Área do Conecta | Evidência no código | Decisão para não duplicar trabalho |
|---|---|---|
| **Menu lateral / perfis** | `Index.html` contém 13 entradas nas seções Meu dia, Operação e Gestão; SVGs semânticos; `Scripts.html` valida capacidades/roles; regras BR-049/050 | **Preservar.** Ajustar legibilidade e responsividade pontualmente, após testes por perfil |
| **Modo claro/escuro** | `Scripts.html` usa preferência `bacio-theme`; `Styles.html` possui variantes `body.dark-mode`; BR-058 já disciplina legibilidade | **Auditar visualmente**, não recriar o seletor ou trocar variáveis globais às cegas |
| **Minha Área** | `Index.html` tem resumo, prioridades, campanhas e comunicados; `renderHome()` exibe 4 métricas, até 4 tarefas, 2 campanhas e 3 avisos | Evoluir a **hierarquia e acessos rápidos**; manter origem dos números e público autorizado |
| **Central de Operações** | `Index.html` já tem busca, atalhos e 8 departamentos; `Scripts.html` mantém `CENTRAL_LINKS_CATALOG` com **94 links** e filtros por área | Não duplicar a Central; revisar pertinência, disponibilidade e categorização do catálogo |
| **Uni Bacio** | Cartão rápido "UniBacio" existe; item `UNIBACIO` do catálogo aponta para recurso no Google Drive, enquanto outro item de e-book aponta para Uni Bacio | **Validar com os responsáveis** qual acesso oficial deve ser destacado; não substituir links existentes sem teste |
| **Datas e novidades da Central** | Os painéis `Novidades da Central` e `Datas importantes` em `Index.html` apresentam textos fixos (por exemplo, workshop e campanha promocional) | Candidato relevante a conexão com eventos/comunicados já autorizados; **não usar títulos inventados** como informação operacional vigente |
| **Agenda / Calendário / Cronograma** | Módulos existentes em `Index.html`, `Scripts.html` e `Cronograma.html`; BR-058/059 regulam prazos e fuso | Aproveitar eventos reais existentes; não criar agenda paralela |
| **FAQ / chat** | `FAQ.html` e BR-059 definem FAQ local dentro do chat; BR-003 e contrato de chat V2 | Melhorar orientação e busca no FAQ; **assistente de IA é ideia futura, não implantação autorizada** |

**Tokens visuais atuais:** `Styles.html` declara `--cream:#f8f5f0`, `--paper:#fffdf9` e `--brown:#65483c`. A paleta oficial de referência Bacio inclui off-white `#FFF3E6` e marrom `#4F2B1F`. A eventual harmonização requer teste de contraste e revisão de dependências dos tokens, especialmente porque `--brown` passa a representar texto claro no tema escuro. **Não aplicar substituição global automática**.

## 4. Backlog recomendado, ordenado

### P0 — Primeira entrega: auditoria e refinamento visual controlado
- Revisar telas **Minha Área, Central de Operações, Comunicados, Chat, Calendário, Cronograma, Detalhe de demanda, Respostas, Usuários & Acessos e modais** em claro/escuro.
- Validar legibilidade (texto auxiliar ≥12px conforme BR-058), hover/foco/seleção, truncamentos, scroll do menu e tabelas, sem vazamento de estilos entre páginas.
- Checar desktop, notebook e largura móvel (por exemplo 360/390 px), sem reduzir fontes para caber.
- Introduzir correções CSS **isoladas e verificáveis**, sem alterar HTML de formulários, regras ou APIs.

**Aceite:** nenhuma seção encoberta; ações críticas visíveis; contraste de texto suficiente; troca de tema preserva preferência; perfis e dados permanecem idênticos.

### P1 — Minha Área orientada a tarefas, sem reimplementar o dashboard
- Reorganizar os 4 KPIs existentes por relevância e mostrar ações pendentes com CTA claro.
- Avaliar um bloco pequeno de **atalhos úteis** (Central, Calendário, Comunicados, Uni Bacio), usando navegação atual e permissões existentes.
- Não duplicar cards ou criar KPI sem definição e dados reais.

**Aceite:** loja abre seus itens sem enxergar informações da gestão; admin mantém suas opções; cada atalho funciona sem abrir tela não autorizada.

### P1 — Central viva e catálogo confiável
- Levantar, com dono por departamento, quais dos **94 links** são atuais, redundantes, quebrados ou restritos. Manter os originais até validação.
- Separar os painéis estáticos de “Novidades” e “Datas importantes” de informações oficiais: após especificação, usar fontes existentes autorizadas com data/tipo e estado vazio quando não houver evento.
- Avaliar filtros/favoritos por perfil **somente depois** de mapear regras de permissão e persistência.

**Aceite:** não exibir exemplos como eventos reais; nenhum novo vazamento de links restritos; fontes e atualização explícitas.

### P2 — Integração com aprendizagem e suporte
- Destacar acesso verificado da Uni Bacio e materiais de treinamento, sem copiar conteúdo protegido.
- Expandir FAQ de uso da plataforma e encaminhar dúvidas ao suporte adequado.
- Assistente conversacional somente em projeto posterior, com validação da base de conhecimento, privacidade, custos e fallback humano.

## 5. Matriz de regressão obrigatória antes de qualquer publicação

| Perfil/cenário | Itens a validar |
|---|---|
| **Loja** | Central de Solicitações restrita; confirmação de leitura de comunicado separada do sininho; chat Lojas/ADM; planilha sem criação de linhas/colunas; atualização sem F5 |
| **Consultor** | Destinatários/permissões e cronograma previstos; sem acesso a lojas fora do escopo; sem simular entrega direta com publicação para lojas |
| **Regional** | Visibilidade consolidada somente das lojas sob responsabilidade; pesquisa e cronograma compatíveis |
| **Administrador** | `Usuários & Acessos`, relatórios, exclusão lógica e controles de publicação preservados; notificações abrem resposta exata |
| **Segurança e homologação** | `TESTE_CONECTA` isolada; não enviar e-mail real; não alterar `bacio_usuarios`/papéis, `bacio_lojas`, histórico ou RLS |
| **UI** | Claro/escuro, 13 ícones, menu rolável, modais, notebook, celular, navegação teclado, sem texto invisível |

**Gate técnico:** executar `node .github/scripts/verify-conecta.cjs` e `node .github/scripts/verify-access-invitations.cjs` em branch separada, inspecionar workflows de PR. Para publicar, somente após aprovação expressa, merge na `main` e confirmação do workflow `Sync to Google Apps Script` até criação de versão e atualização do deployment. **Passagem em CI não comprova teste manual de tela**.

## 6. Status desta etapa

- [x] Repositório correto identificado: `marinapereira-coder/Cold-Space`.
- [x] `AGENTS.md`, Banco de Regras, `Index.html`, `Scripts.html`, `Styles.html` e workflows analisados.
- [x] Vídeo das duas referências inspecionado.
- [x] Backlog sem duplicação de módulos elaborado.
- [ ] Conferência manual da **interface atual** com logins autorizados de loja, consultor, regional e administrador.
- [ ] Aprovação do primeiro conjunto de alterações visuais antes de implementar.
- [ ] Homologação, testes e eventual publicação — **não executados**.

> Este documento é somente especificação/diagnóstico. Nenhum arquivo funcional, regra, dado ou deployment é alterado por ele.

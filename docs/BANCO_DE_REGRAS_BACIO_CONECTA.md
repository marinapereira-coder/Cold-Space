# Banco de Regras — Bacio Conecta
**Fonte de verdade para manutenção do projeto**  
Versão inicial: 31/10/2026 · Repositório: `marinapereira-coder/Cold-Space`

> **Regra principal:** pedidos de ajustes devem ser **aditivos e pontuais**. Não alterar, remover, simplificar ou reconstruir funcionalidades já aprovadas sem solicitação explícita. Caso uma correção dependa de alterar uma regra existente, apresentar o conflito e obter autorização antes da mudança. Nunca dizer que foi publicado sem conferir a execução do GitHub Actions.

## 1. Regras obrigatórias de mudança (imutáveis por padrão)
- **BR-001 — Preservação:** manter funcionalidades, layouts, botões, textos aprovados, filtros, fluxos, permissões, dados e integrações que não estejam no escopo da solicitação.
- **BR-002 — Correção mínima:** localizar a causa raiz no código e banco antes de modificar arquivos. Evitar reescrita de módulos inteiros para consertar um campo.
- **BR-003 — Compatibilidade:** preservar assinaturas públicas de funções e contratos entre Apps Script/HTML/Supabase; ao substituir uma implementação, impedir funções legadas com o mesmo nome.
- **BR-004 — Integridade:** não excluir nem recriar lojas, usuários, demandas, conversas ou mensagens para solucionar problemas de interface. Não modificar dados de produção como teste.
- **BR-005 — Segurança:** as permissões são aplicadas no **servidor**; esconder menu no navegador não autoriza acesso. Não expor chave secreta de Supabase no HTML/cliente/GitHub.
- **BR-006 — Regressão:** conferir o comportamento solicitado **e** as áreas adjacentes (principalmente autenticação, chat, usuários, demandas e notificações). Validar código antes do deploy.
- **BR-007 — Publicação:** GitHub `main` → workflow `sync-apps-script.yml` → `clasp push --force` → criar versão → atualizar Web App. Verificar o status da execução; commit no GitHub **não é** prova de publicação.
- **BR-008 — Rastreabilidade:** commits descritivos, regras atualizadas quando houver mudança autorizada, testes anexados ao repositório. Não alterar regras consolidadas silenciosamente.
- **BR-009 — Feedback:** quando o servidor falhar, mostrar o erro e permitir tentar novamente; nunca transformar falha de consulta em `0 contatos` como se fosse dado real.
- **BR-010 — Escopo explícito:** se a solicitação falar de chat, não alterar cronograma, comunicados, notificações, formulários, campanhas ou processos externos.

## 2. Cadastro e acesso — regras atuais
**Fonte de cadastros:** Supabase `bacio_usuarios`; lojas `bacio_lojas`. A tela **Usuários & Acessos** permanece no menu de Gestão, restrita a administrador.
- `admin`: gerenciamento de usuários e acessos e demais áreas administrativas. Deve continuar vendo o menu de gestão e o cadastro de logins.
- `loja`: loja vinculada ao cadastro; não recebe privilégios administrativos e não acessa mensagens de outras lojas.
- `consultor` e `regional`: manter restrições de carteira/escopo implementadas no servidor.
- Departamentos (por exemplo Marketing, RH, Qualidade, Treinamento, Comercial, Growth e TI): perfis existentes, manter escopo de demandas e regras de aprovação.
- Desativados não são selecionáveis como novos contatos do chat. Não inventar e-mail de colaboradores, lojas, consultores ou regionais.
- O menu lateral deve ser rolável, sem o cartão de perfil cobrir o item **Usuários & Acessos**.

## 3. Chat — contrato aprovado em 31/10/2026
**Somente duas abas:** `Lojas` e `ADM`. Não oferecer aba `Demandas`.
- **Lojas:** ler lojas ativas diretamente da `bacio_lojas`, respeitando autorização do servidor. Exibir nome e código tal como a base, por exemplo `LJ 0006 - SHOP PATIO PAULISTA`. A contagem vem da base, **não é valor fixo**.
- **ADM:** mostrar os **usuários ativos que não são lojas** da `bacio_usuarios`: administração, departamentos, consultores e regionais. Não mostrar o próprio login. Mostrar nome, e-mail e perfil; buscas por esses atributos devem funcionar.
- Ao escolher uma loja, a conversa deve usar `storeId`, persistido como `conversa_loja_id` em `bacio_chat_mensagens`, com `demanda_id` nulo para conversa geral. A API ativa aceita `{storeId,demandId,message}`.
- Ao escolher ADM, usar destinatário por e-mail, `conversa_usuario_chave` por par de e-mails; a API ativa aceita `{recipientEmail,message}`.
- Leitura, envio e botão tentar novamente devem usar a mesma API e o mesmo destinatário; não misturar `threadId` (sistema antigo) com `storeId` (chat novo).
- Preservar mensagens existentes e conversas históricas. A opção de demanda foi retirada **do menu do chat**, não do módulo de demandas nem dos dados já gravados.
- O chat deve carregar independente de haver demandas ou campanhas publicadas.
- **Antirregressão crítica:** `Features.js` mantém funções antigas apenas como `legacy*` para consulta; a API pública `getChatWorkspace`, `getChatMessages` e `sendContextChatMessage` pertence **exclusivamente** a `Features_V2.js`. Não recriar nomes duplicados em arquivos Apps Script.
- **Incidente 31/10:** duas implementações com o mesmo nome geravam `Conversa não informada.` e escondiam ADM. Corrigido isolando as funções legadas. As duas ordens de carga devem passar nos testes.

## 4. Funcionalidades já existentes — preservar
- **Lojas & Estrutura:** importação da base de lojas, consulta de centro de custo, regionais, consultores, e-mails e vínculo de usuário; preservar IDs e histórico nas atualizações.
- **Usuários & Acessos:** criação/ativação/desativação de logins, perfis Operações (loja, consultor, regional, administrativo) e departamentos; redefinição de senha onde aplicável; proteção de administradores.
- **Demandas e Campanhas:** criação, publicação e gestão, públicos-alvo e respostas das lojas. Fluxo de validação por lideranças antes de publicar.
- **Comunicados e Central de Operações:** manter navegação, cadastros, links por departamento e regras de aprovação.
- **Calendário e Cronograma:** manter agenda, eventos, vencimentos e acompanhamento das demandas; não remover dados existentes.
- **Notificações e e-mails:** preservar alertas existentes e os lembretes/cobranças previstos para lojas e consultores responsáveis.
- **Avaliações e Respostas das Lojas:** manter notas, histórico, SLA e vínculos por demanda.
- **Interface:** preservar identidade visual Bacio di Latte, fundo claro/marrom/creme, responsividade, menu e temas existentes.

## 5. Bancos, arquivos e contratos
| Elemento | Finalidade | Proteção |
|---|---|---|
| `bacio_lojas` | Base mestre de lojas e vínculos | Não remover/inativar/recriar sem operação explícita |
| `bacio_usuarios` | Logins e papéis | Não alterar `role` ou `ativo` para corrigir visualização |
| `bacio_chat_mensagens` | Histórico, loja e contato ADM | Não excluir histórico ou trocar destinatários |
| `bacio_demandas` | Demandas, campanhas e aprovações | Não fundir chat com demandas |
| `Features_V2.js` | API ativa do chat e funcionalidades V2 | Manter endpoints e validações de acesso |
| `Features.js` | Funções legadas e demais recursos antigos | Não reintroduzir endpoints do chat com nomes V2 |
| `Scripts.html`, `Index.html` | Interface e eventos | Somente abas Lojas/ADM; respeitar contratos do servidor |
| `Supabase.js` | Dados/autorização/integrações | Não expor service role no cliente |
| `AutoRefresh.html` | Atualização automática | Não alterar destinatário ou perder texto em digitação |
| `.github/workflows/sync-apps-script.yml` | Teste e publicação | Não remover gate de regressão |

## 6. Checklist de aceite a cada atualização
- [ ] Entendi a solicitação e listei **somente** os módulos que serão alterados.
- [ ] Busquei funções duplicadas e conferi o contrato da versão ativa.
- [ ] Não alterei consultas, permissões, bases, dados ou regras fora do escopo.
- [ ] Testes automáticos de regressão passaram, inclusive ordem invertida dos scripts legados e V2.
- [ ] Admin vê contatos de lojas e ADM; loja vê somente o próprio escopo; perfil indevido não consegue ler conversa.
- [ ] Chat abre, exibe histórico e envia mensagem para o contato certo sem `Conversa não informada`.
- [ ] Menu Usuários & Acessos disponível para administrador e oculto para não autorizados.
- [ ] A execução de publicação foi verificada no GitHub Actions e erros informados, sem anunciar como publicado antes da confirmação.
- [ ] Solicitações não relacionadas continuam intactas.

## 7. Regras aprovadas — exclusão e visualização de planilhas (31/10/2026)
- **BR-011 — Exclusão administrativa de solicitações:** somente `admin` pode usar o botão **Excluir** na Central ou nos detalhes. A operação exige confirmação com nome da solicitação e é **exclusão lógica** (`bacio_demandas.ativa=false`) feita pela função `deleteDemand` com `requireAdmin_`. Não executar `DELETE` físico, nem eliminar respostas, notificações ou histórico. Nenhuma solicitação existente deve ser inativada automaticamente durante implementação/testes.
- **BR-012 — Recriação do zero:** depois de excluir logicamente, permitir `+ Nova solicitação` normalmente; não reaproveitar ou sobrescrever a solicitação anterior sem ação expressa.
- **BR-013 — Planilha na solicitação:** importação de planilhas operacionais multiabas deve manter **nome das abas, cabeçalhos de vários níveis, ordem das colunas, código/descrição de produtos, unidades, valores por loja, insumos recebidos, plaquinhas, observações e linhas de origem**. Exibir uma grade visual somente leitura, com abas e rolagem horizontal/vertical. **Não modificar valores ou fórmulas de origem.** A aplicação exibe os valores de células (não executa macros/fórmulas de Excel).
- **BR-014 — Abas protegidas:** abas `Base lojas`, `Base Adm`, `Respostas Lojas`, `Pendências Lançamento`, `Histórico Lançamento`, `Log de Envios` são auxiliares, não devem integrar o modelo de campanha nem ficar visíveis a lojas.
- **BR-015 — Escopo por usuário:** administradores podem ver toda a grade importada; lojas somente os próprios dados/linhas (inclusive operação dupla quando cabível); consultores, regionais e departamentos respeitam a autorização do servidor. Não usar somente filtro visual para proteger dados.
- **BR-016 — Compatibilidade de importação:** modelos antigos continuam legíveis pelo visualizador anterior. Nenhum banco de dados/schema precisa ser recriado; o detalhe enriquecido fica em `bacio_demandas.import_meta`. Não remover os fluxos de conferência, resposta, avaliação e simulação já existentes.
- **BR-017 — Exemplo de aceite:** arquivo `Campanha Crema Positano - Itens que são pedido de loja e envio automático.xlsx` possui as abas operacionais **Para loja pedir - LCP e Op. Dup**, **Para loja pedir - LSP e Op. Dup** e **ITENS DE ENVIO AUTOMÁTICO**. Na importação, a visão precisa corresponder às três grades, sem incluir abas auxiliares.
- **BR-018 — Testes de regressão:** o workflow antes do deploy deve validar a separação de abas privadas, operação dupla, código de loja de 4 dígitos, conservação de cabeçalhos/valores, proteção da exclusão e presença dos links/botões existentes. Se algum teste falhar, impedir a publicação.

## 8. Evolução controlada deste banco
Toda regra nova aprovada entra aqui com data, alcance e teste correspondente. Se existir conflito com regra anterior, obter autorização para a substituição e registrar a alteração. **Nenhuma regra anterior é descartada apenas porque uma solicitação nova não a menciona.**

*Este arquivo documenta o contrato do produto e orienta testes. Não substitui autorização efetiva no servidor nem garante ausência absoluta de regressões.*

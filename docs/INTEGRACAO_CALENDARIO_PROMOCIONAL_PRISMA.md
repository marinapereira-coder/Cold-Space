# Integração do Calendário Promocional — Prisma Growth → Bacio Conecta

**Status (17/11/2026):** implementação em homologação. A interface e o adaptador de leitura estão prontos, mas **a fonte real ainda não foi habilitada/validada no Apps Script do Conecta**. Os dados não podem ser considerados sincronizados antes do teste autenticado.

## Fonte de verdade e regras preservadas

- Referência técnica: `Growth.js` e `View_Growth.html` do repositório Prisma de homologação, sem modificar o projeto Prisma.
- A fonte é a **mesma planilha Google Sheets mensal** usada pelo Prisma Growth; nenhuma campanha é copiada para a base de demandas do Conecta.
- Abas no formato **Mês Ano**, consideradas a partir de junho/2026.
- Tipo, canais e nome nas colunas C, D e E; dias a partir de G; dados a partir da linha 6.
- Cor de dia pelo menos 12 pontos de brilho mais escura do que o fundo da célula do nome = dia ativo; `x` = dia cancelado; linhas ocultas ignoradas; nomes iguais agrupados.
- A leitura é somente consulta; não modifica planilha, promoções, comunicações, destinatários, alertas ou regras de lojas.
- A interface mostra início de cada período, promoções vigentes e fixas, sem duplicar cada dia de vigência como uma nova campanha. Exibe planejamento geral, não afirma que toda campanha é aplicável a cada loja.
- O calendário operacional existente permanece intacto, inclusive eventos manuais do tipo promoção já cadastrados nele.

## Ativação segura da fonte (etapa pendente)

1. O responsável por Apps Script/Prisma deve conferir qual é a planilha **vigente e autorizada** para o Growth.
2. Confirmar que a conta que executa o Web App do **Conecta** tem acesso **de leitura** a essa planilha. O manifesto atual usa `executeAs: USER_DEPLOYING`. O acesso de Marina em Drive, por si só, não prova acesso da conta do deployment.
3. No editor Apps Script **do Conecta**, em **Configurações do projeto → Propriedades do script**, cadastrar:
   - **Nome:** `CONECTA_PRISMA_GROWTH_SHEET_ID`
   - **Valor:** o ID da planilha vigente (copiar internamente do projeto Growth autorizado; **não registrar em um commit, issue ou chat público**).
4. Verificar autorização OAuth para leitura com `SpreadsheetApp`, se for solicitada pela plataforma.
5. Em homologação, entrar nos perfis **Loja**, **Consultor**, **Regional** e **ADM**, abrir **Calendário → Calendário Promocional** e comparar pelo menos três dias e os totais do mês com o calendário Prisma original.
6. Conferir promoções com vários períodos, linhas ocultas, dias cancelados, promoções com nome repetido, upgrades e meses com e sem campanhas.
7. Somente depois do teste real da fonte considerar o calendário disponível para produção. Um teste automatizado do GitHub **não comprova** acesso à planilha.

## Falhas e comportamento

- Sem propriedade: informa **Integração pendente**. Não exibe zero campanhas.
- Sem permissão ou fonte inacessível: informa **Fonte indisponível**, sem mostrar o ID ou a exceção.
- Mês sem aba correspondente: informa **Mês não disponível na origem**.
- Aba válida sem dias ativos: informa **Nenhuma promoção com dias ativos**.
- Cache de leitura do servidor: **15 minutos**; front-end também limita o cache local a 15 minutos.
- Para atualizar após edição na planilha, após vencer o cache, reabrir a guia ou mudar o mês e voltar.

## Limites conhecidos

A planilha original utilizada pelo Prisma não estava acessível às duas contas Google Drive conectadas na análise de 17/11/2026. A autenticação da conta de **execução do Apps Script** ainda requer validação. O adapter replica a leitura de cores e dias do Growth, porém não transporta eventuais materiais e links complementares do processamento de PDF do Prisma; esse acréscimo exige integração específica e autorização. A aplicação por loja e por canal continua definida pela campanha original, não por esta representação visual.

## Regressões exigidas

Executar `node .github/scripts/verify-conecta.cjs` e `node .github/scripts/verify-access-invitations.cjs`. A primeira suite incorpora `verify-promo-calendars.cjs`. Testes automatizados e conferência visual são complementares.

**Não publicar a integração como operacional até a origem efetiva estar conectada e conferida.**

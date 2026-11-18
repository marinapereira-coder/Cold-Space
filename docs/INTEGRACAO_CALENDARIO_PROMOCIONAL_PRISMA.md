# Integração do Calendário Promocional — Prisma Growth → Bacio Conecta

**Status (18/11/2026):** estrutura publicada no Conecta e leitura de Growth implementada, com validação da origem privada **ainda pendente**. Não declarar dados sincronizados antes da autorização e da conferência com o Prisma.

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

## Diagnóstico seguro para ativar o Growth (BR-068)

O código do Prisma mantém a origem mensal em `Growth.js`, constante `GROWTH_ID_PLANILHA`. A planilha referenciada pelo código consultado em 18/11/2026 **não estava acessível às contas Google conectadas**. Uma outra planilha de campanhas de 2026 foi localizada, mas possui apenas `Página1`, sem abas mensais no formato `Novembro 2026`. Portanto, ela **não pode ser conectada como substituta** sem mudar as regras originais, o que é proibido.

1. O responsável pelo Prisma confirma, no projeto **oficial** e não em homologação, qual ID está efetivamente configurado para Growth e se a aba `Novembro 2026` existe. Não inferir o ID por nome do arquivo nem usar históricos antigos.
2. A conta corporativa que implantou o Conecta deve ter **leitura** na planilha, sem tornar o documento público ou compartilhar com contas pessoais de teste.
3. No **Apps Script do Conecta → Configurações do projeto → Propriedades do script**, cadastrar `CONECTA_PRISMA_GROWTH_SHEET_ID` com o ID verificado. Não alterar `SUPABASE_SECRET_KEY`, `DEMO_MODE`, propriedade da expedição ou outros módulos.
4. No **Editor** do Conecta, selecionar a função `validarAcessoPromocionalConecta` e clicar **Executar** com conta corporativa autorizada. Essa função valida o **mês corrente** e retorna somente `status`, `ok`, `mes` e, quando válida, `total`. Pode solicitar autorização OAuth para ler planilhas; conceder somente após verificar conta e escopos.
5. Interpretar `status`: `unconfigured` = propriedade ausente; `source_open_failed` = ID, acesso ou consentimento; `month_unavailable` = a aba do mês não existe; `source_read_failed` = erro de leitura de linhas e cores; `ok` = leitura e extração concluídas. O teste não escreve em planilha, não envia dados de campanhas e não modifica o Prisma.
6. No portal Conecta, abrir **Calendário → Promocional**, selecionar novembro/2026 e clicar **Reconsultar**. Respostas de erro não permanecem armazenadas por 15 minutos no navegador. Respostas de sucesso continuam respeitando os 15 minutos de cache do backend, conforme Growth.
7. Comparar o total de promoções e pelo menos 3 dias com o Prisma oficial, incluindo promoções recorrentes, upgrades, Corriere, `x` e linhas ocultas antes de considerar concluída a validação.

## Falhas e comportamento

- Sem propriedade: informa **Integração pendente**. Não exibe zero campanhas.
- Sem permissão/ID incorreto/consentimento: informa **Não foi possível abrir a planilha do Growth**; erro de linhas e cores: informa **A aba do Growth foi localizada, mas a leitura falhou**. Nenhum erro devolve o ID ou a exceção.
- Mês sem aba correspondente: informa **Mês não disponível na origem**.
- Aba válida sem dias ativos: informa **Nenhuma promoção com dias ativos**.
- Cache de leitura do servidor: **15 minutos**; front-end também limita o cache local a 15 minutos.
- Para atualizar após edição na planilha, após vencer o cache, reabrir a guia ou mudar o mês e voltar.

## Limites conhecidos

A planilha original utilizada pelo Prisma não estava acessível às duas contas Google Drive conectadas na análise de 17/11/2026. A autenticação da conta de **execução do Apps Script** ainda requer validação. O adapter replica a leitura de cores e dias do Growth, porém não transporta eventuais materiais e links complementares do processamento de PDF do Prisma; esse acréscimo exige integração específica e autorização. A aplicação por loja e por canal continua definida pela campanha original, não por esta representação visual.

## Regressões exigidas

Executar `node .github/scripts/verify-conecta.cjs` e `node .github/scripts/verify-access-invitations.cjs`. A primeira suite incorpora `verify-promo-calendars.cjs`. Testes automatizados e conferência visual são complementares.

**A interface está publicada, mas a integração de dados permanece pendente até a origem efetiva estar conectada e conferida.**

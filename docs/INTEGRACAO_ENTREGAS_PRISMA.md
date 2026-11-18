# Entregas e Pedidos — Prisma → Bacio Conecta

**Status em 18/11/2026: código em homologação, origem não confirmada no Apps Script do Conecta.**

## O que foi implementado

- Um único menu **Calendário** com três guias: **Operacional**, **Promocional**, **Entregas e Pedidos**.
- A terceira guia permite selecionar loja autorizada e mês de **recebimento**, apresenta as datas de **pedido**, **separação/faturamento**, **carregamento** e **entrega prevista**, tipologia **SECO/CONGELADO** e rota quando vier da fonte.
- Os dados são apenas consultados. **Não** são criados eventos, demandas, notificações ou registros de operação.
- A leitura usa o mesmo layout do calendário de expedição do Prisma, consultando planilhas no formato original `CALENDÁRIO` ou nas abas normalizadas `PRISMA_CE_*`.
- Os registros da loja são selecionados no servidor com base em `getVisibleStores_(user)`; tentativas de acesso à loja de outro perfil são rejeitadas. A página nunca recebe a planilha de todas as lojas.
- Cache de respostas válidas por loja/mês/aba: 15 minutos. Falhas não são representadas como ausência de entregas.

## Configuração privada — etapa pendente

O calendário de entregas do **Prisma** é abastecido por um espelho privado da planilha Excel original. **Esse espelho não é sincronizado automaticamente** com novos arquivos Excel. A atualização do espelho e a seleção da aba vigente são processos controlados pela equipe do Prisma.

Para o Conecta consultar a **mesma versão autorizada**:

1. Identificar, no projeto de expedição do Prisma, qual planilha privada e qual aba efetivamente estão ativas. O Prisma pode usar `CALENDÁRIO` (layout original) ou `PRISMA_CE_*` (layout normalizado). Não pressupor que a última aba é a ativa.
2. Confirmar que o usuário que executa o Web App do Conecta possui **acesso de leitura** à fonte.
3. No **Apps Script do Conecta → Configurações do projeto → Propriedades do script**, configurar **privadamente**:
   - `CONECTA_PRISMA_EXPEDICAO_SHEET_ID`: ID da **planilha privada espelhada** (não o Excel original).
   - `CONECTA_PRISMA_EXPEDICAO_ABA_ATIVA`: aba vigente, exatamente igual à versão ativa selecionada pela equipe do Prisma.
4. Garantir as autorizações de `SpreadsheetApp` sem publicar ID, chave ou credenciais no GitHub, HTML ou chat público.
5. Toda vez que o Prisma ativar nova versão, **atualizar a propriedade de aba ativa do Conecta**. A troca do ID/aba altera a chave de cache; até 15 minutos de cache são usados somente para a versão configurada.
6. Validar em **homologação**, com loja, consultor, regional e administrador, ao menos uma loja com entregas de tipologia SECO e outra CONGELADO, e meses com/sem registros. Conferir as quatro datas com o Prisma.
7. Validar modo claro/escuro, especialmente descrições de comunicados, metadados e datas.

A aplicação mostra **Integração pendente** caso as propriedades não tenham sido cadastradas, **Fonte indisponível** caso a aba ou a permissão falhem, e **Selecione uma loja** quando o usuário corporativo ainda não tiver escolhido uma loja. Uma lista vazia é apresentada somente quando uma fonte efetivamente validada retornar zero entregas no mês.

## Observações sobre a origem

- Referência técnica: `CalendarioExpedicao.js` e `View_CalendarioExpedicao.html` do repositório de homologação do Prisma, consultados em 18/11/2026.
- A aba normalizada usa as colunas `PEDIDO, TIPO, LOJA, NOME, ROTA, SEPARAÇÃO, CARREGAMENTO, ENTREGA`. A versão legada usa os índices verificados no adaptador original.
- A seleção do mês considera a **data prevista de entrega**. Uma data de pedido ou de separação anterior ao mês selecionado continua visível na lista detalhada da entrega, mesmo que não apareça no quadro do mês corrente.
- Somente os tipos **SECO** e **CONGELADO** são exibidos. Registros exatamente iguais são deduplicados como no Prisma.
- **Não afirmar que o calendário está sincronizado ao vivo**. A disponibilidade real só é comprovada por consulta autenticada ao espelho vigente.

## Teste de autorização pelo editor do Apps Script

1. Entre no **Apps Script do Conecta Bacio** com a conta corporativa autorizada e abra a lista de funções.
2. Selecione `validarAcessoExpedicaoConecta` e clique em **Executar**. O Google poderá solicitar consentimento para acessar Planilhas. Revise os escopos e autorize apenas se o projeto e a conta estiverem corretos.
3. Confira o registro da execução: sucesso indica abertura e formato reconhecidos; falhas são identificadas por categoria sem divulgar IDs ou dados.
4. A execução requer administrador autenticado; não grava, compartilha, transfere ou altera a planilha.
5. Após o teste, volte ao calendário do Conecta e faça uma nova consulta.

## Testes antes de publicar

```bash
node .github/scripts/verify-conecta.cjs
node .github/scripts/verify-access-invitations.cjs
```

O primeiro comando executa `verify-promo-calendars.cjs` e `verify-deliveries.cjs`. As suites de PR não fazem deploy. A publicação do `main` no Web App usa outro workflow, com validação e `clasp`.

**Não liberar esta integração para produção sem validação da fonte logística real e da fonte promocional do BR-064.**

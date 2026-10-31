# Bacio Conecta

Portal de comunicação e operações — lojas, escritório, consultores, regionais e departamentos.

## Documentação obrigatória antes de modificar o projeto

**[Banco de Regras do Bacio Conecta](docs/BANCO_DE_REGRAS_BACIO_CONECTA.md)**

Antes de qualquer mudança, leia as regras e preserve todas as funcionalidades que não foram explicitamente solicitadas. Não altere permissões ou dados para corrigir problemas visuais.

## Validação

```bash
node .github/scripts/verify-conecta.cjs
```

O workflow [Sync to Google Apps Script](.github/workflows/sync-apps-script.yml) executa os testes antes de publicar. Se os testes falharem, a publicação deve ser interrompida.

## Componentes principais

- `Supabase.js`: integração e autenticação/dados.
- `Features_V2.js`: implementação atual do chat e módulos V2.
- `Features.js`: funcionalidades anteriores, com endpoints legados de chat renomeados para não sobrescrever V2.
- `Scripts.html`, `Index.html`, `Styles.html`: interface.
- `AutoRefresh.html`: atualização automática de tela/mensagens.
- `docs/BANCO_DE_REGRAS_BACIO_CONECTA.md`: contrato de funcionalidades aprovado.

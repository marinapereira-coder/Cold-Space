# Bacio Conecta — Conferência Natal 2026 (homologação)

Este branch prepara uma modalidade nova de demanda de conferência, sem mudar a aplicação existente.

## Dados verificados
- 2.465 registros do Excel de 1º envio Automático Natal 2026.
- Duas abas: Natal 2026 e Bomba recheio 2026.
- 243 códigos distintos de lojas.
- Fonte original preservada na homologação; respostas por item ficam separadas dos envios.

## Estrutura prevista
- Lotes: campanha, estado de aprovação e vínculo opcional à demanda.
- Itens: lote + aba + linha original + loja + produto + quantidade enviada.
- Respostas: item, status, quantidade recebida, chamado MOKI, observação, autor e data.

## Condições para integração ao portal
1. Identificar o repositório real da aplicação; este repo, no branch main, contém apenas README.md.
2. Vincular usuários às lojas em bacio_lojas e validar perfis, sem adivinhar regionais ou consultores.
3. Aplicar políticas de banco (RLS) e realizar testes com usuários de loja, consultor, regional e Operações.
4. Integrar a interface e o salvamento ao sistema de demandas e preservação do fluxo de aprovação.
5. Só publicar para lojas após testes de isolamento de dados.

**Situação:** preparação concluída; nenhuma alteração nas tabelas atuais ou publicação.

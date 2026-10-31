# Instruções permanentes para manutenção do Bacio Conecta

**Leia primeiro:** [Banco de Regras do Bacio Conecta](docs/BANCO_DE_REGRAS_BACIO_CONECTA.md). Esse arquivo é a especificação vigente do projeto.

1. Trate todo pedido como alteração **pontual**: preserve tudo o que a pessoa não solicitou mudar (funcionalidades, permissões, dados, layout, navegação, integração, desempenho e histórico).
2. Investigue a causa raiz antes de editar. Não tente corrigir erros de tela recriando dados, mudando papéis de usuários ou removendo funcionalidades.
3. Em Apps Script, funções globais com o mesmo nome em arquivos distintos podem sobrescrever umas às outras. A API ativa de chat é de `Features_V2.js`; as versões antigas do chat em `Features.js` devem permanecer com nomes `legacy*`.
4. Preserve o contrato do chat de **duas abas**: Lojas (base `bacio_lojas`) e ADM (logins ativos não-loja em `bacio_usuarios`). Conexões de loja usam `storeId`; contatos ADM usam `recipientEmail`. Nunca usar `threadId` das APIs legadas.
5. Regras de autorização devem ser verificadas no servidor. Não expor credenciais. Não apagar dados existentes ou histórico de `bacio_chat_mensagens`.
6. Antes de publicar execute `node .github/scripts/verify-conecta.cjs` e verifique impactos em outras áreas. Se o teste falhar, não faça o deploy.
7. Mudanças de regras exigem solicitação expressa; atualize o Banco de Regras e testes quando forem autorizadas. Informe o que mudou e o que foi preservado.
8. Após push, confira **GitHub Actions** até os passos de criação de versão e atualização do Web App terminarem com sucesso. Nunca confunda commit salvo com deploy concluído.

Para mais contexto, fluxos e regras detalhadas, consulte o arquivo completo indicado acima.

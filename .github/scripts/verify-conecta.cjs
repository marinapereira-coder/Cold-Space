#!/usr/bin/env node
'use strict';

/**
 * Banco de Regras — gate local/CI do Bacio Conecta.
 * Executar: node .github/scripts/verify-conecta.cjs
 * Sem rede, credenciais ou alterações de dados reais.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

const legacy = read('Features.js');
const modern = read('Features_V2.js');
const scripts = read('Scripts.html');
const index = read('Index.html');
const styles = read('Styles.html');
const backend = read('Supabase.js');
new vm.Script(backend,{filename:'Supabase.js'});
const rules = read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');

for (const [name, source] of [['Features.js', legacy], ['Features_V2.js', modern]]) {
  new vm.Script(source, {filename:name});
}
new vm.Script(scripts.replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), {filename:'Scripts.html'});

const countDeclaration = (name) => {
  const pattern = new RegExp('\\bfunction\\s+' + name + '\\s*\\(', 'g');
  return (legacy.match(pattern)||[]).length + (modern.match(pattern)||[]).length;
};
const uniqueChatEndpoints = [
  'getChatWorkspace', 'getStoreChatWorkspace',
  'getChatMessages', 'getStoreChatMessages',
  'sendContextChatMessage', 'sendStoreContextChatMessage',
  'getChatDirectMessages', 'getStoreChatDirectMessages',
  'sendChatDirectMessage', 'sendStoreChatDirectMessage'
];
for (const name of uniqueChatEndpoints) {
  assert.equal(countDeclaration(name), 1, 'Endpoint de chat duplicado/ausente: '+name);
}
assert.ok(legacy.includes('function legacyGetChatWorkspace_('), 'A versão antiga não pode sobrescrever o chat V2');
assert.ok(legacy.includes('function legacyGetChatMessages_('), 'Função antiga de leitura conflitante');
assert.ok(legacy.includes('function legacySendContextChatMessage_('), 'Função antiga de envio conflitante');
assert.ok(index.includes('data-chat-tab="lojas"'));
assert.ok(index.includes('data-chat-tab="adm"'));
assert.ok(!index.includes('data-chat-tab="demandas"'), 'Não voltar com a aba Demandas no chat');
assert.ok(index.includes('id="accessNavBtn"'), 'Gestão de usuários desapareceu');
assert.ok(scripts.includes('syncVerifiedPortalRole_'), 'Manter verificação do administrador');
assert.ok(styles.includes('overflow-y:auto'), 'O menu não pode voltar a esconder o acesso');
assert.ok(rules.includes('BR-001') && rules.includes('BR-010'), 'Banco de Regras incompleto');

const stores = Array.from({length:269}, (_,i) => ({
  id:String(i+1),nome:'LJ '+String(i+1).padStart(4,'0')+' - TESTE',
  codigo:String(i+1),ativa:true,email:'lj'+i+'@bdil.com.br',dados_extras:{}
}));
const users = [
  {email:'admin@bdil.com.br',nome:'Admin',role:'admin',ativo:true},
  {email:'operacoes@bdil.com.br',nome:'Operações',role:'admin',ativo:true},
  {email:'growth@bdil.com.br',nome:'Growth',role:'growth',ativo:true},
  {email:'loja@bdil.com.br',nome:'Loja',role:'loja',ativo:true},
  {email:'inativo@bdil.com.br',nome:'Inativo',role:'admin',ativo:false}
];

function checkOrder(sourceOrder) {
  const writes=[];
  let actingUser=users[0];
  const auth=()=>({user:actingUser,email:actingUser.email});
  const request=(url,method,payload)=>{
    if(url.includes('bacio_lojas'))return stores;
    if(url.includes('bacio_usuarios'))return users.filter(u=>u.ativo);
    if(url.includes('bacio_chat_mensagens')){
      if(method==='post'){writes.push(payload);return [{id:'new-msg',...payload}];}
      return [];
    }
    throw new Error('Consulta inesperada: '+url);
  };
  const ctx = vm.createContext({
    getCurrentAuthContext_:auth,
    getStoreAuthContext_:()=>auth(),
    getVisibleStores_:u=>u.role==='loja'?stores.filter(s=>s.id==='6'):u.role==='consultor'?stores.slice(0,2):stores,
    roleOf_:u=>u.role,
    isDepartmentUser_:u=>u.role==='growth',
    table_:(_k,fallback)=>fallback,
    supabaseRequest_:request,
    safeSupabaseSelect_:(url,fallback)=>{
      if(url.includes('bacio_chat_mensagens'))return [{
        id:'msg-1',usuario_email:'operacoes@bdil.com.br',
        usuario_nome:'Operações',mensagem:'Mensagem existente',
        conversa_loja_id:'6',created_at:'2026-10-31T15:00:00Z'
      }];
      return request(url,'get')||fallback;
    },
    parseJsonObject_:v=>v||{},
    console:{log(){},warn(){},error(){}}
  });
  for(const part of sourceOrder){
    vm.runInContext(part==='legacy'?legacy:modern,ctx,{filename:part+'.js'});
  }
  let directory=ctx.getChatWorkspace();
  assert.equal(directory.storeContacts.length,269,'Todas as lojas devem carregar para admin');
  assert.equal(directory.peopleContacts.length,2,'ADM inclui somente outros logins não-loja ativos');
  assert.equal(directory.storeContacts[5].title,'LJ 0006 - TESTE');
  assert.equal(directory.threads[5].storeId,'6');
  assert.equal(directory.threads[5].demandId,'');
  const messages=ctx.getChatMessages({storeId:'6',demandId:''});
  assert.equal(messages[0].message,'Mensagem existente');
  assert.equal(messages[0].storeId,'6');
  const sent=ctx.sendContextChatMessage({storeId:'6',demandId:'',message:'Teste automático'});
  assert.equal(sent.ok,true);
  assert.equal(writes[0].conversa_loja_id,'6');
  assert.equal(writes[0].demanda_id,null);
  assert.equal(writes[0].mensagem,'Teste automático');
  assert.equal(ctx.getChatDirectMessages({recipientEmail:'growth@bdil.com.br'}).length,0);
  ctx.sendChatDirectMessage({recipientEmail:'growth@bdil.com.br',message:'Mensagem ADM'});
  assert.equal(writes[1].destinatario_email,'growth@bdil.com.br');
  assert.ok(writes[1].conversa_usuario_chave.includes('growth@bdil.com.br'));
  assert.equal(writes[1].conversa_loja_id,null);

  // A loja não pode abrir a conversa de outra loja.
  actingUser={email:'loja@bdil.com.br',nome:'Loja',role:'loja',loja_id:'6',ativo:true};
  const onlyOwn=ctx.getChatVisibleStoresV2_(actingUser);
  assert.equal(onlyOwn.length,1);
  assert.equal(onlyOwn[0].id,'6');
  assert.throws(()=>ctx.getChatMessages({storeId:'7',demandId:''}),/acesso a esta conversa/);
  return directory.storeContacts.length;
}

assert.equal(checkOrder(['legacy','modern']),269);
assert.equal(checkOrder(['modern','legacy']),269);
// Solicitações: exclusão lógica, planilhas operacionais, abas auxiliares e privacidade.
const sqlSource=read('Supabase.js');
const styleSource=read('Styles.html');
new vm.Script(sqlSource,{filename:'Supabase.js'});
assert.ok(scripts.includes('function deleteDemandItem(id,title)'), 'Excluir solicitação exige confirmação por nome');
assert.ok(scripts.includes('CURRENT_ROLE===\'admin\'&&!CAMPAIGN_PREVIEW_DEPARTMENT'), 'Ação da lista deve ser só admin');
const softDeleteSource=sqlSource.slice(sqlSource.indexOf('function deleteDemand(demandaId)'),
  sqlSource.indexOf('function scopedCampaignImportMeta_',sqlSource.indexOf('function deleteDemand(demandaId)')));
assert.ok(softDeleteSource.includes('requireAdmin_()'), 'Excluir exige autorização no servidor');
assert.ok(softDeleteSource.includes('ativa: false'), 'Excluir é lógico, sem apagar históricos');
assert.ok(!softDeleteSource.includes("'delete'"), 'Nunca usar delete físico');
assert.ok(index.includes('id="newDemandBtn"'), 'Criar nova solicitação deve continuar presente');
assert.ok(styleSource.includes('bacio-sheet-grid'), 'A visualização deve ter tabela estilo planilha');
assert.equal((styleSource.match(/<style>/g)||[]).length,1,'Styles.html deve abrir exatamente uma tag style');
assert.equal(styleSource.split('</style>').length-1,1,'Styles.html deve fechar exatamente uma tag style');
assert.ok(styleSource.trim().startsWith('<style>'),'CSS deve começar dentro de style');
assert.ok(styleSource.trim().endsWith('</style>'),'CSS não pode aparecer depois de </style> na página');
assert.ok(styleSource.indexOf('.bacio-sheet-detail')<styleSource.lastIndexOf('</style>'),
  'CSS das planilhas deve estar dentro de <style>, nunca visível como texto');
for(const rule of ['BR-011','BR-012','BR-013','BR-014','BR-015','BR-016','BR-017','BR-018']){
 assert.ok(rules.includes(rule), 'Regra não documentada: '+rule);
}
const start=scripts.indexOf('function campaignSheetInferEditable_(headers){');
const stop=scripts.indexOf('function renderStoreTemplateInfo(template){',start);
assert.ok(start>0&&stop>start,'Importador multiabas precisa existir');
const browserImportCode=scripts.slice(start,stop);
new vm.Script(browserImportCode,{filename:'campaign-import.js'});
const requestRow=[['','','','','ATENÇÃO: PEDIDO LOJA LCP'],
 ['Crema Positano','','','','Forecast 5%','Gema de ovo'],
 ['Loja','UF','Produção','Tipo Op','','Caixa c/ 12'],
 ['LJ 0006 - SHOP PATIO PAULISTA','SP','LCP','Loja','147','1'],
 ['LJ 0007 - SHOP MORUMBI + LJ 3031 QUIOSQUE','SP','LCP','Loja','588','3']];
const auxiliary=[['Loja','Cód.'],['LJ 0006 - SHOP PATIO PAULISTA','6']];
const fakeSheets={
 'Para loja pedir - LCP e Op. Dup':requestRow,
 'Respostas Lojas':auxiliary,'Base lojas':auxiliary,'Base Adm':auxiliary,
 'Pendências Lançamento':auxiliary,'Histórico Lançamento':auxiliary,
 'Log de Envios':auxiliary
};
const Reader=function(){this.readAsArrayBuffer=()=>this.onload({target:{result:'fixture'}});};
const xlsxMock={
 read:()=>({SheetNames:Object.keys(fakeSheets),Sheets:fakeSheets}),
 utils:{sheet_to_json:value=>value}
};
const importCtx=vm.createContext({
 FileReader:Reader,XLSX:xlsxMock,CURRENT_ROLE:'admin',
 normalizeHeader:v=>String(v||'').trim().toLowerCase(),
 storeCodeFromText:v=>{let m=String(v).match(/LJ\\s*0*(\\d+)/i);
  return m?('0000'+String(Number(m[1]))).slice(-4):'';},
 safe:v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
});
vm.runInContext(browserImportCode,importCtx);
let workbookMeta=null,importError=null;
importCtx.parseMultiSheetCampaign({name:'Crema Positano.xlsx'},data=>workbookMeta=data,err=>importError=err);
assert.ifError(importError);
assert.ok(workbookMeta,'Importação deve gerar um modelo');
assert.equal(workbookMeta.sheets.length,1,'Abas administrativas não podem entrar na demanda');
assert.equal(workbookMeta.sheetLayouts[0].headerRows.length,3,'Cabeçalho original multinível');
assert.equal(workbookMeta.sheetLayouts[0].rows.length,2,'Linhas operacionais');
assert.equal(workbookMeta.sheetLayouts[0].rows[0].cells[5],'1','Quantidade original mantida');
assert.ok(workbookMeta.perStore['0006'],'Código normalizado 0006');
assert.ok(workbookMeta.perStore['3031'],'Operação dupla inclui o quiosque');
const viewerHtml=importCtx.campaignSheetTableHtml(workbookMeta.sheetLayouts[0]);
assert.ok(viewerHtml.includes('Gema de ovo')&&viewerHtml.includes('SHOP PATIO PAULISTA'));
const scopeCode=sqlSource.slice(sqlSource.indexOf('function scopedCampaignImportMeta_('),
 sqlSource.indexOf('function getDemandDetail(',sqlSource.indexOf('function scopedCampaignImportMeta_(')));
const scopeCtx=vm.createContext({normalizeJsonObject_:v=>v||{}});
vm.runInContext(scopeCode,scopeCtx);
const scoped=scopeCtx.scopedCampaignImportMeta_(workbookMeta,[{codigo:'6',nome:'LJ 0006 - SHOP PATIO PAULISTA'}]);
assert.ok(scoped.perStore['0006']);
assert.ok(!scoped.perStore['3031']);
assert.ok(!('sheetLayouts' in scoped),'Perfil não-admin não recebe a planilha global');
// Exclusão lógica: registros inativos jamais devem reaparecer em respostas e avaliações.
assert.ok(rules.includes('BR-020'),'Banco de Regras deve definir ocultação dos itens arquivados');
const responseBuilder=modern.slice(modern.indexOf('function buildResponsesWorkspaceV2_('),
  modern.indexOf('function evaluateDemandDelivery('));
const evaluationBuilder=modern.slice(modern.indexOf('function buildEvaluationWorkspaceV2_('),
  modern.indexOf('function mapEvaluationRowV2_('));
const evaluateAction=modern.slice(modern.indexOf('function evaluateDemandDelivery('),
  modern.indexOf('function getEvaluationWorkspace('));
for(const [label,part] of [['Respostas',responseBuilder],['Avaliações',evaluationBuilder]]) {
 assert.ok(part.includes('ativa=eq.true'),'Filtro de demandas ativas no servidor: '+label);
 assert.ok(part.includes('d.ativa===true'),'Defesa adicional contra demandas inativas: '+label);
 assert.ok(part.includes('demandMap[String('),'Registros dependentes precisam respeitar as demandas ativas: '+label);
}
assert.ok(evaluateAction.includes('&ativa=eq.true&limit=1') &&
  evaluateAction.includes('demand.ativa===false'), 'Impedir avaliação de solicitação excluída');
const demandFixture=[
 {id:'d-active',titulo:'Solicitação ativa',ativa:true,prazo_sla:null,model_fields:[]},
 {id:'d-archived',titulo:'Solicitação excluída',ativa:false,prazo_sla:null,model_fields:[]}
];
const responseFixture=[
 {id:'r-active',demanda_id:'d-active',loja_id:'1',usuario_email:'loja@bdil.com.br',
  created_at:'2026-10-31T14:30:00Z',status:'respondido',resposta_json:{}},
 {id:'r-archived',demanda_id:'d-archived',loja_id:'1',usuario_email:'loja@bdil.com.br',
  created_at:'2026-10-31T14:29:00Z',status:'aprovada',resposta_json:{}}
];
const evaluationFixture=[
 {id:'e-active',demanda_id:'d-active',loja_id:'1',estrelas:5,status:'aprovada',sla_cumprido:true},
 {id:'e-archived',demanda_id:'d-archived',loja_id:'1',estrelas:1,status:'reprovada',sla_cumprido:false}
];
const demandsSeen=[];
const operationsCtx=vm.createContext({
 getVisibleStores_:()=>[{id:'1',nome:'LJ 0001 - OSCAR FREIRE',codigo:'0001'}],
 isConectaTestStoreId_:id=>String(id)==='TESTE_CONECTA',
 roleOf_:u=>u.role,isDepartmentUser_:()=>false,table_:(_key,t)=>t,
 safeSupabaseSelect_:(url)=>{
  if(url.includes('bacio_demandas')){
   demandsSeen.push(url);
   return demandFixture.filter(d=>!url.includes('ativa=eq.true')||d.ativa===true);
  }
  if(url.includes('bacio_demanda_respostas'))return responseFixture;
  if(url.includes('bacio_avaliacoes'))return evaluationFixture;
  return [];
 },
 normalizeJsonObject_:v=>v||{},
 normalizeObjectArray_:v=>v||[],
 responseSheetPreviewV2_:()=>null,
 storeLabelV2_:s=>s.nome||'Loja',
 mapEvaluationRowV2_:(a,d,s)=>({
  demandaId:a.demanda_id,storeId:a.loja_id,storeLabel:s.nome||'Loja',
  demandTitle:d.titulo,stars:a.estrelas,status:a.status,slaMet:a.sla_cumprido
 }),
 roundOneV2_:v=>Math.round(v*10)/10
});
vm.runInContext(responseBuilder+'\n'+evaluationBuilder,operationsCtx);
const responseWorkspace=operationsCtx.buildResponsesWorkspaceV2_({role:'admin'});
const ratingWorkspace=operationsCtx.buildEvaluationWorkspaceV2_({role:'admin'});
assert.equal(responseWorkspace.items.length,1,'Apenas resposta de demanda ativa deve aparecer');
assert.equal(responseWorkspace.items[0].demandaId,'d-active');
assert.equal(responseWorkspace.stats.total,1);
assert.equal(responseWorkspace.items[0].displayStatus,'respondido',
 'Primeira entrega continua Aguardando análise');
assert.equal(responseWorkspace.items[0].isCorrectionResubmission,false,
 'Primeira resposta não pode sinalizar correção sem histórico');

// Segunda entrega após ajuste necessário: status oficial continua respondido,
// mas a gestão deve visualizar "Conferir ajuste" até avaliá-la.
responseFixture[0].status='ajuste_necessario';
responseFixture.unshift({
 id:'r-corrigida',demanda_id:'d-active',loja_id:'1',
 usuario_email:'loja@bdil.com.br',created_at:'2026-11-02T12:00:00Z',
 status:'respondido',resposta_json:{}
});
let correctionWorkspace=operationsCtx.buildResponsesWorkspaceV2_({role:'admin'});
assert.equal(correctionWorkspace.items.length,1,'Histórico não cria duas linhas na gestão');
assert.equal(correctionWorkspace.items[0].responseId,'r-corrigida');
assert.equal(correctionWorkspace.items[0].status,'respondido',
 'Status persistido deve permanecer respondido');
assert.equal(correctionWorkspace.items[0].displayStatus,'conferir_ajuste',
 'Reenvio deve ser identificado como Conferir ajuste');
assert.equal(correctionWorkspace.items[0].isCorrectionResubmission,true);
assert.equal(correctionWorkspace.items[0].firstResponseAt,'2026-10-31T14:30:00Z',
 'SLA mantém data da primeira entrega');
assert.equal(correctionWorkspace.stats.aguardando,1,
 'Correção aguardando avaliação permanece no KPI Aguardando análise');

// O mesmo comportamento se a avaliação anterior era reprovada.
responseFixture[1].status='reprovada';
correctionWorkspace=operationsCtx.buildResponsesWorkspaceV2_({role:'admin'});
assert.equal(correctionWorkspace.items[0].displayStatus,'conferir_ajuste');

// Após avaliação, o estado exibido é a avaliação, nunca Conferir ajuste.
evaluationFixture.push({id:'e-corrigida',resposta_id:'r-corrigida',demanda_id:'d-active',
 loja_id:'1',status:'aprovada',estrelas:5,sla_cumprido:true});
correctionWorkspace=operationsCtx.buildResponsesWorkspaceV2_({role:'admin'});
assert.equal(correctionWorkspace.items[0].displayStatus,'aprovada');
assert.equal(correctionWorkspace.items[0].isCorrectionResubmission,false);

// Não confundir resposta reenviada sem solicitação anterior de ajuste.
evaluationFixture.pop();
responseFixture[1].status='respondido';
correctionWorkspace=operationsCtx.buildResponsesWorkspaceV2_({role:'admin'});
assert.equal(correctionWorkspace.items[0].displayStatus,'respondido');
assert.equal(correctionWorkspace.items[0].isCorrectionResubmission,false);

// Regressão: o filtro, o rótulo e o botão da gestão usam somente apresentação.
assert.ok(scripts.includes("(i.displayStatus||i.status)===sf") &&
 scripts.includes("responseStatusLabel(i.displayStatus||i.status)") &&
 scripts.includes("i.isCorrectionResubmission?'Conferir ajuste':'Avaliar'"),
 'Listagem, filtro e botão de avaliação devem mostrar Conferir ajuste');
assert.ok(index.includes('value="conferir_ajuste"'),
 'Filtro de status inclui Conferir ajuste');
assert.equal(ratingWorkspace.items.length,1,'Apenas avaliação ativa deve aparecer');
assert.equal(ratingWorkspace.items[0].demandaId,'d-active');
assert.equal(ratingWorkspace.summary.total,1,'Média e SLA não devem incluir avaliações arquivadas');
assert.ok(demandsSeen.length>=2&&demandsSeen.every(url=>url.includes('ativa=eq.true')));
console.log('OK — Demandas arquivadas ocultas em respostas e avaliações, com histórico preservado.');


// BR-021 a BR-023: janela ampla, barra inferior, filtros combinados por carteira.
for(const rule of ['BR-021','BR-022','BR-023']){
 assert.ok(rules.includes(rule),'Banco de Regras incompleto: '+rule);
}
const detailCss=styleSource.slice(styleSource.indexOf('/* Ajuste exclusivo da visualização de detalhes'));
assert.ok(detailCss.includes('#detailModal .modal.wide'),'Não ampliar outros modais');
assert.ok(detailCss.includes('display:flex;flex-direction:column;overflow:hidden'),
 'Janela de detalhe precisa de dimensões estáveis');
assert.ok(detailCss.includes('#detailModal .modal-body')&&detailCss.includes('overflow-y:auto'),
 'Área central de detalhe com rolagem própria');
assert.ok(detailCss.includes('#detailModal .modal-foot')&&detailCss.includes('flex:0 0 auto'),
 'Rodapé deve permanecer visível');
assert.ok(detailCss.includes('.bacio-sheet-hrail')&&detailCss.includes('overflow-x:scroll'),
 'Barra horizontal sempre acessível na base da planilha');
const filterStart=scripts.indexOf('function campaignSheetCode_(');
const filterStop=scripts.indexOf('function renderStoreTemplateInfo(template){',filterStart);
assert.ok(filterStart>0&&filterStop>filterStart,'Filtros e barra do visualizador não encontrados');
const filterCode=scripts.slice(filterStart,filterStop);
assert.ok(filterCode.includes('data-bacio-filter="store"')&&filterCode.includes('data-bacio-filter="regional"')&&
  filterCode.includes('data-bacio-filter="consultor"'),'Os três filtros precisam existir');
assert.ok(filterCode.includes('bacio-sheet-hrail-wrap')&&filterCode.includes('data-bacio-sheet-step'),
  'Barra e setas precisam existir');
const filterCtx=vm.createContext({
 APP_DATA:{stores:[
  {id:6,codigo:'6',nome:'LJ 0006 - PÁTIO PAULISTA',regional:'São Paulo',consultor:'Bruna'},
  {id:7,codigo:'7',nome:'LJ 0007 - MORUMBI',regional:'São Paulo',consultor:'Bruna'},
  {id:3031,codigo:'3031',nome:'LJ 3031 - QUIOSQUE',regional:'Rio de Janeiro',consultor:'Alex'}
 ]},
 CURRENT_ROLE:'admin',
 safe:v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 console
});
vm.runInContext(filterCode,filterCtx);
const directory=filterCtx.campaignSheetStoreDirectory_(workbookMeta,workbookMeta.sheetLayouts);
assert.equal(directory['0006'].regional,'São Paulo','Regional da loja vinculada');
assert.equal(directory['0006'].consultor,'Bruna','Consultor da loja vinculada');
assert.equal(directory['3031'].consultor,'Alex','Operação dupla vinculada a outro consultor');
const allRows=workbookMeta.sheetLayouts[0].rows;
const query=(filters)=>filterCtx.campaignSheetVisibleRows_(workbookMeta.sheetLayouts[0],filters,directory);
assert.equal(query({store:'',regional:'',consultor:''}).length,2,'Sem filtro deve mostrar tudo');
assert.equal(query({store:'0006',regional:'',consultor:''}).length,1,'Filtrar loja');
assert.equal(query({store:'',regional:'Rio de Janeiro',consultor:''}).length,1,'Filtrar regional');
assert.equal(query({store:'3031',regional:'Rio de Janeiro',consultor:'Alex'}).length,1,
 'Três filtros juntos e linha dupla');
assert.equal(query({store:'0007',regional:'Rio de Janeiro',consultor:'Alex'}).length,0,
 'Combinação deve se aplicar à mesma loja, não a lojas diferentes na mesma linha');
assert.equal(query({store:'0006',regional:'São Paulo',consultor:'Bruna'}).length,1,
 'Combinação exata de três filtros');
assert.equal(allRows[0].cells[5],'1','Filtros não podem alterar dados de origem');
assert.ok(filterCtx.campaignSheetCode_('LJ0006 - SHOP')==='0006');
console.log('OK — Janela ampla, footer fixo, barra horizontal e filtros combináveis foram validados.');


// BR-024: uma única planilha visível; simulação administrativa compacta, opcional e sem regravar dados.
assert.ok(rules.includes('BR-024'),'Banco de Regras precisa impedir planilhas duplicadas');
assert.ok(styleSource.includes('#detailModal .bacio-optional-simulator > summary'),
  'Simulação de resposta deve ter cabeçalho recolhível');
const detailStart=scripts.indexOf('function renderDemandDetail(d){');
const detailEnd=scripts.indexOf('function renderAdminStoreSimulator(d){',detailStart);
const detailCode=scripts.slice(detailStart,detailEnd);
assert.ok(detailCode.includes("CURRENT_ROLE==='admin'&&isImportedSheet?"),
 'A planilha importada deve substituir o antigo Modelo de resposta no detalhe admin');
assert.ok(detailCode.includes('<details class="detail-box bacio-optional-simulator">'),
 'O simulador deve estar recolhido inicialmente');
assert.ok(detailCode.includes("CURRENT_ROLE==='loja'?renderStoreResponseSection(d,answerHtml)"),
 'Resposta real de loja deve ser preservada');
const simStart=scripts.indexOf('function storeSimulationBody(d,store){');
const simEnd=scripts.indexOf('// Respostas de teste são mantidas',simStart);
const simCode=scripts.slice(simStart,simEnd);
let oldTableCalls=0;
const simulatorCtx=vm.createContext({
 safe:v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 requestFieldsForStore:fields=>fields,
 responseInput:()=>'<textarea class="answer-input" data-key="observacao"></textarea>',
 campaignSpreadsheetLayouts:meta=>[{sheet:'LCP',width:2,headerRows:[['Loja','Insumos recebidos?']],rows:[{sourceRow:3,cells:['LJ0006','Sim']}]}],
 campaignSheetTableHtml:()=>'<table class="bacio-sheet-grid"><tr><td>Seletor Sim/Não</td></tr></table>',
 campaignSheetRules_:()=>({1:{type:'boolean',required:true}}),
 storeTemplateSectionHtml:()=>{oldTableCalls++;return '<div class="old-vertical-table">ANTIGA TABELA</div>';}
});
vm.runInContext(simCode,simulatorCtx);
const simStore={id:'6',code:'0006',label:'LJ 0006'};
const importedDetail={
 importMeta:{sheetLayouts:[{sheet:'LCP'}],perStore:{'0006':[{sheet:'LCP',rowCells:['LJ0006','1']}]}},
 modelFields:[{id:'observacao',label:'Observação',type:'textarea'}]
};
const simulatedHtml=simulatorCtx.storeSimulationBody(importedDetail,simStore);
assert.ok(!simulatedHtml.includes('old-vertical-table'),'Não repetir planilha na simulação');
assert.equal(oldTableCalls,0,'A tabela vertical antiga não pode ser chamada para planilhas importadas');
assert.ok(simulatedHtml.includes('storeResponsePreviewForm')&&simulatedHtml.includes('Enviar resposta de teste'),
 'Campos e envio simulado devem continuar disponíveis');
assert.ok(simulatedHtml.includes('Prévia real da loja'),'Simulador precisa mostrar a própria planilha editável');
const legacyDetail={importMeta:{perStore:{'0006':[{sheet:'LCP'}]}},modelFields:[]};
const legacyHtml=simulatorCtx.storeSimulationBody(legacyDetail,simStore);
assert.ok(legacyHtml.includes('old-vertical-table'),'Modelos antigos continuam com visualização anterior');
assert.equal(oldTableCalls,1,'Retrocompatibilidade de modelos anteriores');
const detailNodes={
 detailTitle:{textContent:''},detailBody:{innerHTML:'',firstChild:{},insertBefore(){}},
 detailFoot:{innerHTML:''}
};
const detailsCtx=vm.createContext({
 document:{getElementById:id=>detailNodes[id],createElement:()=>({className:''})},
 window:{},CURRENT_ROLE:'admin',
 renderAdminStoreSimulator:()=>'<div class="admin-sim">SIMULAÇÃO</div>',
 renderStoreResponseSection:()=>'<div>RESPOSTA LOJA</div>',
 renderCampaignSpreadsheet:()=>{},
 storeTemplateSectionHtml:()=>{throw new Error('Tabela vertical duplicada no detalhe admin');},
 safe:v=>String(v==null?'':v),safeJs:v=>String(v),
 typeLabel:v=>v,formatDateTime:()=>'',formatAnswer:v=>v
});
vm.runInContext(detailCode,detailsCtx);
detailsCtx.renderDemandDetail({
 id:'demo',type:'campanha',title:'Crema',description:'',
 totalStores:1,modelFields:[],stores:[],
 importMeta:{sheetLayouts:[{sheet:'LCP'}],perStore:{}},timeline:{},
 cronograma:{},status:'draft'
});
assert.ok(detailNodes.detailBody.innerHTML.includes('Simular resposta da loja (opcional)'));
assert.ok(!detailNodes.detailBody.innerHTML.includes('Modelo de resposta'),
 'Não mostrar o modelo duplicado na visualização XLSX para administrador');
assert.ok(detailNodes.detailBody.innerHTML.includes('admin-sim'),'Simulador preservado no painel fechado');
console.log('OK — Planilha única e painel de simulação opcional, sem alterar o fluxo de resposta da loja.');


// BR-025 a BR-028: colunas editáveis são inferidas de cabeçalhos, nunca dos valores.
for(const rule of ['BR-025','BR-026','BR-027','BR-028'])
 assert.ok(rules.includes(rule),'Banco de Regras faltando: '+rule);
const headers=[['LOJA','GELATO','PLAQUINHAS','INSUMOS RECEBIDOS?','OBSERVAÇÕES'],
 ['Loja','BALDE 3,6 KG','(Automático)','Confirmação','Texto da loja']];
const inferred=importCtx.campaignSheetInferEditable_(headers);
assert.ok(!inferred[0]&&!inferred[1],'Loja e quantidade devem ser somente leitura');
assert.equal(inferred[2].type,'boolean','Plaquinhas preenchíveis com Sim ou Não');
assert.equal(inferred[3].type,'boolean','Insumos recebidos com Sim ou Não');
assert.equal(inferred[4].type,'text','Observação editável');
const editableLayout={sheet:'Para loja pedir - LCP',width:5,headerRows:headers,
 rows:[{sourceRow:4,cells:['LJ 0006 - PÁTIO PAULISTA','3','Não','Não',''],codes:['0006']}]};
const editableHtml=importCtx.campaignSheetTableHtml(editableLayout,{
 mode:'store',sheetIndex:0,rules:inferred,answers:{sheetcell_0_4_2:'Sim'},readonly:false
});
assert.ok(editableHtml.includes('data-key="sheetcell_0_4_2"'));
assert.ok(editableHtml.includes('data-key="sheetcell_0_4_3"'));
assert.ok(editableHtml.includes('data-key="sheetcell_0_4_4"'));
assert.ok(!editableHtml.includes('data-key="sheetcell_0_4_1"'),'Quantidade não é editável');
assert.ok(editableHtml.includes('<select')&&editableHtml.includes('<textarea'),
 'A planilha deve permitir Sim/Não e observações na própria linha');
assert.ok(editableHtml.includes('BALDE 3,6 KG')&&editableHtml.includes('PÁTIO PAULISTA'),
 'O restante da planilha precisa preservar os valores');
const validationStart=sqlSource.indexOf('function sheetEditableColumnsServer_(');
const validationEnd=sqlSource.indexOf('function submitDemandResponse(',validationStart);
assert.ok(validationStart>0&&validationEnd>validationStart,'Validação de células precisa existir no servidor');
const validationCtx=vm.createContext({});
vm.runInContext(sqlSource.slice(validationStart,validationEnd),validationCtx);
const serverMeta={sheets:[{sheet:'Para loja pedir - LCP'}],
 storeSections:[{sheet:'Para loja pedir - LCP',sourceRow:4,sheetHeaders:headers,
  rowCells:['LJ0006','3','','','']}],
 editableColumns:{'Para loja pedir - LCP':inferred}};
const detail={importMeta:serverMeta};
const valid={'sheetcell_0_4_2':'Sim','sheetcell_0_4_3':'Não',
 'sheetcell_0_4_4':'Pedido chegou parcialmente.'};
assert.doesNotThrow(()=>validationCtx.validateSheetCellAnswers_(valid,detail),
 'Confirmar a própria linha deve ser permitido');
assert.throws(()=>validationCtx.validateSheetCellAnswers_({}, {importMeta:{...serverMeta,version:5}}),
 /colunas de confirmação/,'Nova planilha não pode ser enviada com confirmações obrigatórias vazias');
assert.doesNotThrow(()=>validationCtx.validateSheetCellAnswers_({}, {importMeta:{...serverMeta,version:4}}),
 'Modelos antigos de conferência precisam continuar compatíveis');
assert.throws(()=>validationCtx.validateSheetCellAnswers_({...valid,sheetcell_0_4_1:'999'},detail),
 /não está autorizada/,'Quantidade original deve ficar bloqueada');
assert.throws(()=>validationCtx.validateSheetCellAnswers_({...valid,sheetcell_0_5_2:'Sim'},detail),
 /não está autorizada/,'Uma loja não pode enviar outra linha');
assert.throws(()=>validationCtx.validateSheetCellAnswers_({...valid,sheetcell_0_4_3:'Talvez'},detail),
 /opção válida/,'Sim/Não deve ser validado no servidor');
assert.throws(()=>validationCtx.validateSheetCellAnswers_({...valid,sheetcell_0_4_2:''},detail),
 /colunas de confirmação/,'Confirmar as colunas obrigatórias');
const scopedMeta=scopeCtx.scopedCampaignImportMeta_({
 version:5,perStore:{'0006':[serverMeta.storeSections[0]]},sheets:serverMeta.sheets,
 editableColumns:serverMeta.editableColumns
},[{codigo:'0006',nome:'LJ 0006'}]);
assert.ok(scopedMeta.editableColumns&&scopedMeta.editableColumns['Para loja pedir - LCP'],
 'Regras precisam chegar à sessão autenticada da loja');
assert.ok(scripts.includes('id="storeResponseForm"') &&
 scripts.includes('submitStoreResponse('),'Resposta é enviada por ação explícita');
assert.ok(modern.includes('validateSheetCellAnswers_(input.answers||{},detail)'),
 'Login com senha deve validar as células autorizadas no backend');
assert.ok(styleSource.includes('bacio-sheet-editable'),'Destaque de campos editáveis indispensável');
console.log('OK — Sim/Não inline, observações, restrição por loja, validação e persistência protegida.');


// BR-029 a BR-031: evidência por loja e SLA antes de avaliar, sem regravar dados.
for(const rule of ['BR-029','BR-030','BR-031'])
 assert.ok(rules.includes(rule),'Banco de Regras da avaliação incompleto: '+rule);
assert.ok(scripts.includes('responseEvaluationEvidenceHtml_(item)'),
 'Avaliação real e simulada precisam exibir a evidência enviada');
assert.ok(scripts.includes("document.getElementById('genericModal').classList.add('bacio-evaluation-modal')"));
assert.ok(styleSource.includes('.bacio-review-cell') &&
 styleSource.includes('.bacio-evaluation-timing'),'Evidência e SLA devem ter destaque');
const evidenceStart=modern.indexOf('function responseSheetPreviewV2_(');
const evidenceStop=modern.indexOf('function buildResponsesWorkspaceV2_(',evidenceStart);
assert.ok(evidenceStart>=0&&evidenceStop>evidenceStart,'Falta construção segura do detalhe da resposta');
const evidenceCtx=vm.createContext({normalizeJsonObject_:v=>v||{}});
vm.runInContext(modern.slice(evidenceStart,evidenceStop),evidenceCtx);
const evidenceD={
 import_meta:{
  version:5,fileName:'Crema.xlsx',sheets:[{sheet:'LCP'}],
  editableColumns:{LCP:{2:{type:'boolean',required:true},3:{type:'text',required:false}}},
  perStore:{
   '0006':[{sheet:'LCP',sourceRow:4,sheetHeaders:[['LOJA','QUANTIDADE','INSUMOS RECEBIDOS?','OBSERVAÇÕES']],
    rowCells:['LJ 0006 - PÁTIO PAULISTA','4','','']}],
   '0007':[{sheet:'LCP',sourceRow:5,sheetHeaders:[['LOJA','QUANTIDADE','INSUMOS RECEBIDOS?','OBSERVAÇÕES']],
    rowCells:['LJ 0007 - MORUMBI','9','','']}]
  }
 }
};
const evidence=evidenceCtx.responseSheetPreviewV2_(evidenceD,{codigo:'LJ 0006',nome:'LJ 0006 - PÁTIO PAULISTA'});
assert.equal(evidence.storeSections.length,1,'Apenas uma loja na evidência');
assert.ok(!JSON.stringify(evidence).includes('MORUMBI'),'Não vazar lojas de outras carteiras');
assert.equal(evidence.storeSections[0].sourceRow,4,'Manter a linha original');
const clientStart=scripts.indexOf('function responseTimingInfo_(item){');
const clientStop=scripts.indexOf('function openEvaluation(responseId){',clientStart);
assert.ok(clientStart>0&&clientStop>clientStart,'Quadro de SLA ausente');
const clientCtx=vm.createContext({
 safe:v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
 formatDateTime:v=>String(v||''),
 formatAnswer:v=>String(v||''),
 campaignSpreadsheetLayouts:meta=>meta.storeSections.map(sec=>({
   sheet:sec.sheet,headerRows:sec.sheetHeaders,width:sec.rowCells.length,
   rows:[{sourceRow:sec.sourceRow,cells:sec.rowCells}]
 })),
 campaignSheetRules_:(meta,layout)=>meta.editableColumns[layout.sheet],
 campaignSheetTableHtml:(layout,opts)=>{
   const key='sheetcell_'+opts.sheetIndex+'_'+layout.rows[0].sourceRow+'_2';
   return '<div class="bacio-sheet-grid">PRODUTO '+layout.rows[0].cells[1]+
     ' · '+(opts.answers[key]||'Não informado')+'</div>';
 }
});
vm.runInContext(scripts.slice(clientStart,clientStop),clientCtx);
const onTime=clientCtx.responseTimingInfo_({
 firstResponseAt:'2026-11-01T12:00:00Z',
 createdAt:'2026-11-01T14:00:00Z',deadline:'2026-11-01T13:00:00Z'
});
assert.equal(onTime.status,'on-time','Primeira entrega no prazo mesmo quando correção chega depois');
assert.equal(clientCtx.responseTimingInfo_({
 firstResponseAt:'2026-11-01T14:00:00Z',deadline:'2026-11-01T13:00:00Z'
}).status,'late','Entrega após o prazo');
assert.equal(clientCtx.responseTimingInfo_({
 firstResponseAt:'2026-11-01T14:00:00Z',deadline:''
}).status,'unknown','Nunca inventar prazo');
const review=clientCtx.responseEvaluationEvidenceHtml_({
 storeLabel:'LJ0006',demandaTitle:'Crema',userEmail:'loja@bdil.com.br',
 firstResponseAt:'2026-11-01T12:00:00Z',
 createdAt:'2026-11-01T14:00:00Z',deadline:'2026-11-01T13:00:00Z',
 submittedSheet:evidence,
 answers:{sheetcell_0_4_2:'Não',sheetcell_0_4_3:'Faltou insumo'},
 observacao:'Pedido parcial',modelFields:[]
});
assert.ok(review.includes('No prazo')&&review.includes('Primeira resposta')&&review.includes('Última atualização'));
assert.ok(review.includes('PRODUTO 4 · Não'),'Exibir exatamente a resposta da célula original');
assert.ok(review.includes('Pedido parcial'),'Não perder observação');
assert.ok(!review.includes('MORUMBI'),'Nunca mostrar outra loja');
console.log('OK — Evidência de planilha, resposta Não e SLA da primeira entrega validados.');


// BR-032: compactação apenas visual; IDs de respostas permanecem os da planilha XLSX.
assert.ok(rules.includes('BR-032'),'Banco de Regras precisa preservar a grade compacta');
assert.ok(styleSource.includes('.bacio-sheet-grid.bacio-sheet-compact')&&
  styleSource.includes('--bacio-sheet-min-width'),'Tabela compacta ausente do CSS');
const compactLayout={sheet:'LCP',width:11,
 headerRows:[['LOJA','UF','Forecast','Produto','PLAQUINHAS','INSUMOS RECEBIDOS?','OBSERVAÇÕES','','','Recebimento extra','']],
 rows:[{sourceRow:21,cells:['LJ 0006 - PÁTIO PAULISTA','SP','147','BALDE','', '', '','','','','']}]
};
const compactOpts={mode:'store',sheetIndex:1,
 rules:{4:{type:'boolean',required:true},5:{type:'boolean',required:true},
        6:{type:'text'},9:{type:'boolean',required:true}},answers:{},readonly:false};
const visibleCols=importCtx.campaignSheetDisplayColumns_(compactLayout,compactOpts);
assert.deepEqual(Array.from(visibleCols),[0,2,3,4,5,6,9],
 'Ocultar UF auxiliar e colunas vazias, mantendo respostas com chaves originais');
const compactWidths=visibleCols.map(j=>importCtx.campaignSheetColumnWidth_(compactLayout,j,compactOpts));
const compactMin=34+compactWidths.reduce((a,b)=>a+b,0);
assert.ok(compactMin<=1300,'Grade com oito colunas deve caber no espaço central comum');
assert.ok(compactWidths[0]>compactWidths[1]&&compactWidths[5]>compactWidths[2],
 'Largura de Loja e Observações maiores que forecast e quantidades');
const compactHtml=importCtx.campaignSheetTableHtml(compactLayout,compactOpts);
assert.ok(compactHtml.includes('bacio-sheet-compact-scroll')&&compactHtml.includes('<colgroup>'),
 'Tamanho e colunas responsivas devem estar no HTML');
assert.ok(compactHtml.includes('data-key="sheetcell_1_21_9"'),
 'Ocultar colunas vazias não deve renumerar células editáveis');
assert.ok(!compactHtml.includes('data-sheet-original-col="8"'),
 'Coluna vazia precisa desaparecer apenas da apresentação');
assert.ok(compactHtml.includes('data-sheet-original-col="9"'),
 'Campo permitido depois de coluna vazia precisa continuar presente');
assert.ok(compactHtml.includes('BALDE')&&compactHtml.includes('PÁTIO PAULISTA'),
 'Valores originais devem permanecer visíveis');
assert.ok(!compactHtml.includes('data-key="sheetcell_1_21_2"'),
 'Quantidade original continua bloqueada');

// BR-033: aparência e disposição reais das abas Crema (A + E-M, sem B-D).
assert.ok(rules.includes('BR-033'),'Banco de Regras precisa registrar a fidelidade com Excel');
const cremaLayout={
 sheet:'Para loja pedir - LCP e Op. Dup',width:13,
 headerRows:[
 ['','','','','ATENÇÃO: PEDIDO LOJA LCP E QUIOSQUE OP. DUPLA','','','','','','','',''],
 ['GELATO CREMA POSITANO 03/11 a 04/01','','','','Forecast em kgs 5,0% de Participação',
  'MP207030004541 GEMA DE OVO','MP207030004573 PASTA','MP207030005153 SABORIZANTE',
  'MP208030006244 COOKIES','PA001009001232 GELATO CREMA','PLAQUINHAS','INSUMOS RECEBIDOS?','OBSERVAÇÕES'],
 ['LOJA','UF','Produção','Tipo Op','','CAIXA C/12 DE 1 LITRO','POTE 220G','PACOTE 1,5 KG',
  'BALDE 3,5 KG','BALDE 3,6 KG','(Automático carga seca CD)','','']
 ],
 rows:[{sourceRow:4,cells:['LJ 0001 - OSCAR FREIRE - SP','SP Capital','LCP','Loja',
  '147','1','2','1','4','NÃO PEDIR','Sim','Não','Pedido parcial']}]
};
const originalIndexes=Array.from(importCtx.campaignSheetDisplayColumns_(cremaLayout,{}));
assert.deepEqual(originalIndexes,[0,4,5,6,7,8,9,10,11,12],
 'A vista padrão deve ser A, E-M, como na planilha Excel');
const reveal=Array.from(importCtx.campaignSheetDisplayColumns_(cremaLayout,{showAuxiliary:true}));
assert.deepEqual(reveal,[0,1,2,3,4,5,6,7,8,9,10,11,12],
 'Colunas auxiliares originais continuam recuperáveis');
const layoutHtml=importCtx.campaignSheetTableHtml(cremaLayout,{
 mode:'store',sheetIndex:0,rules:{10:{type:'boolean',required:true},11:{type:'boolean',required:true},12:{type:'text'}}
});
assert.ok(layoutHtml.includes('colspan="7"')||layoutHtml.includes('colspan="8"'),
 'Título de atenção tem que ficar mesclado, como no Excel');
assert.ok(!layoutHtml.includes('data-sheet-original-col="1"'),
 'UF auxiliar não deve ampliar a grade na vista padrão');
assert.ok(layoutHtml.includes('data-key="sheetcell_0_4_10"') &&
 layoutHtml.includes('data-key="sheetcell_0_4_11"') &&
 layoutHtml.includes('data-key="sheetcell_0_4_12"'),
 'Plaquinhas, insumos e observações mantêm os índices reais');
assert.ok(importCtx.campaignSheetTableHtml(cremaLayout,{}).includes('bacio-sheet-source-pill'),
 'Valores Sim/Não da planilha devem aparecer como pílulas coloridas na visão de leitura');
const autoLayout={sheet:'ITENS DE ENVIO AUTOMÁTICO',width:13,
 headerRows:[cremaLayout.headerRows[0],cremaLayout.headerRows[1],cremaLayout.headerRows[2]],
 rows:cremaLayout.rows,hiddenColumns:[1,2,3]};
assert.deepEqual(Array.from(importCtx.campaignSheetDisplayColumns_(autoLayout,{})),originalIndexes,
 'Importações com !cols ocultas precisam reproduzir a mesma disposição');
assert.ok(!layoutHtml.includes('bacio-sheet-row-label'),
 'Faixa redundante acima da planilha não existe no Excel');
console.log('OK — Crema exibe colunas A e E-M, cabeçalho mesclado e campos originais.');

console.log('OK — Larguras compactas, colunas vazias ocultas e chaves originais preservadas.');


// BR-034 — devolver resposta para ajuste/reprovação sem nota, preservando SLA e médias.
assert.ok(rules.includes('BR-034'),'Banco de Regras: estrelas opcionais não documentadas');
assert.ok(scripts.includes('function bindEvaluationRating_(') &&
  scripts.includes('function evaluationRatingSelection_('),
  'Avaliações reais e simuladas precisam aplicar a mesma validação de estrelas');
assert.ok(scripts.includes("rating.stars") && scripts.includes("Limpar nota"),
  'Permitir enviar e limpar nota opcional');
assert.ok(scripts.includes("i.stars==null?'Sem nota':starsText(i.stars)"),
  'Registros sem nota devem ser exibidos como Sem nota');
const evaluationStart=modern.indexOf('function evaluateDemandDelivery(');
const evaluationEnd=modern.indexOf('function getEvaluationWorkspace()',evaluationStart);
const msgStart=modern.indexOf('function evaluationMessageV2_(');
const msgEnd=modern.indexOf('function roundOneV2_(',msgStart);
assert.ok(evaluationStart>=0&&evaluationEnd>evaluationStart&&msgStart>=0&&msgEnd>msgStart);
let savedReview=null,notice='';
const evaluationCtx=vm.createContext({
 getCurrentAuthContext_:()=>({email:'coord@bdil.com.br',user:{role:'admin',nome:'Coordenação'}}),
 roleOf_:u=>u.role,
 getVisibleStores_:()=>[{id:'loja1'}],
 table_:(_name,fallback)=>fallback,
 supabaseRequest_:(url,method,payload)=>{
  if(url.includes('bacio_demanda_respostas')){
   if(method==='get')return [{id:'resp1',demanda_id:'d1',loja_id:'loja1',created_at:'2026-11-01T10:00:00Z'}];
   return [];
  }
  if(url.includes('bacio_demandas'))return [{id:'d1',ativa:true,titulo:'Crema',prazo_sla:'2026-11-01T11:00:00Z'}];
  if(url.includes('bacio_avaliacoes')){
   if(method!=='post')throw new Error('Unexpected review operation');
   savedReview=payload;return [payload];
  }
  throw new Error('Unrecognized API call '+url);
 },
 notifyStoreUsersV2_:(_id,_title,message)=>{notice=message;},
 evaluationTitleV2_:status=>status,
 v2NiceNameFromEmail_:mail=>mail,
 console
});
vm.runInContext(modern.slice(msgStart,msgEnd)+'\n'+modern.slice(evaluationStart,evaluationEnd),evaluationCtx);
const makeReview=(status,stars)=>evaluationCtx.evaluateDemandDelivery({
 responseId:'resp1',demandaId:'d1',lojaId:'loja1',status,stars,
 comment:'Verificar a confirmação dos insumos.'
});
makeReview('ajuste_necessario',null);
assert.equal(savedReview.estrelas,null,'Ajustes não exigem estrelas');
assert.ok(savedReview.comentario.includes('insumos'),'Feedback precisa continuar salvo');
assert.ok(notice.includes('Verificar a confirmação') && !notice.includes('Nota:'),
 'Notificação com ajuste sem nota não deve dizer Nota: null/5');
makeReview('reprovada',null);
assert.equal(savedReview.estrelas,null,'Reprovação sem nota não pode virar zero');
assert.throws(()=>makeReview('aprovada',null),/Para aprovar, selecione uma nota/,
 'Aprovação ainda exige 1 a 5 estrelas');
assert.throws(()=>makeReview('ajuste_necessario',9),/nota deve ser de 1 a 5/,
 'Nota opcional preenchida precisa ser válida');
makeReview('ajuste_necessario',3);
assert.equal(savedReview.estrelas,3,'Nota opcional informada deve ser preservada');
makeReview('aprovada',5);
assert.equal(savedReview.estrelas,5,'Aprovação com nota deve funcionar');
assert.ok(notice.includes('Nota: 5/5'),'Notificação aprovada preserva estrelas');
const evalBuilderStart=modern.indexOf('function buildEvaluationWorkspaceV2_(');
const evalBuilderStop=modern.indexOf('function mapEvaluationRowV2_(',evalBuilderStart);
const mapStop=modern.indexOf('function evaluationTitleV2_(',evalBuilderStop);
const metricsCtx=vm.createContext({
 getVisibleStores_:()=>[{id:'loja1',nome:'LJ 0006'}],
 isConectaTestStoreId_:id=>String(id)==='TESTE_CONECTA',
 storeLabelV2_:store=>store.nome||'Loja',
 table_:(_name,fallback)=>fallback,
 safeSupabaseSelect_:url=>{
  if(url.includes('bacio_demandas'))return [{id:'d1',titulo:'Crema',ativa:true}];
  if(url.includes('bacio_avaliacoes'))return [
   {id:'a1',resposta_id:'r1',demanda_id:'d1',loja_id:'loja1',estrelas:5,status:'aprovada',sla_cumprido:true},
   {id:'a2',resposta_id:'r2',demanda_id:'d1',loja_id:'loja1',estrelas:null,status:'ajuste_necessario',sla_cumprido:true}
  ];
  return [];
 }
});
vm.runInContext(modern.slice(evalBuilderStart,mapStop),metricsCtx);
vm.runInContext(modern.slice(modern.indexOf('function roundOneV2_('),
 modern.indexOf('/* ======================================================================\n * CALENDÁRIO',modern.indexOf('function roundOneV2_('))),metricsCtx);
const m=metricsCtx.buildEvaluationWorkspaceV2_({role:'admin'});
assert.equal(m.summary.total,2,'Ajustes continuam no total de avaliações');
assert.equal(m.summary.avgStars,5,'Uma devolução sem nota não reduz a média');
assert.equal(m.stores[0].avgStars,5,'Média por loja considera só notas preenchidas');
assert.equal(m.items[1].stars,null,'Dados sem nota não são convertidos em zero');
assert.equal(m.summary.slaRate,100,'SLA mantém respostas sem estrelas');
console.log('OK — Avaliações sem estrelas preservam feedback, notificação, SLA e médias.');


// BR-035/036/037 — painel visual removido, correção real e segurança de reenvio.
assert.ok(rules.includes('BR-035')&&rules.includes('BR-036')&&rules.includes('BR-037'),
 'Banco de Regras precisa cobrir devolução e Central sem Aprovações');
assert.ok(!index.includes('id="centralApprovalArea"') &&
 !scripts.includes("getElementById('centralApprovalArea')"),
 'O bloco de Aprovações da Central deve desaparecer da interface');
assert.ok(scripts.includes("approveDepartmentRequest(") &&
 scripts.includes("decideDepartmentRequestUI(") &&
 backend.includes('function setDemandStatus('),
 'A aprovação real não pode ser removida de outros módulos');
assert.ok(scripts.includes("Revisar resposta")&&
 scripts.includes("Aguardando correção")&&
 scripts.includes("response.feedback")&&
 scripts.includes("function openNotificationDemand("),
 'Notificação e Comunicados precisam abrir a solicitação original e mostrar feedback');
assert.ok(modern.includes("assertStoreResponseResubmissionAllowed_(input.demandaId,lojaId)") &&
 backend.includes("assertStoreResponseResubmissionAllowed_(input.demandaId,lojaId)") &&
 backend.includes("validateSheetCellAnswers_(input.answers||{},detail)"),
 'Ambos os logins da loja devem passar por autorização e validação de células no servidor');
assert.ok(modern.includes("String(evaluationMap[key].resposta_id||'')===String(r.id)") &&
 modern.includes('Esta resposta foi substituída por uma correção.'),
 'Resposta reenviada precisa voltar a aguardar nova avaliação e bloquear avaliação de versão antiga');

const notificationHelpers=backend.slice(backend.indexOf('function mapBacioNotification_('),
 backend.indexOf('function getContextLabel_('));
assert.ok(notificationHelpers.includes('function buildStoreCorrectionNotices_('));
let latestStatus='ajuste_necessario';
const noticeCtx=vm.createContext({
 table_:(_name,fallback)=>fallback,
 supabaseRequest_:(_url,method)=>{assert.equal(method,'get');return [{status:latestStatus}];},
 safeSupabaseSelect_:url=>{
  assert.ok(url.includes('loja_id=eq.s1'),'Feedback filtrado pela loja no servidor');
  return [{resposta_id:'r1',status:'ajuste_necessario',comentario:'Conferir a plaquinha.'}];
 },
 formatShortDate_:()=> '01/11',
 console
});
vm.runInContext(notificationHelpers,noticeCtx);
const aDemand={id:'d1',titulo:'Crema',ativa:true,status:'active'};
const aResponse={id:'r1',demanda_id:'d1',loja_id:'s1',
 status:'ajuste_necessario',created_at:'2026-11-01T14:00:00Z'};
let notices=noticeCtx.buildStoreCorrectionNotices_([aDemand],[aResponse],[{id:'s1'}]);
assert.equal(notices.length,1,'Loja deve ver sua pendência');
assert.equal(notices[0].kindLabel,'Aguardando correção');
assert.equal(notices[0].demandId,'d1');
assert.equal(notices[0].excerpt,'Conferir a plaquinha.');
assert.equal(noticeCtx.buildStoreCorrectionNotices_([aDemand],[aResponse],[{id:'s2'}]).length,0,
 'Loja diferente não deve receber dados nem feedback');
assert.equal(noticeCtx.buildStoreCorrectionNotices_([{...aDemand,ativa:false}],[aResponse],[{id:'s1'}]).length,0,
 'Solicitação inativa não deve exibir aviso operacional');
assert.equal(noticeCtx.buildStoreCorrectionNotices_([aDemand],[{...aResponse,status:'respondido',id:'r2'}],[{id:'s1'}]).length,0,
 'Após reenviar, não mostrar pendência antiga em Comunicados');
assert.equal(noticeCtx.buildStoreCorrectionNotices_([aDemand],[{...aResponse,status:'reprovada'}],[{id:'s1'}]).length,1,
 'Reprovação também deve liberar o fluxo de correção');
const mapped=noticeCtx.mapBacioNotification_({
 id:'n1',titulo:'Ajuste solicitado',mensagem:'Feedback [[bacio-demand:d1]]',lida:false
});
assert.equal(mapped.demandId,'d1','Notificação deve vincular solicitação original');
assert.equal(mapped.message,'Feedback','Não exibir identificador interno à loja');
assert.equal(mapped.requiresCorrection,true);
latestStatus='aprovada';
assert.throws(()=>noticeCtx.assertStoreResponseResubmissionAllowed_('d1','s1'),
 /após a gestão solicitar correção/,'Uma resposta aprovada não pode ser reenviada');
latestStatus='respondido';
assert.throws(()=>noticeCtx.assertStoreResponseResubmissionAllowed_('d1','s1'),
 /após a gestão solicitar correção/,'Não aceitar duplicação enquanto aguarda avaliação');
latestStatus='reprovada';
assert.doesNotThrow(()=>noticeCtx.assertStoreResponseResubmissionAllowed_('d1','s1'),
 'Reprovação permite corrigir');
latestStatus='ajuste_necessario';
assert.doesNotThrow(()=>noticeCtx.assertStoreResponseResubmissionAllowed_('d1','s1'),
 'Solicitação de ajuste permite corrigir');
console.log('OK — Central sem painel visual, aprovação preservada, devolução e segurança de reenvios.');

console.log('OK — Banco de Regras: chat, solicitações, exclusão lógica, planilhas, abas privadas e permissões.');



/* BR-042 — Relatórios de avaliações por demanda, seguros e sem escrita. */
const reportSlice=modern.slice(modern.indexOf('function getDemandReportsWorkspace()'));
assert.ok(reportSlice.includes('function buildDemandReportsWorkspaceV2_('),'Relatórios no servidor');
const reportFixtureDemands=[
 {id:'d-real',titulo:'Conferência Real',descricao:'Conferir produtos',tipo:'demanda',status:'active',ativa:true,loja_ids:['1'],cronograma:{departamentoSolicitante:'Qualidade',tipoSolicitacao:'Auditoria'},publicada_em:'2026-11-02',created_at:'2026-11-02'},
 {id:'d-test',titulo:'Teste',tipo:'demanda',status:'active',ativa:true,loja_ids:['TESTE_CONECTA'],created_at:'2026-11-02'},
 {id:'d-empty',titulo:'Sem respostas',tipo:'demanda',status:'active',ativa:true,loja_ids:['1'],created_at:'2026-11-01'},
 {id:'d-draft',titulo:'Rascunho',tipo:'demanda',status:'draft',ativa:true,loja_ids:['1']},
 {id:'d-note',titulo:'Comunicado',tipo:'comunicado',status:'active',ativa:true,loja_ids:['1']},
 {id:'d-old',titulo:'Excluída',tipo:'demanda',ativa:false,loja_ids:['1']}
];
const reportFixtureEvals=[
 {id:'a1',demanda_id:'d-real',loja_id:'1',resposta_id:'r1',status:'ajuste_necessario',estrelas:null,sla_cumprido:true},
 {id:'a2',demanda_id:'d-real',loja_id:'2',resposta_id:'r2',status:'aprovada',estrelas:5,sla_cumprido:false},
 {id:'a3',demanda_id:'d-test',loja_id:'TESTE_CONECTA',resposta_id:'rt',status:'aprovada',estrelas:5,sla_cumprido:true},
 {id:'a4',demanda_id:'d-old',loja_id:'1',resposta_id:'rold',status:'aprovada',estrelas:5,sla_cumprido:true}
];
const reportFixtureResponses=[
 {id:'r-old',demanda_id:'d-real',loja_id:'1',status:'ajuste_necessario',created_at:'2026-11-01T08:00:00Z'},
 {id:'r1',demanda_id:'d-real',loja_id:'1',status:'respondido',created_at:'2026-11-02T08:00:00Z'},
 {id:'r2',demanda_id:'d-real',loja_id:'2',status:'respondido',created_at:'2026-11-01T09:00:00Z'},
 {id:'rt',demanda_id:'d-test',loja_id:'TESTE_CONECTA',status:'respondido',created_at:'2026-11-02T09:00:00Z'},
 {id:'rold',demanda_id:'d-old',loja_id:'1',status:'respondido',created_at:'2026-11-02T09:00:00Z'}
];
const reportQueries=[];
const reportCtx=vm.createContext({
 getCurrentAuthContext_:()=>({user:{role:'admin'}}),
 roleOf_:u=>u.role,
 getVisibleStores_:()=>[
  {id:'1',nome:'LJ 0001',codigo:'0001'},
  {id:'2',nome:'LJ 0002',codigo:'0002'},
  {id:'TESTE_CONECTA',nome:'LOJA TESTE',codigo:'TESTE'}],
 table_:(_key,def)=>def,
 safeSupabaseSelect_:url=>{
  reportQueries.push(url);
  if(url.includes('bacio_demandas'))return reportFixtureDemands.filter(d=>d.ativa===true);
  if(url.includes('bacio_avaliacoes'))return reportFixtureEvals;
  if(url.includes('bacio_demanda_respostas'))return reportFixtureResponses;
  return [];
 },
 getTargetStoreIds_:(d,ids)=>(d.loja_ids||[]).filter(id=>ids.includes(id)),
 isConectaTestStoreId_:id=>String(id)==='TESTE_CONECTA',
 normalizeJsonObject_:v=>v||{},
 isConectaTestDemand_:d=>(d.loja_ids||[]).length===1&&d.loja_ids[0]==='TESTE_CONECTA',
 mapEvaluationRowV2_:(a,d,s)=>({
  id:a.id,responseId:a.resposta_id,storeId:a.loja_id,storeLabel:s.nome,
  status:a.status,stars:a.estrelas,slaMet:a.sla_cumprido,
  evaluatedAt:'2026-11-02T10:00:00Z',comment:'',demandId:a.demanda_id}),
 roundOneV2_:n=>Math.round(10*n)/10,
 Date
});
vm.runInContext(reportSlice,reportCtx);
assert.throws(()=>reportCtx.buildDemandReportsWorkspaceV2_({role:'loja'}),/não autorizado/,
 'Lojas não podem consultar relatórios administrativos');
const reports=reportCtx.getDemandReportsWorkspace();
assert.equal(reports.groups.length,3,'Apenas demandas publicadas, incluindo as sem resposta, entram no relatório');
assert.ok(reports.groups.find(g=>g.id==='d-empty'&&g.total===0&&g.respondedStores===0),'Demanda ainda não respondida deve aparecer');
assert.ok(!reports.groups.some(g=>['d-draft','d-note','d-old'].includes(g.id)),'Rascunhos, comunicados e excluídas ficam de fora');
const ops=reports.groups.find(g=>!g.isHomologacao),testReport=reports.groups.find(g=>g.isHomologacao);
assert.equal(ops.id,'d-real');
assert.equal(ops.department,'Qualidade');
assert.equal(ops.requestCategory,'Auditoria');
assert.equal(ops.description,'Conferir produtos');
assert.equal(ops.publishedAt,'2026-11-02');
assert.equal(ops.total,2);
assert.equal(ops.approved,1);
assert.equal(ops.adjustment,1);
assert.equal(ops.avgStars,5,'Nota ausente nunca é zero');
assert.equal(ops.slaRate,50);
assert.equal(ops.respondedStores,2);
assert.equal(testReport.id,'d-test');
assert.equal(testReport.total,1);
assert.equal(ops.items.find(i=>i.id==='a2').responseHistory.length,1);
const returnRow=ops.items.find(i=>i.id==='a1');
assert.equal(returnRow.responseHistory.length,2,'Histórico de reenvios visível por avaliação');
assert.ok(reportQueries.length===3 && reportQueries.every(url=>url.startsWith('/rest/v1/')) && !reportSlice.includes('supabaseRequest_('), 'Relatórios só fazem consultas de leitura');
const reportView=fs.readFileSync(path.join(__dirname,'../../Scripts.html'),'utf8');
const reportIndex=fs.readFileSync(path.join(__dirname,'../../Index.html'),'utf8');
assert.ok(!reportView.includes('REPORTS_MODE') &&
 !reportIndex.includes('reportOperationMode') &&
 !reportIndex.includes('reportTestMode'),
 'Relatórios exibem uma lista única, sem abas Operação/Homologação');
assert.ok(reportView.includes('openDemandReportEvaluation(') &&
 reportView.includes('getDemandReportsWorkspace()') &&
 reportView.indexOf("detail('Assunto'")>=0 &&
 reportView.indexOf("detail('Assunto'")<reportView.indexOf("Avaliações das lojas") &&
 reportView.includes("detail('Departamento'") &&
 reportView.includes('report-test-label'),
 'Dados da demanda vêm antes de avaliações e homologação tem marcador discreto');
assert.ok(reportIndex.includes('id="page-relatorios"')&&
 reportIndex.includes('id="reportsNavBtn"')&&
 reportView.includes("page==='relatorios'&&CURRENT_ROLE!=='admin'"),
 'Página de Relatórios protegida na navegação');
assert.ok(rules.includes('BR-042')&&rules.includes('BR-043'),'Banco de Regras inclui relatório por demanda e novo layout');
console.log('OK — Relatórios por demanda, histórico de reenvios, SLA, homologação e autorização.');

// Contrato de homologação separada de lojas reais.
require('./verify-homologacao.cjs');

// BR-044: Criação manual em formato planilha, relatório ou formulário.
require('./verify-new-builders.cjs');

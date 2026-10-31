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
for(const rule of ['BR-011','BR-012','BR-013','BR-014','BR-015','BR-016','BR-017','BR-018']){
 assert.ok(rules.includes(rule), 'Regra não documentada: '+rule);
}
const start=scripts.indexOf('function parseMultiSheetCampaign(file,done,fail){');
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
console.log('OK — Banco de Regras: chat, solicitações, exclusão lógica, planilhas, abas privadas e permissões.');


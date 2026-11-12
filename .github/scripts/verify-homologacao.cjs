'use strict';
/**
 * Testes de isolamento da unidade de homologação.
 * Somente dublês de consulta/notificação; nunca modifica o banco real.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backend = fs.readFileSync(path.join(__dirname,'../../Supabase.js'),'utf8');
const features = fs.readFileSync(path.join(__dirname,'../../Features_V2.js'),'utf8');
const emails = fs.readFileSync(path.join(__dirname,'../../EmailCobrancas.js'),'utf8');
const testId = 'TESTE_CONECTA', realId = '1';
const admin = {role:'admin',email:'admin@bdil.com.br'};
const fakeUser = {role:'loja',loja_id:testId,email:'conectab2026@gmail.com'};
const realUser = {role:'loja',loja_id:realId,email:'lj0001@bdil.com.br'};
const stores = [
 {id:realId,nome:'LJ 0001 - OSCAR FREIRE',ativa:true},
 {id:testId,nome:'LOJA TESTE - HOMOLOGAÇÃO',ativa:true}
];
const notifications = [];
const ctx = vm.createContext({
 console,
 table_:(_n,fallback)=>fallback,
 roleOf_:u=>u.role,
 isDepartmentUser_:()=>false,
 parseJsonObject_:()=>({}),
 operationScopeMatchesStore_:()=>false,
 supabaseRequest_:(url,method,data)=>{
   if(method==='get' && url.indexOf('bacio_lojas')>=0)return stores;
   if(method==='get' && url.indexOf('bacio_usuarios')>=0)return [admin,realUser,fakeUser].map(u=>({...u,ativo:true}));
   if(method==='post' && url.indexOf('bacio_notificacoes')>=0){notifications.push(...data);return [];}
   throw Error('Operação não simulada: '+method+' '+url);
 },
 encodeURIComponent, Date
});
const scopeStart=backend.indexOf('function isConectaTestStoreId_(');
const scopeEnd=backend.indexOf('function latestResponsesByStore_(',scopeStart);
assert.ok(scopeStart>0&&scopeEnd>scopeStart,'Helpers de isolamento presentes');
vm.runInContext(backend.slice(scopeStart,scopeEnd),ctx);
assert.equal(ctx.isConectaTestStoreId_(testId),true);
assert.equal(ctx.isConectaTestStoreId_(realId),false);
assert.equal(ctx.getVisibleStores_(fakeUser).map(s=>s.id).join(','),testId,'Login de teste só pode ver loja teste');
assert.equal(ctx.getVisibleStores_(realUser).map(s=>s.id).join(','),realId,'Login oficial não pode ver loja teste');
assert.equal(ctx.demandaVisivelNoEscopo_({loja_ids:[]},[testId]),false,'Publicação geral não aparece no login de teste');
assert.equal(ctx.demandaVisivelNoEscopo_({loja_ids:[]},[realId]),true,'Publicação geral continua visível para loja real');
assert.equal(ctx.demandaVisivelNoEscopo_({loja_ids:[testId]},[realId]),false,'Loja real não enxerga demanda de teste');
assert.equal(ctx.demandaVisivelNoEscopo_({loja_ids:[testId]},[testId]),true,'Teste direcionado aparece na loja teste');
assert.equal(ctx.getTargetStoreIds_({loja_ids:[]},[realId,testId]).join(','),realId,'Total geral exclui homologação');
assert.equal(ctx.getTargetStoreIds_({loja_ids:[testId]},[realId,testId]).join(','),testId,'Admin consegue direcionar teste');
assert.equal(ctx.isConectaTestDemand_({loja_ids:[testId]}),true);
assert.equal(ctx.isConectaTestDemand_({loja_ids:[]}),false);
const notifyStart=backend.indexOf('function notifyDemandPublished_(');
const notifyEnd=backend.indexOf('function decideDepartmentRequest(',notifyStart);
assert.ok(notifyStart>0&&notifyEnd>notifyStart);
vm.runInContext(backend.slice(notifyStart,notifyEnd),ctx);
const msg={title:'Validação isolada',type:'demanda',department:'Operações'};
ctx.notifyDemandPublished_({user:admin},{...msg,lojaIds:[testId]});
let addresses=notifications.map(n=>n.usuario_email);
assert.ok(addresses.includes(fakeUser.email),'Acesso teste recebe aviso exclusivo');
assert.ok(!addresses.includes(realUser.email),'Jamais enviar o teste ao login oficial');
notifications.length=0;
ctx.notifyDemandPublished_({user:admin},{...msg,lojaIds:[]});
addresses=notifications.map(n=>n.usuario_email);
assert.ok(!addresses.includes(fakeUser.email),'Acesso teste não recebe publicação geral');
assert.ok(addresses.includes(realUser.email),'Publicação geral preservada para lojas reais');
assert.ok(backend.includes("requestedStoreIds.some(isConectaTestStoreId_)") &&
 backend.includes("requestedStoreIds.length!==1 || roleOf_(auth.user)!=='admin"),
 'Servidor impede mistura de homologação com lojas reais e exige admin');
assert.ok(features.includes("lojas.filter(function(l){return !isConectaTestStoreId_(l.id);}).map("),
 'Robô de demandas gerais exclui a loja teste');
assert.ok(features.includes(").filter(function(store){return !isConectaTestStoreId_(store.id);});"),
 'Avisos de calendário geral excluem a loja teste');
assert.ok(emails.includes(".filter(function(s){return !isConectaTestStoreId_(s.id);});"),
 'E-mail automático de pendências ignora loja teste');
assert.ok(backend.includes("isHomologacao: isConectaTestDemand_(d)") &&
 backend.includes("pending: metricTasks.filter(") &&
 backend.includes("campaigns: metricCampaigns.length"),
 'KPIs do dashboard ignoram dados de teste');
assert.ok(features.includes("var operationalItems=items.filter(function(item){return !isConectaTestStoreId_(item.storeId);});") &&
 features.includes("operationalItems.length"),
 'KPIs da avaliação ignoram testes sem ocultá-los da gestão');
const scripts=fs.readFileSync(path.join(__dirname,'../../Scripts.html'),'utf8');
assert.ok(scripts.includes("var operationalItems=items.filter(function(i){return i.isHomologacao!==true;});"),
 'KPIs de solicitações ignoram testes');
console.log('OK — Homologação isolada de lojas, notificações, cobranças e indicadores.');

/** Uma importação da produção pode ser experimentada sem copiar nenhuma linha real. */
const testSheetStart=features.indexOf('function conectaTestSheetSectionsV2_(');
const testSheetEnd=features.indexOf('function getDemandDetailForStoreV2_(',testSheetStart);
assert.ok(testSheetStart>=0 && testSheetEnd>testSheetStart,'Gerador de planilha fictícia na API da loja');
const sheetCtx=vm.createContext({
  isConectaTestStoreId_:id=>String(id)===testId,
  isConectaTestDemand_:d=>JSON.stringify(d.loja_ids)==='["'+testId+'"]',
  normalizeJsonObject_:v=>v||{}
});
vm.runInContext(features.slice(testSheetStart,testSheetEnd),sheetCtx);
const header=[['LOJA','UF','INSUMOS RECEBIDOS?','OBSERVAÇÕES']];
const layout={sheet:'Crema',width:4,headerRows:header,hiddenColumns:[1],columnWidths:[220,60,110,200],
 rows:[{sourceRow:4,cells:['LJ 0001 - OSCAR FREIRE','SP','Sim','Pedido 123']}]};
const imported={id:'d1',loja_ids:[testId],model_source:'spreadsheet',
 import_meta:{perStore:{'0001':[{'store':'LJ 0001 - OSCAR FREIRE'}]},
 sheetLayouts:[layout],sheets:[{sheet:'Crema'}],
 editableColumns:{Crema:{2:{type:'boolean',required:true},3:{type:'text',required:false}}}}};
let generated=sheetCtx.conectaTestSheetSectionsV2_(imported,{id:testId,codigo:'TESTE'});
assert.equal(generated.length,1,'Deve criar uma linha por aba para a loja fictícia');
assert.equal(generated[0].rowCells[0],'LOJA TESTE - HOMOLOGAÇÃO');
assert.deepEqual(Array.from(generated[0].rowCells).slice(1),['','',''],
 'Não copiar quantidade, dados da loja real nem respostas anteriores');
assert.deepEqual(Array.from(generated[0].sheetHeaders[0]),header[0],
 'Cabeçalhos e campos da planilha são preservados');
assert.equal(generated[0].sourceRow,90000,'Identificador virtual não coincide com linhas reais');
assert.equal(generated[0].hiddenColumns[0],1,'Respeitar colunas auxiliares ocultas');
assert.equal(sheetCtx.conectaTestSheetSectionsV2_(imported,{id:realId,codigo:'1'}).length,0,
 'O gerador nunca altera a visualização da loja real');
assert.equal(sheetCtx.conectaTestSheetSectionsV2_({...imported,loja_ids:[realId]},{id:testId}).length,0,
 'Planilha virtual só pode existir em solicitação isolada de homologação');
assert.ok(features.includes("selected=conectaTestSheetSectionsV2_(demanda,targetStores[0]);") &&
 features.includes("sections=conectaTestSheetSectionsV2_(d,store);"),
 'Visão da loja e avaliação administrativa devem usar a mesma planilha virtual');
assert.ok(backend.includes("String(d.status || 'active').toLowerCase() === 'draft'") &&
 features.includes("String(d.status || 'active').toLowerCase() !=="),
 'Demandas publicadas visíveis no bootstrap, rascunhos ocultos');
console.log('OK — Planilha fictícia, resposta e revisão isoladas, sem dados de lojas reais.');

/** Uma sessão já autenticada da loja deve prevalecer após atualizar a página. */
const sessionScripts=fs.readFileSync(path.join(__dirname,'../../Scripts.html'),'utf8');
assert.ok(sessionScripts.includes("persistStoreSession_();sessionStorage.setItem('bacio_force_password_login','1');AUTH_MODE='store'"),
 'Login de loja não pode voltar silenciosamente ao perfil corporativo ao atualizar');
assert.ok(sessionScripts.includes("persistStoreSession_();sessionStorage.setItem('bacio_force_password_login','1');var data=result.bootstrap"),
 'Renovação de sessão também mantém a preferência do login da loja');
console.log('OK — O perfil de teste permanece escolhido após atualização e renovação da sessão.');

/** BR-040: status da última resposta deve prevalecer sobre 100% respondido apenas para a loja. */
const stateSource=fs.readFileSync(path.join(__dirname,'../../Supabase.js'),'utf8');
const stateStart=stateSource.indexOf('function storeDemandReviewStatus_(');
const stateEnd=stateSource.indexOf('function buildCampaigns_(',stateStart);
assert.ok(stateStart>=0&&stateEnd>stateStart,'Fluxo de revisão disponível no código');
const stateCtx=vm.createContext({
 Date,
 normalizeJsonObject_:value=>value||{},
 isConectaTestDemand_:d=>(d.loja_ids||[]).length===1&&d.loja_ids[0]===testId,
 getTargetStoreIds_:(d,ids)=>(d.loja_ids||[]).filter(id=>ids.includes(id)),
 latestResponsesByStore_:(demandId,rows)=>{
   const byId={};
   rows.filter(r=>r.demanda_id===demandId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))
    .forEach(r=>{if(!byId[r.loja_id])byId[r.loja_id]=r;});
   return byId;
 },
 responseCountsAsCompleteV2_:row=>Boolean(row)&&!['ajuste_necessario','reprovada'].includes(row.status),
 timelineInfo_:(_d,count,total)=>({code:total>0&&count===total?'completed':'active',label:total>0&&count===total?'Concluída':'Em andamento'}),
 formatDeadline_:()=> 'Amanhã',
 sameDay_:()=>false,
 console
});
vm.runInContext(stateSource.slice(stateStart,stateEnd),stateCtx);
const storeDemand={id:'dteste',titulo:'Teste',descricao:'',tipo:'demanda',loja_ids:[testId],status:'active',ativa:true,cronograma:{}};
const storeCtx=[{id:testId,codigo:'TESTE'}];
const responseAt=(status,id,at)=>({id,demanda_id:'dteste',loja_id:testId,status,created_at:at});
function inspectStoreStatus(rows,role='loja'){
  return {
    item:stateCtx.buildManagementItems_([storeDemand],rows,storeCtx,role)[0],
    task:stateCtx.buildTasks_([storeDemand],rows,storeCtx,role,{})[0]
  };
}
let change=inspectStoreStatus([responseAt('ajuste_necessario','r1','2026-11-01T18:00:00Z')]);
assert.equal(change.item.timelineStatus,'ajuste_necessario','Ajuste aparece no status da Central');
assert.equal(change.item.timelineLabel,'Ajuste necessário','Rótulo de correção visível');
assert.equal(change.task.statusLabel,'Ajuste necessário','Ação pendente no resumo da loja');
assert.equal(change.task.actionLabel,'Revisar resposta','Encaminha a loja à revisão');
assert.notEqual(change.task.status,'success','Correção não pode ser tratada como concluída');
assert.equal(change.item.completedCount,0,'Correção não conta como resposta completa');
let adminView=inspectStoreStatus([responseAt('ajuste_necessario','r1','2026-11-01T18:00:00Z')],'admin');
assert.equal(adminView.item.timelineStatus,'completed','Indicadores administrativos permanecem com status de progresso');
let waiting=inspectStoreStatus([
  responseAt('ajuste_necessario','r1','2026-11-01T18:00:00Z'),
  responseAt('respondido','r2','2026-11-01T18:30:00Z')
]);
assert.equal(waiting.item.timelineStatus,'aguardando_analise','Novo envio aguarda avaliação');
assert.equal(waiting.item.timelineLabel,'Aguardando análise');
assert.equal(waiting.task.status,'success','A entrega reenviada não exige ação da loja');
let rejected=inspectStoreStatus([responseAt('reprovada','r1','2026-11-01T18:00:00Z')]);
assert.equal(rejected.item.timelineStatus,'reprovada','Reprovação mostra status próprio');
assert.equal(rejected.task.actionLabel,'Revisar resposta','Reprovação também permite corrigir');
let approved=inspectStoreStatus([responseAt('aprovada','r1','2026-11-01T18:00:00Z')]);
assert.equal(approved.item.timelineStatus,'completed','Aprovada permanece concluída');
let notAnswered=inspectStoreStatus([]);
assert.equal(notAnswered.item.timelineStatus,'active','Sem resposta mantém status anterior');
const storeUi=fs.readFileSync(path.join(__dirname,'../../Scripts.html'),'utf8');
const storeIndex=fs.readFileSync(path.join(__dirname,'../../Index.html'),'utf8');
assert.ok(storeUi.includes("st!=='aguardando_analise'") &&
 storeUi.includes("st==='aguardando_analise'") &&
 storeUi.includes("ajuste_necessario:'Ajuste necessário'"),
 'Abas Para responder/Respondidas e rótulo da Central seguem o novo status');
assert.ok(storeIndex.includes('<option value="ajuste_necessario">Ajuste necessário</option>') &&
 storeIndex.includes('<option value="aguardando_analise">Aguardando análise</option>'),
 'Filtro de status aceita revisão e análise');
console.log('OK — Ajuste necessário aparece no status, reenvio aguarda análise e demais perfis preservados.');

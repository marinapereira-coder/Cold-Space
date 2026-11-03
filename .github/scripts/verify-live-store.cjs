'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../..',name),'utf8');
const server=read('Features_V2.js'),backend=read('Supabase.js'),client=read('Scripts.html');
const start=server.indexOf('function getStoreLiveSignal('),end=server.indexOf('function getStoreAuthContext_(',start);
assert.ok(start>0&&end>start,'Endpoint de sinal seguro presente');
let queries=[],requested=0,actor={role:'loja',email:'conectab2026@gmail.com'};
const auth=vm.createContext({
 getStoreAuthContext_:token=>{assert.equal(token,'token-test');requested++;return {user:actor,email:actor.email};},
 roleOf_:u=>u.role,table_:(_k,f)=>f,encodeURIComponent,
 supabaseRequest_:(url,method)=>{queries.push({url,method});return [{id:'novo-aviso'}];}
});
vm.runInContext(server.slice(start,end),auth);
assert.equal(auth.getStoreLiveSignal('token-test').latestNotificationId,'novo-aviso');
assert.ok(queries[0].url.includes('usuario_email=eq.conectab2026%40gmail.com'));
assert.ok(queries[0].url.includes('select=id')&&queries[0].url.includes('limit=1'));
assert.equal(queries[0].method,'get','Só consulta, não publica nem altera avisos');
actor={role:'admin',email:'admin@bdil.com.br'};
assert.throws(()=>auth.getStoreLiveSignal('token-test'),/somente para o acesso de loja/);
assert.equal(queries.length,1,'Acesso não-loja é negado sem consulta');
const mapStart=backend.indexOf('function mapBacioNotification_('),mapEnd=backend.indexOf('function getResponseCorrectionFeedback_(',mapStart);
assert.ok(mapStart>=0&&mapEnd>mapStart);
const mapContext=vm.createContext({});
vm.runInContext(backend.slice(mapStart,mapEnd),mapContext);
const publication=mapContext.mapBacioNotification_({id:'a',titulo:'Nova solicitação publicada',
 mensagem:'Nova demanda publicada: Conferência [[bacio-demand:d123]]',lida:false});
assert.equal(publication.demandId,'d123');
assert.equal(publication.requiresCorrection,false,'Abertura da nova demanda não é revisão');
assert.equal(publication.message,'Nova demanda publicada: Conferência');
const correction=mapContext.mapBacioNotification_({titulo:'Ajuste solicitado',
 mensagem:'Revise. [[bacio-demand:d123]]'});
assert.equal(correction.requiresCorrection,true,'Correção continua clicável');
assert.ok(backend.includes("message+=' [[bacio-demand:'+demandId+']]'"),
 'Novas publicações devem levar o ID direto da demanda');
const uStart=client.indexOf('function stopStoreLiveSync_('),uEnd=client.indexOf('function refreshBootstrap(page){',uStart);
assert.ok(uStart>0&&uEnd>uStart,'Ciclo de sincronização disponível');
let signalCalls=0,fullCalls=0,renders=[],toasts=[],callbacks=[],timerId=0;
const storeUpdated={user:{role:'loja'},notifications:[
 {id:'novo-aviso',title:'Nova solicitação publicada',demandId:'d123',read:false},
 {id:'antigo',title:'Antiga',read:true}
],managementItems:[{id:'d123',title:'Conferência'}],tasks:[{id:'d123'}],campaigns:[{id:'d123'}],
 summary:{unread:1},announcements:[]};
const runner={
 withSuccessHandler(success){return {
  withFailureHandler(failure){return {
   getStoreLiveSignal(token){assert.equal(token,'token-test');signalCalls++;success({latestNotificationId:'novo-aviso'});},
   getStoreBootstrap(token){assert.equal(token,'token-test');fullCalls++;success(storeUpdated);},
   storeRefreshSession(){throw Error('Renovação não deveria ser necessária');}
  }}
 }}
};
const ui=vm.createContext({
 APP_DATA:{notifications:[{id:'antigo',title:'Antiga',read:true}],managementItems:[],tasks:[],campaigns:[]},
 AUTH_MODE:'store',CURRENT_ROLE:'loja',STORE_ACCESS_TOKEN:'token-test',STORE_REFRESH_TOKEN:'refresh-test',
 STORE_LIVE_TIMER:null,STORE_LIVE_GENERATION:0,STORE_LIVE_LOADING:false,
 STORE_LIVE_SIGNAL_ID:'',STORE_LIVE_LAST_CHECK:0,STORE_LIVE_LAST_FULL_REFRESH:0,STORE_LIVE_POLL_MS:25000,
 google:{script:{run:runner}},
 document:{hidden:false},
 setTimeout:fn=>{callbacks.push(fn);return ++timerId;},clearTimeout:()=>{},
 renderHome:()=>renders.push('home'),renderCampaignManagement:()=>renders.push('demandas'),
 renderNotices:()=>renders.push('comunicados'),renderNotifications:()=>renders.push('sino'),
 renderAgenda:()=>renders.push('agenda'),showToast:msg=>toasts.push(msg),
 sessionStorage:{setItem(){}},console,Date
});
vm.runInContext(client.slice(uStart,uEnd),ui);
ui.startStoreLiveSync_();
assert.equal(signalCalls,0,'Primeiro carregamento não consulta novamente imediatamente');
ui.pollStoreLiveUpdates_();
assert.equal(signalCalls,1);
assert.equal(fullCalls,1,'Nova notificação atualiza demandas sem F5');
assert.ok(renders.includes('demandas')&&renders.includes('sino')&&renders.includes('home'));
assert.equal(ui.APP_DATA.managementItems[0].id,'d123');
assert.ok(toasts.some(s=>s.includes('Nova solicitação recebida')));
assert.ok(!client.slice(uStart,uEnd).includes('startApp(data)'), 'Sincronização não deve fechar formulários');
ui.document.hidden=true;
ui.pollStoreLiveUpdates_();
assert.equal(signalCalls,1,'Aba oculta não faz consulta de rede');
ui.stopStoreLiveSync_();
assert.equal(ui.STORE_LIVE_TIMER,null,'Sair da loja encerra verificações');
assert.ok(client.includes("document.addEventListener('visibilitychange',handleStoreLiveVisibility_)") &&
 client.includes("window.addEventListener('focus',handleStoreLiveVisibility_)"),
 'A loja deve buscar atualizações ao voltar à aba');
assert.ok(client.includes("function clearStoreSession(){stopStoreLiveSync_();"),
 'Logout deve encerrar chamadas automáticas');
console.log('OK — Demanda/notificação atualizada sem F5, link direto, sessão própria e sem perder formulário.');

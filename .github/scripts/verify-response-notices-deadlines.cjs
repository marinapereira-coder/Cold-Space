'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'../..',name),'utf8');
const client=read('Scripts.html'),backend=read('Supabase.js'),
 features=read('Features_V2.js'),markup=read('Index.html');
const mappedStart=backend.indexOf('function mapBacioNotification_(n) {'),
 mappedEnd=backend.indexOf('function getResponseCorrectionFeedback_(',mappedStart);
assert.ok(mappedStart>=0&&mappedEnd>mappedStart);
const mapping=vm.createContext({});
vm.runInContext(backend.slice(mappedStart,mappedEnd),mapping);
const newAnswer=mapping.mapBacioNotification_({
 id:'n1',titulo:'Nova resposta recebida',
 mensagem:'teste 3 · TESTE · LOJA TESTE - HOMOLOGAÇÃO [[bacio-demand:d123]] [[bacio-response:r123]]',
 lida:false,created_at:'2026-11-03T12:40:00Z'
});
assert.equal(newAnswer.responseId,'r123');
assert.equal(newAnswer.demandId,'d123');
assert.equal(newAnswer.requiresCorrection,false);
assert.equal(newAnswer.message,'teste 3 · TESTE · LOJA TESTE - HOMOLOGAÇÃO');
const correction=mapping.mapBacioNotification_({
 titulo:'Ajuste solicitado',mensagem:'Rever resposta [[bacio-demand:d123]]'
});
assert.equal(correction.demandId,'d123');
assert.equal(correction.requiresCorrection,true,'Avisos de correção continuam funcionando');
const publish=mapping.mapBacioNotification_({
 titulo:'Nova solicitação publicada',mensagem:'Teste [[bacio-demand:d123]]'
});
assert.equal(publish.requiresCorrection,false,'Publicação não deve virar correção');
// Na gestão, sempre buscar as respostas autorizadas mais recentes, sem abrir a demanda original.
const routeStart=client.indexOf('function openNotificationDemand(id){');
const routeEnd=client.indexOf('function markNotificationRead(id){',routeStart);
assert.ok(routeStart>=0&&routeEnd>routeStart);
const responses=[{responseId:'r123',demandaId:'d123',demandaTitle:'teste 3',
 storeLabel:'TESTE · LOJA TESTE - HOMOLOGAÇÃO',storeName:'LOJA TESTE - HOMOLOGAÇÃO'}];
let opened=[],pages=[],toasts=[],readIds=[],loads=0;
const ui=vm.createContext({
 APP_DATA:{notifications:[newAnswer],campaigns:[{id:'d123',title:'teste 3'}],managementItems:[]},
 RESPONSES_DATA:null,CURRENT_ROLE:'admin',
 markNotificationRead:id=>readIds.push(id),closeNotificationPanel:()=>{},
 showPage:page=>pages.push(page),
 loadResponses:callback=>{loads++;ui.RESPONSES_DATA={items:responses,stats:{}};callback();},
 openEvaluation:id=>opened.push(id),openDemandDetail:id=>opened.push('demand:'+id),
 showToast:message=>toasts.push(message),renderResponses:()=>{},
 document:{getElementById:id=>id==='responseDemandFilter'?
   {value:'all',options:[{value:'all'},{value:'d123'}]}:null}
});
vm.runInContext(client.slice(routeStart,routeEnd),ui);
ui.openNotificationDemand('n1');
assert.deepEqual(opened,['r123'],'Clique no sino abre a resposta, não a solicitação');
assert.ok(pages.includes('respostas'));
assert.deepEqual(readIds,['n1'],'Aviso é marcado como lido');
opened=[];ui.APP_DATA.notifications=[{id:'n2',title:'Nova resposta recebida',
 message:'teste 3 · TESTE · LOJA TESTE - HOMOLOGAÇÃO',read:false}];
ui.openNotificationDemand('n2');
assert.deepEqual(opened,['r123'],'Notificação antiga de resposta é resolvida por correspondência exata');
opened=[];ui.APP_DATA.notifications=[{id:'n3',title:'Nova resposta recebida',
 message:'Demanda de outra loja',responseId:'r-unavailable',read:false}];
ui.openNotificationDemand('n3');
assert.deepEqual(opened,[],'Nunca abrir entrega de ID ausente ou não autorizado');
assert.ok(toasts.some(x=>x.includes('não foi encontrada')));
assert.ok(client.includes("function loadResponses(onReady){"),'Carregamento aceita callback para abrir modal');
assert.ok(features.includes('inserted&&inserted[0]&&inserted[0].id?String(inserted[0].id)'),
 'Publicação de notificação inclui resposta persistida');
assert.ok(features.includes("message=String(message||'')+' [[bacio-demand:"),
 'Aviso de gestão carrega demanda e resposta');
assert.ok(backend.includes("notifyManagementV2_('Nova resposta recebida'"),
 'Envio pelo login corporativo de loja segue o mesmo fluxo');
// Prazo é exigido pelo servidor, não só por validação no navegador.
const dateStart=backend.indexOf('function validateDemandDatesForPublication_('),
 dateEnd=backend.indexOf('function saveDemand(input,authOverride) {',dateStart);
assert.ok(dateStart>=0&&dateEnd>dateStart);
const server=vm.createContext({});
vm.runInContext(backend.slice(dateStart,dateEnd),server);
const start='2026-11-03T10:30:00.000Z',
 deadline='2026-11-04T10:30:00.000Z',closing='2026-11-05T10:30:00.000Z';
const ok=server.validateDemandDatesForPublication_(start,deadline,closing);
assert.equal(ok.deadline,deadline);
assert.throws(()=>server.validateDemandDatesForPublication_(start,null,closing),/prazo de resposta/);
assert.throws(()=>server.validateDemandDatesForPublication_(start,deadline,null),/encerramento/);
assert.throws(()=>server.validateDemandDatesForPublication_(start,start,closing),/posterior ao início/);
assert.throws(()=>server.validateDemandDatesForPublication_(start,closing,deadline),/anterior ao prazo/);
assert.ok(backend.includes("if(publishStatus==='active' && (tipo==='demanda'||tipo==='campanha'))"),
 'Publicações ativas exigem prazo; rascunhos continuam opcionais');
assert.ok(backend.includes("if(!inicioEm && !existingRow)inicioEm=new Date().toISOString()"),
 'A nova solicitação recebe início automático no servidor');
const scheduleStart=client.indexOf('function demandScheduleFromForm_('),
 scheduleEnd=client.indexOf('function saveCampaign(){',scheduleStart);
assert.ok(scheduleStart>=0&&scheduleEnd>scheduleStart);
let fields={fStart:{value:'2026-11-03T10:30'},fDeadline:{value:''},fEnd:{value:''}};
const form=vm.createContext({document:{getElementById:id=>fields[id]},Date});
vm.runInContext(client.slice(scheduleStart,scheduleEnd),form);
assert.ok(form.demandScheduleFromForm_('draft').startAt.endsWith('Z'));
assert.throws(()=>form.demandScheduleFromForm_('active'),/prazo de resposta/);
fields.fDeadline.value='2026-11-04T10:30';
assert.throws(()=>form.demandScheduleFromForm_('active'),/encerramento/);
fields.fEnd.value='2026-11-05T10:30';
assert.doesNotThrow(()=>form.demandScheduleFromForm_('active'));
assert.ok(client.includes("document.getElementById('fStart').value=toLocalInput(new Date().toISOString())"),
 'Modal inicia com horário local preenchido');
assert.ok(markup.includes('Início automático')&&markup.includes('Prazo de resposta *')&&
 markup.includes('Encerramento *')&&markup.includes('id="fScheduleHint"'),
 'A interface explica os prazos obrigatórios');
assert.ok(read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md').includes('BR-048'));
console.log('OK — Notificações abrem respostas autorizadas; datas exigidas na publicação e início automático.');

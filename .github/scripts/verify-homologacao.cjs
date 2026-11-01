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
console.log('OK — Homologação isolada por loja, sem notificações/cobranças às lojas reais.');

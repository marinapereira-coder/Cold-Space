'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const index=read('Index.html'),scripts=read('Scripts.html'),
      backend=read('Supabase.js'),schedule=read('Cronograma.html'),
      rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');
assert.ok(index.includes('<option value="departamento">Departamento (para responder ou encaminhar)</option>'));
assert.ok(scripts.includes("var isInternalRoute=routeMode==='consultor'||routeMode==='departamento';"));
assert.ok(scripts.includes("var selectedIds=isInternalRoute?[]:routeMode==='lojas'"));
assert.ok(scripts.includes("var wantedStatus=(CURRENT_ROLE!=='admin'||isInternalRoute)?'draft'"));
assert.ok(schedule.includes("function audienceLabel(x)")&&schedule.includes("Destino: '+e(audienceLabel(x))"));
assert.ok(rules.includes('BR-060'));
const start=backend.indexOf('function saveDemand(input,authOverride) {');
const end=backend.indexOf('\nfunction notifyDemandPendingApproval_(',start);
assert.ok(start>=0&&end>start,'saveDemand localizada e isolada no backend');
let saved=null,notified=0,validated=0;
const ctx={
 getCurrentAuthContext_:()=>({user:{role:'admin'},email:'admin@bdil.com.br'}),
 isDepartmentUser_:()=>false,
 normalizeArray_:v=>Array.isArray(v)?v.map(String):[],
 isConectaTestStoreId_:()=>false,
 roleOf_:u=>u.role,
 validateAdminStoreTargets_:()=>{validated++;},
 normalizeJsonObject_:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},
 table_:(_name,fallback)=>fallback,
 supabaseRequest_:(url,method,payload)=>{
  if(method==='post'&&url==='/rest/v1/bacio_demandas'){saved=payload;return [{id:'fixture-id'}];}
  throw new Error('Unexpected database call '+method+' '+url);
 },
 validateDemandDatesForPublication_:(startAt,deadline,endAt)=>({startAt,deadline,endAt}),
 notifyDemandPublished_:()=>{notified++;return {sent:1};},
 console
};
vm.runInNewContext(backend.slice(start,end),ctx);
const input=(mode,status,ids)=>({
 title:'Entrega de exemplo',type:'demanda',publishStatus:status,
 responseRequired:false,lojaIds:ids||[],modelFields:[],modelSource:'manual',
 startAt:'2026-11-12T12:00:00Z',deadline:'2026-11-13T12:00:00Z',endAt:'2026-11-14T12:00:00Z',
 cronograma:{direcionamento:{modo:mode,valor:mode==='departamento'?'TI':'Consultor de teste'}}
});
assert.throws(()=>ctx.saveDemand(input('departamento','active',[])),/Publicação interna ainda não homologada/);
assert.throws(()=>ctx.saveDemand(input('consultor','active',[])),/Publicação interna ainda não homologada/);
assert.throws(()=>ctx.saveDemand(input('consultor','draft',['loja1'])),/não podem carregar lojas/);
assert.throws(()=>ctx.saveDemand({...input('departamento','draft',[]),cronograma:{direcionamento:{modo:'departamento',valor:''}}}),/Selecione um consultor ou departamento/);
assert.equal(saved,null,'Nenhuma gravação nos bloqueios');
assert.equal(notified,0,'Bloqueios não disparam alertas');
const draft=ctx.saveDemand(input('departamento','draft',[]));
assert.equal(draft.ok,true);
assert.equal(saved.status,'draft');
assert.equal(saved.loja_ids.length,0);
assert.equal(saved.cronograma.direcionamento.valor,'TI');
assert.equal(notified,0,'Rascunho interno não notifica ninguém');
ctx.saveDemand(input('lojas','active',['loja1']));
assert.equal(saved.status,'active','Publicação normal para lojas permanece funcionando');
assert.equal(saved.loja_ids[0],'loja1');
assert.equal(notified,1,'Publicação para lojas continua notificando');
assert.ok(validated>=1);
console.log('OK — Direcionamento interno como rascunho isolado; publicação de lojas preservada.');

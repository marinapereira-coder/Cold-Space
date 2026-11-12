'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const backend=read('Supabase.js'),scripts=read('Scripts.html'),
 index=read('Index.html'),cron=read('Cronograma.html'),rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');
assert.ok(index.includes('<option value="departamento">Departamento (para responder ou encaminhar)</option>'));
assert.ok(scripts.includes("var selectedIds=isInternalRoute?[]:routeMode==='lojas'"));
assert.ok(scripts.includes("var wantedStatus=CURRENT_ROLE!=='admin'?'draft'"));
assert.ok(cron.includes("Destino: '+e(audienceLabel(x))"));
assert.ok(rules.includes('BR-060')&&rules.includes('BR-061'));
const a=backend.indexOf('function isDirectInternalDemand_(demanda) {'),b=backend.indexOf('function latestResponsesByStore_(',a);
assert.ok(a>=0&&b>a);
const scope=vm.createContext({
 normalizeJsonObject_:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},
 normalizeArray_:v=>Array.isArray(v)?v.map(String):[],
 isConectaTestStoreId_:v=>String(v)==='TESTE_CONECTA'
});
vm.runInContext(backend.slice(a,b),scope);
const direct={cronograma:{direcionamento:{modo:'departamento',valor:'marketing'}},loja_ids:[]};
const legacy={cronograma:{direcionamento:{modo:'lojas'}},loja_ids:[]};
assert.equal(scope.demandaVisivelNoEscopo_(direct,['loja1']),false);
assert.equal(scope.getTargetStoreIds_(direct,['loja1']).length,0);
assert.equal(scope.demandaVisivelNoEscopo_(legacy,['loja1']),true);
assert.equal(scope.getTargetStoreIds_(legacy,['loja1'])[0],'loja1');
const start=backend.indexOf('function saveDemand(input,authOverride) {'),
 end=backend.indexOf('\nfunction notifyDemandPendingApproval_(',start);
assert.ok(start>=0&&end>start);
let saved=null,storeNotices=0,internalNotices=0;
const ctx={
 getCurrentAuthContext_:()=>({user:{role:'admin'},email:'admin@bdil.com.br'}),
 isDepartmentUser_:()=>false,normalizeArray_:v=>Array.isArray(v)?v.map(String):[],
 isConectaTestStoreId_:()=>false,roleOf_:u=>u.role,
 validateAdminStoreTargets_:()=>{},normalizeJsonObject_:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},
 table_:(_name,fallback)=>fallback,
 supabaseRequest_:(url,method,payload)=>{
  if(method==='post'&&url==='/rest/v1/bacio_demandas'){saved=payload;return [{id:'fixture-id'}];}
  throw Error('Unexpected DB request: '+method+' '+url);
 },
 validateDemandDatesForPublication_:(a,b,c)=>({startAt:a,deadline:b,endAt:c}),
 getInternalRouteRecipients_:r=>{
  if(r.valor==='MISSING')throw Error('O destinatário interno não possui login ativo');
  return ['destination@bdil.com.br'];
 },
 internalRoutingKey_:v=>String(v||'').toLowerCase(),
 isDirectInternalDemand_:d=>['consultor','departamento'].includes(d.cronograma?.direcionamento?.modo),
 notifyInternalDemand_:()=>{internalNotices++;return {sent:1};},
 notifyDemandPublished_:()=>{storeNotices++;return {sent:1};},console
};
vm.runInNewContext(backend.slice(start,end),ctx);
const input=(mode,status,ids,target)=>({
 title:'Entrega de exemplo',type:'demanda',publishStatus:status,
 responseRequired:false,lojaIds:ids||[],modelFields:[],modelSource:'manual',
 startAt:'2026-11-12T12:00:00Z',deadline:'2026-11-13T12:00:00Z',endAt:'2026-11-14T12:00:00Z',
 cronograma:{direcionamento:{modo:mode,valor:target||'marketing'}}
});
assert.throws(()=>ctx.saveDemand(input('consultor','draft',['loja1'])),/não podem carregar lojas/);
assert.throws(()=>ctx.saveDemand(input('departamento','active',[],'MISSING')),/não possui login ativo/);
assert.equal(saved,null);
assert.equal(internalNotices,0);
ctx.saveDemand(input('departamento','draft',[]));
assert.equal(saved.status,'draft');
assert.equal(saved.loja_ids.length,0);
assert.equal(internalNotices,0);
ctx.saveDemand(input('departamento','active',[]));
assert.equal(saved.status,'active');
assert.equal(saved.loja_ids.length,0);
assert.equal(internalNotices,1,'Notificar somente destinatário interno');
assert.equal(storeNotices,0,'Nenhum broadcast de lojas no envio interno');
ctx.saveDemand(input('lojas','active',['loja1']));
assert.equal(saved.loja_ids[0],'loja1');
assert.equal(storeNotices,1,'Publicação normal de lojas mantida');
console.log('OK — Direcionamento interno isolado, autorização de publicação e fluxo de lojas preservado.');

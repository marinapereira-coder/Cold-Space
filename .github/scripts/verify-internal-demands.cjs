'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const backend=read('Supabase.js'),internal=read('InternalDemand.js'),
 scripts=read('Scripts.html'),rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md'),
 migration=read('docs/migrations/20261112_entregas_internas.sql');
assert.ok(rules.includes('BR-061')&&migration.includes('enable row level security'));
assert.ok(migration.includes('revoke all on table public.bacio_demanda_entregas_internas from anon, authenticated, public'));
assert.ok(scripts.includes('function renderInternalDemandDetail_(d)'));
assert.ok(scripts.includes('function submitInternalDemandUI_(demandId)'));
assert.ok(backend.includes("notificationResult = isDirectInternalDemand_({cronograma:cronograma})"));
assert.ok(backend.includes("notificationInfo=internal ?"));
assert.ok(backend.includes("getInternalRouteRecipients_(internalRoute_(full))"));
const demandId='11111111-1111-4111-8111-111111111111',admin='admin@bdil.com.br',marketer='marketing@bdil.com.br',
 consultant='consultor@bdil.com.br',store='loja@bdil.com.br';
const users=[
 {id:'u1',role:'admin',email:admin,ativo:true,nome:'Admin'},
 {id:'u2',role:'marketing',email:marketer,ativo:true,nome:'Marketing'},
 {id:'u3',role:'consultor',email:consultant,ativo:true,nome:'Consultor ativo'},
 {id:'u4',role:'ti',email:'ti@bdil.com.br',ativo:false,nome:'TI inativo'},
 {id:'u5',role:'loja',email:store,ativo:true,nome:'Loja'}
];
const demand={id:demandId,titulo:'Relatório mensal',tipo:'demanda',ativa:true,status:'active',
 prazo_sla:'2027-12-30T20:00:00Z',encerramento_em:'2027-12-31T20:00:00Z',
 inicio_em:'2027-01-01T12:00:00Z',created_by:admin,cronograma:{direcionamento:{modo:'departamento',valor:'marketing'}}};
let actor={user:users[1],email:marketer},wrote=[],notices=[],dbReads=[];
const ctx=vm.createContext({
 roleOf_:u=>String(u.role||''),isDepartmentUser_:u=>['marketing','ti','qualidade'].includes(u.role),
 departmentOfUser_:u=>u.role,mayReadDepartmentDemand_:()=>true,
 normalizeJsonObject_:v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{},
 normalizeObjectArray_:v=>Array.isArray(v)?v:[],
 table_:(_key,f)=>f,formatDeadline_:d=>String(d||''),sameDay_:()=>false,
 timelineInfo_:()=>({code:'active',label:'Em andamento'}),
 getCurrentAuthContext_:()=>actor,getStoreAuthContext_:()=>actor,
 safeSupabaseSelect_:url=>{
  dbReads.push(url);
  if(url.includes('bacio_usuarios'))return users.filter(u=>u.ativo);
  if(url.includes('bacio_demanda_entregas_internas'))return wrote;
  return [];
 },
 supabaseRequest_:(url,method,payload)=>{
  dbReads.push(url+' ['+method+']');
  if(method==='get'&&url.includes('bacio_usuarios'))return users.filter(u=>u.ativo);
  if(method==='get'&&url.includes('bacio_demandas'))return [demand];
  if(method==='get'&&url.includes('bacio_demanda_entregas_internas'))return wrote;
  if(method==='post'&&url.includes('bacio_demanda_entregas_internas')){
   const r={id:'resp-1',...payload};wrote.push(r);return [r];
  }
  if(method==='post'&&url.includes('bacio_notificacoes')){notices.push(...payload);return [];}
  throw Error('Unexpected DB request '+method+' '+url);
 },
 Date,console
});
const a=backend.indexOf('function isDirectInternalDemand_(demanda) {'),b=backend.indexOf('function demandaVisivelNoEscopo_(',a);
assert.ok(a>=0&&b>a);
vm.runInContext(backend.slice(a,b),ctx);
vm.runInContext(internal,ctx);
const directory=ctx.internalRoutingDirectory_(users[0]);
assert.equal(directory.consultores.length,1);
assert.equal(directory.consultores[0].value,consultant);
assert.equal(directory.departamentos.length,1);
assert.equal(directory.departamentos[0].value,'marketing');
assert.equal(ctx.getInternalRouteRecipients_({modo:'consultor',valor:consultant})[0],consultant);
assert.throws(()=>ctx.getInternalRouteRecipients_({modo:'consultor',valor:'Nome livre'}),/login ativo/);
assert.throws(()=>ctx.getInternalRouteRecipients_({modo:'departamento',valor:'ti'}),/login ativo/);
assert.equal(ctx.isInternalAssignee_(demand,users[1],marketer),true);
assert.equal(ctx.isInternalAssignee_(demand,users[0],admin),false);
assert.equal(ctx.isInternalAssignee_(demand,users[4],store),false);
assert.equal(ctx.isInternalAssignee_({...demand,status:'draft'},users[1],marketer),false);
assert.equal(ctx.mayReadInternalDemand_(demand,{user:users[0],email:admin}),true);
assert.equal(ctx.mayReadInternalDemand_(demand,{user:users[4],email:store}),false);
const before=ctx.getInternalDemandDetail_(demand,actor);
assert.equal(before.canReply,true);
assert.equal(before.totalStores,0);
assert.equal(before.internalHistory.length,0);
actor={user:users[4],email:store};
assert.throws(()=>ctx.submitInternalDemandReply({demandId,message:'Tentativa indevida'}),/não está autorizado/);
assert.equal(wrote.length,0);
actor={user:users[1],email:marketer};
const result=ctx.submitInternalDemandReply({demandId,message:'Concluído com evidências.',status:'respondido',usuario_email:admin});
assert.equal(result.ok,true);
assert.equal(wrote.length,1);
assert.equal(wrote[0].usuario_email,marketer,'Email nunca vem do navegador');
assert.equal(wrote[0].status,'respondido');
assert.equal(notices.length,1);
assert.equal(notices[0].usuario_email,admin);
assert.ok(notices[0].mensagem.includes(demandId));
assert.equal(ctx.getInternalDemandDetail_(demand,actor).internalHistory.length,1);
assert.throws(()=>ctx.submitInternalDemandReply({demandId,message:'ab',status:'respondido'}),/3 a 4.000/);
assert.throws(()=>ctx.submitInternalDemandReply({demandId,message:'ok encaminhar',status:'reprovado'}),/Situação/);
const forward=ctx.submitInternalDemandReply({demandId,message:'Preciso encaminhar para análise.',status:'encaminhamento_solicitado'});
assert.equal(forward.ok,true);
assert.equal(wrote[1].status,'encaminhamento_solicitado');
assert.ok(notices.every(n=>n.usuario_email===admin));
assert.ok(dbReads.every(u=>!u.includes('bacio_demanda_respostas?')),'Não escrever ou ler respostas de lojas');
console.log('OK — Destinatários ativos, segurança por perfil, histórico interno e notificações sem envolver lojas.');

#!/usr/bin/env node
'use strict';
// BR-065 — três calendários, contraste e isolamento de escopo do Prisma.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('Index.html'),scripts=read('Scripts.html');
const styles=read('Styles.html'),backend=read('PrismaDeliveries.js');
const rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');
new vm.Script(backend,{filename:'PrismaDeliveries.js'});
new vm.Script(scripts.replace(/^\s*<script>\s*/i,'').replace(/\s*<\/script>\s*$/i,''),{filename:'Scripts.html'});
for(const id of ['calendarOperationalTab','calendarPromotionalTab','calendarDeliveryTab',
 'calendarOperationalPanel','calendarPromotionalPanel','calendarDeliveryPanel',
 'deliveryPrevMonth','deliveryTodayMonth','deliveryNextMonth',
 'deliveryMonthTitle','deliveryStoreFilter','deliveryCalendarGrid',
 'deliveryCalendarList','deliveryCalendarStatus','deliveryCalendarSource']){
 assert.equal((index.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'ID ausente ou duplicado: '+id);
}
assert.equal((index.match(/data-page="calendario"/g)||[]).length,1,'Continuar com um único item Calendário no menu');
assert.ok(index.indexOf('Calendário Operacional')<index.indexOf('Calendário Promocional'));
assert.ok(index.indexOf('Calendário Promocional')<index.indexOf('Entregas e Pedidos'));
assert.ok(index.includes('id="monthCalendar"')&&index.includes('id="calendarUpcoming"'),'Preservar calendário original');
assert.ok(scripts.includes("run.getStoreConectaDeliveryCalendar(STORE_ACCESS_TOKEN,month,selected)"));
assert.ok(scripts.includes("run.getConectaDeliveryCalendar(month,selected)"));
assert.ok(scripts.includes("DELIVERY_CALENDAR_CACHE={};")&&scripts.includes("DELIVERY_SELECTED_STORE='';"));
assert.ok(styles.includes('body.dark-mode .app-shell #page-comunicados #noticeList .announcement p'),
 'A cor escura de comunicados precisa ter sobreposição explícita no modo noturno');
assert.ok(styles.includes('#page-calendario .delivery-calendar-event[data-step="entrega"]'));
assert.equal((styles.match(/<style>/g)||[]).length,1);
assert.equal((styles.match(/<\/style>/g)||[]).length,1);
assert.ok(rules.includes('BR-065'));
assert.ok(backend.includes('CONECTA_PRISMA_EXPEDICAO_SHEET_ID')&&
 backend.includes('CONECTA_PRISMA_EXPEDICAO_ABA_ATIVA'));
assert.ok(!/1ZrFpnYIkxLO_ajZDaQk6dqLqDD0F_-brmSqbG5ztL-c/.test(backend),
 'ID do espelho do Prisma não pode ir ao código público');
assert.ok(!/\.(?:setValue|setValues|appendRow|deleteRow|insertRow|insertRows)\(/.test(backend),
 'A integração de entrega deve ser somente leitura');

// Teste com uma planilha normalizada isolada; todas as chamadas e dados são fictícios.
let propertySheet='FAKE_PRIVATE_ID',propertyTab='PRISMA_CE_NOV_2026';
let actingUser={role:'admin'};
let reads=0;
const rows=[
 ['2026-11-15','SECO','0006','LOJA 6','Rota A','2026-11-16','2026-11-17','2026-11-18'],
 ['2026-11-15','SECO','0006','LOJA 6','Rota A','2026-11-16','2026-11-17','2026-11-18'],
 ['2026-11-16','CONGELADO','0017','LOJA 17','Rota B','2026-11-17','2026-11-18','2026-11-19'],
 ['2026-12-01','CONGELADO','0006','LOJA 6','Rota C','2026-12-02','2026-12-03','2026-12-04']
];
let sheet={
 getLastRow:()=>rows.length+1,
 getRange(r,c,n,m){
  if(r===1&&c===1&&n===1&&m===8) return {getDisplayValues:()=>[['PEDIDO','TIPO','LOJA','NOME','ROTA','SEPARACAO','CARREGAMENTO','ENTREGA']]};
  if(r===2&&c===1&&n===rows.length&&m===8)return {getValues:()=>rows};
  throw Error('Consulta não prevista: '+[r,c,n,m].join('/'));
 }
};
const cache=new Map();
const context=vm.createContext({
 Date,Utilities:{formatDate:()=>''},console:{log(){}},Object,
 PropertiesService:{getScriptProperties:()=>({getProperty:name=>name==='CONECTA_PRISMA_EXPEDICAO_SHEET_ID'?propertySheet:propertyTab})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v)})},
 SpreadsheetApp:{openById(id){
  assert.equal(id,'FAKE_PRIVATE_ID');reads++;
  return {getSheetByName:tab=>tab===propertyTab?sheet:null};
 }},
 getCurrentAuthContext_:()=>({user:actingUser}),
 getStoreAuthContext_:token=>{
  if(token!=='VALID')throw Error('Unauthorized');
  return {user:{role:'loja'}};
 },
 getVisibleStores_:user=>user.role==='loja'
  ?[{id:'s6',codigo:'0006',nome:'LJ 0006 - TESTE',ativa:true}]
  :[{id:'s6',codigo:'0006',nome:'LJ 0006 - TESTE',ativa:true},
    {id:'s17',codigo:'0017',nome:'LJ 0017 - TESTE',ativa:true},
    {id:'TESTE_CONECTA',codigo:'9999',nome:'Homologação',ativa:true}],
 isConectaTestStoreId_:id=>id==='TESTE_CONECTA',
 roleOf_:user=>user.role
});
new vm.Script(backend).runInContext(context);
const selection=context.getConectaDeliveryCalendar('2026-11','');
assert.equal(selection.status,'select_store');
assert.equal(selection.stores.length,2,'Não expor unidade de homologação');
let data=context.getConectaDeliveryCalendar('2026-11','0006');
assert.equal(data.status,'ok');
assert.equal(data.records.length,1,'Eliminar repetição idêntica sem omitir entregas reais');
assert.equal(data.records[0].tipo,'SECO');
assert.equal(data.records[0].entrega,'2026-11-18');
assert.equal(data.sourceVersion,'PRISMA_CE_NOV_2026');
assert.equal(reads,1);
data=context.getConectaDeliveryCalendar('2026-11','0006');
assert.equal(reads,1,'Consulta repetida deve usar cache');
assert.equal(context.getStoreConectaDeliveryCalendar('VALID','2026-11','').codigo,'0006',
 'Loja sem seleção recebe somente a própria programação');
assert.throws(()=>context.getStoreConectaDeliveryCalendar('VALID','2026-11','0017'),
 /não autorizado/,'Uma loja não pode consultar outra loja');
assert.throws(()=>context.getStoreConectaDeliveryCalendar('INVALID','2026-11','0006'),
 /Unauthorized/,'Acesso inválido deve falhar antes da leitura');
assert.throws(()=>context.getConectaDeliveryCalendar('2026-13','0006'),/mês válido/);
propertySheet='';
assert.equal(context.getConectaDeliveryCalendar('2026-11','0006').status,'unconfigured');
propertySheet='FAKE_PRIVATE_ID';propertyTab='';
assert.equal(context.getConectaDeliveryCalendar('2026-11','0006').status,'unconfigured');
propertyTab='ABA_ALEATORIA';
assert.equal(context.getConectaDeliveryCalendar('2026-11','0006').status,'source_unavailable');
propertyTab='CALENDÁRIO';
const legacyRow=Array(15).fill('');
legacyRow[0]='2026-11-16';legacyRow[2]='CONGELADO';legacyRow[3]='0006';
legacyRow[7]='Rota D';legacyRow[10]='2026-11-17';legacyRow[12]='2026-11-18';legacyRow[14]='2026-11-19';
sheet={
 getLastRow:()=>5,
 getRange(r,c,n,m) {
  if(r===4&&c===1&&n===1&&m===16){
   const head=Array(16).fill('');
   head[2]='Tipologia';head[3]='Lojas';head[14]='DD/MM/AA';
   return {getDisplayValues:()=>[head]};
  }
  if(r===5&&c===1&&n===1&&m===15)return {getValues:()=>[legacyRow]};
  throw Error('Consulta legacy não prevista');
 }
};
data=context.getConectaDeliveryCalendar('2026-11','0006');
assert.equal(data.status,'ok','Planilha base deve continuar legível');
assert.equal(data.records[0].tipo,'CONGELADO');

// BR-067 — diferenciar erro de abertura, aba ausente, formato inválido e leitura.
const originalOpen=context.SpreadsheetApp.openById;
cache.clear();
context.SpreadsheetApp.openById=()=>{throw new Error('Google Drive not found or access denied: PRIVATE ID');};
let problem=context.getConectaDeliveryCalendar('2026-11','0006');
assert.equal(problem.status,'source_open_failed');
assert.ok(!JSON.stringify(problem).includes('PRIVATE ID'),'Erro bruto não pode aparecer no cliente');
cache.clear();
context.SpreadsheetApp.openById=()=>({getSheetByName:()=>null});
assert.equal(context.getConectaDeliveryCalendar('2026-11','0006').status,'source_tab_missing');
cache.clear();
context.SpreadsheetApp.openById=()=>({getSheetByName:()=>({
 getLastRow:()=>5,
 getRange(){return {getDisplayValues:()=>[Array(16).fill('CABEÇALHO INCORRETO')]};}
})});
assert.equal(context.getConectaDeliveryCalendar('2026-11','0006').status,'source_format_mismatch');
cache.clear();
context.SpreadsheetApp.openById=()=>({getSheetByName:()=>({
 getLastRow:()=>5,
 getRange(){throw new Error('Erro temporário na leitura privada');}
})});
problem=context.getConectaDeliveryCalendar('2026-11','0006');
assert.equal(problem.status,'source_read_failed');
assert.ok(!JSON.stringify(problem).includes('Erro temporário'),'Detalhe de exceção não pode ir à interface');
context.SpreadsheetApp.openById=originalOpen;
cache.clear();

// Teste de autorização manual BR-067: admin, leitura de cabeçalho, acesso negado.
cache.clear();
actingUser={role:'admin'};
propertySheet='FAKE_PRIVATE_ID';propertyTab='CALENDÁRIO';
let audit=context.validarAcessoExpedicaoConecta();
assert.equal(audit.status,'ok');
assert.equal(audit.ok,true);
assert.ok(!JSON.stringify(audit).includes('FAKE_PRIVATE_ID'));
actingUser={role:'loja'};
assert.throws(()=>context.validarAcessoExpedicaoConecta(),/administradores autenticados/);
actingUser={role:'admin'};
propertySheet='';
audit=context.validarAcessoExpedicaoConecta();
assert.equal(audit.status,'unconfigured');
propertySheet='FAKE_PRIVATE_ID';
cache.clear();

// Renderização fictícia: meses e dados de loja permanecem separados.
const ids=['deliveryCalendarStatus','deliveryCalendarGrid','deliveryCalendarList',
 'deliveryStoreFilter','deliveryCalendarSource','deliveryMonthTitle'];
const els=Object.fromEntries(ids.map(id=>[id,{innerHTML:'',textContent:'',value:'',hidden:false}]));
els.deliveryMonthTitle.textContent='novembro de 2026';
const start=scripts.indexOf('/* ============================================================\n   BR-065: ENTREGAS E PEDIDOS');
const end=scripts.indexOf('/* ============================================================\n   V2: AVALIAÇÕES',start);
assert.ok(start>0&&end>start);
const ui=vm.createContext({
 document:{getElementById:id=>els[id]},
 CALENDAR_CURSOR:new Date(2026,10,1),DELIVERY_SELECTED_STORE:'0006',
 conectaPromoMonthRef_:()=> '2026-11',
 safe:value=>String(value==null?'':value).replace(/&/g,'&amp;')
   .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
 Date,Array,Math,Number,Object
});
new vm.Script(scripts.slice(start,end)).runInContext(ui);
const response={
 month:'2026-11',codigo:'0006',nome:'LJ 0006',stores:[{codigo:'0006',nome:'Loja 6'}],
 status:'ok',sourceVersion:'PRISMA_CE_NOV_2026',records:[{
 tipo:'SECO',rota:'Rota A',pedido:'2026-11-15',separacao:'2026-11-16',
 carregamento:'2026-11-17',entrega:'2026-11-18'
 }]
};
ui.renderConectaDeliveryCalendar_(response);
assert.ok(els.deliveryCalendarGrid.innerHTML.includes('Entrega prevista'));
assert.ok(els.deliveryCalendarGrid.innerHTML.includes('Separação / faturamento'));
assert.ok(els.deliveryCalendarList.innerHTML.includes('Rota A'));
assert.ok(els.deliveryCalendarSource.textContent.includes('não sincroniza automaticamente'));
assert.equal((els.deliveryCalendarGrid.innerHTML.match(/class="promotional-calendar-cell/g)||[]).length,42,
 'Novembro de 2026 requer seis semanas na grade iniciada na segunda-feira');
ui.renderConectaDeliveryCalendar_({month:'2026-11',stores:[],status:'unconfigured'});
assert.ok(els.deliveryCalendarStatus.textContent.includes('Integração pendente'));
assert.equal(els.deliveryCalendarGrid.innerHTML,'','Falha de integração não deve exibir programação antiga');

// BR-066 — Falha no calendário não pode apagar lojas que a sessão já autorizou.
const searchField={value:''};
els.deliveryStoreSearch=searchField;
els.deliveryStoreCount={textContent:''};
ui.APP_DATA={stores:[
  {id:'6',codigo:'6',nome:'LJ 0006 - SHOP PATIO PAULISTA'},
  {id:'17',codigo:'17',nome:'LJ 0017 - MOEMA'},
  {id:'TESTE_CONECTA',codigo:'9999',nome:'LOJA TESTE'}]};
ui.DELIVERY_STORE_SCOPE=null;
ui.DELIVERY_SELECTED_STORE='';
els.deliveryStoreFilter.value='';
ui.conectaEntregaPreencherLojas_();
assert.ok(els.deliveryStoreFilter.innerHTML.includes('SHOP PATIO PAULISTA'),
  'Carregar lojas autorizadas no bootstrap, sem RPC de entregas');
assert.ok(els.deliveryStoreFilter.innerHTML.includes('MOEMA'));
assert.ok(!els.deliveryStoreFilter.innerHTML.includes('LOJA TESTE'));
assert.ok(els.deliveryStoreCount.textContent.includes('2 lojas'));
searchField.value='0017';
ui.conectaEntregaPreencherLojas_();
assert.ok(els.deliveryStoreFilter.innerHTML.includes('MOEMA'));
assert.ok(!els.deliveryStoreFilter.innerHTML.includes('SHOP PATIO PAULISTA'),
  'Busca deve filtrar por código da loja');
searchField.value='';
ui.renderConectaDeliveryCalendar_({month:'2026-11',status:'request_failed'});
assert.ok(els.deliveryCalendarStatus.textContent.includes('Não foi possível consultar o servidor'));
assert.ok(els.deliveryStoreFilter.innerHTML.includes('SHOP PATIO PAULISTA'),
  'Erro de comunicação não deve limpar a lista já autorizada');
ui.renderConectaDeliveryCalendar_({month:'2026-11',stores:[],status:'no_access'});
assert.ok(!els.deliveryStoreFilter.innerHTML.includes('SHOP PATIO PAULISTA'),
  'Resposta no_access autenticada deve remover as opções');
assert.ok(els.deliveryCalendarStatus.textContent.includes('não possui lojas autorizadas'));
assert.ok(index.includes('id="deliveryStoreSearch"'));
assert.ok(index.includes('id="deliveryStoreCount"'));
assert.ok(scripts.includes("DELIVERY_STORE_SCOPE=null;"));
assert.ok(styles.includes('#page-calendario #deliveryStoreSearch'));

ui.APP_DATA={stores:[{id:'6',codigo:'6',nome:'LJ 0006'}]};
ui.DELIVERY_STORE_SCOPE=null;
for(const [status,fragment] of [
 ['source_open_failed','Não foi possível abrir a planilha'],
 ['source_tab_missing','A aba configurada não foi encontrada'],
 ['source_format_mismatch','não corresponde à versão esperada'],
 ['source_read_failed','a leitura dos registros falhou']
]){
 ui.renderConectaDeliveryCalendar_({month:'2026-11',status});
 assert.ok(els.deliveryCalendarStatus.textContent.includes(fragment),
   'Mensagem de diagnóstico ausente: '+status);
 assert.ok(els.deliveryStoreFilter.innerHTML.includes('LJ 0006'),
   'O erro não pode limpar as lojas autorizadas da sessão');
 assert.equal(els.deliveryCalendarGrid.innerHTML,'',
   'Não apresentar entregas sem fonte válida');
}

console.log('OK — BR-065: contraste, três calendários, 2 formatos da origem, escopo, cache, erros e renderização.');
console.log('OK — BR-067: falhas distintas com mensagens seguras e manutenção de escopo.');
console.log('OK — BR-066: lojas autorizadas no bootstrap, busca por código, falha sem esvaziar e no_access protegido.');

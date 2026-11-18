#!/usr/bin/env node
'use strict';
// BR-064 — adapter de leitura isolado e duas guias no Calendário.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('Index.html'),scripts=read('Scripts.html'),backend=read('PrismaPromotions.js');
const styles=read('Styles.html'),rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');

for(const id of ['calendarOperationalTab','calendarPromotionalTab','calendarOperationalPanel',
 'calendarPromotionalPanel','promotionalPrevMonth','promotionalNextMonth',
 'promotionalTodayMonth','promotionalCalendarGrid','promotionalCalendarStatus']){
 assert.equal((index.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'Novo id duplicado/ausente: '+id);
}
for(const id of ['page-calendario','prevMonthBtn','nextMonthBtn','todayMonthBtn','newCalendarEventBtn',
 'monthCalendar','calendarUpcoming','calendarMonthTitle']){
 assert.equal((index.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'Calendário operacional modificado: '+id);
}
assert.equal((index.match(/data-page="calendario"/g)||[]).length,1,
 'Continua existindo só uma aba Calendário na navegação lateral');
assert.ok(index.indexOf('Calendário Operacional')<index.indexOf('Calendário Promocional'),
 'Ordem dos calendários precisa ser Operacional / Promocional');
assert.ok(styles.includes('.calendar-view-tab')&&styles.includes('body.dark-mode #page-calendario'),
 'Temas e rolagem do calendário promocional ausentes');
assert.ok(scripts.includes("if(AUTH_MODE==='store')run.getStorePrismaPromotionalCalendar(STORE_ACCESS_TOKEN,month)"),
 'Loja deve consultar endpoint autenticado por token');
assert.ok(scripts.includes("else run.getPrismaPromotionalCalendar(month)"),
 'Perfil corporativo deve usar endpoint autenticado');
assert.ok(rules.includes('BR-064')&&rules.includes('CONECTA_PRISMA_GROWTH_SHEET_ID'));
assert.ok(!backend.includes('1Pl90EUYQ8DnF6NHHq4xmqfib3kkuEsovD87e6yeFD7Q'),
 'O ID de planilha privado NÃO pode ser copiado para repositório público');
assert.ok(!/\.(?:setValue|setValues|setBackground|appendRow|insertRow|deleteRow)\(/.test(backend),
 'Adapter de Growth deve ser somente leitura');

const days=30,firstCol=3,dayCol=7,last=38,rowLen=last-firstCol+1,colors=[],values=[];
function row(name,type,active,cancelled,corriere){
 const data=Array(rowLen).fill(''),bg=Array(rowLen).fill('#ffffff');
 data[0]=type;data[1]='Delivery';data[2]=name;
 bg[2]='#f7c178';data[35]=corriere||'';
 for(const d of active)bg[dayCol-firstCol+d-1]='#6b4024';
 for(const d of cancelled)data[dayCol-firstCol+d-1]='x';
 values.push(data);colors.push(bg);
}
row('Ferrero Rocher','Promoção',[1,2,7],[7],'sim');
row('Ferrero Rocher','Promoção',[5],[],'');
row('Promoção oculta','Promoção',[8],[],'');
row('Upgrade Teste','Upgrade',[10,11],[],'');
const property={id:'SOURCE_ID_FAKE'};
const cache=new Map();
const headers=[Array(38).fill(''),Array(38).fill('')];
headers[0][37]='Corriere';
const sheet={
 getLastRow:()=>9,getLastColumn:()=>38,
 getRange(r,c,n,m){
   if(r===4&&c===1&&n===2)return {getDisplayValues:()=>headers};
   if(r===6&&c===3&&n===4)return {getValues:()=>values,getBackgrounds:()=>colors};
   throw Error('Unexpected range '+[r,c,n,m].join('/'));
 },
 isRowHiddenByUser:r=>r===8,
 isRowHiddenByFilter:()=>false
};
let accesses=0;
const env={
 Date,console:{log(){}},
 Utilities:{formatDate:()=> '2026-11'},
 roleOf_:user=>user.role,
 PropertiesService:{getScriptProperties:()=>({getProperty:()=>property.id})},
 CacheService:{getScriptCache:()=>({get(k){return cache.get(k)||null},put(k,v){cache.set(k,v)}})},
 SpreadsheetApp:{openById(id){assert.equal(id,'SOURCE_ID_FAKE');accesses++;return{
   getSheetByName(n){assert.equal(n,'Novembro 2026');return sheet}
 }}},
 getCurrentAuthContext_:()=>({user:{role:'admin'}}),
 getStoreAuthContext_:token=>{if(token!=='VALID_TOKEN')throw Error('Unauthorized');return {user:{role:'loja'}}}
};
const ctx=vm.createContext(env);
new vm.Script(backend,{filename:'PrismaPromotions.js'}).runInContext(ctx);
assert.equal(ctx.conectaPromoDiaAtivo_('#ffffff','#f7c178',ctx.conectaPromoBrilho_('#f7c178')),false);
assert.equal(ctx.conectaPromoDiaAtivo_('#6b4024','#f7c178',ctx.conectaPromoBrilho_('#f7c178')),true);
let result=ctx.getPrismaPromotionalCalendar('2026-11');
assert.equal(result.status,'ok');
assert.equal(result.promotions.length,2,'Linhas ocultas/duplicadas não podem gerar outras promoções');
const ferrero=result.promotions.find(p=>p.nome==='Ferrero Rocher');
assert.ok(ferrero);
assert.equal(JSON.stringify(ferrero.diasAtivos),JSON.stringify([1,2,5]),
 'Dias cancelados não podem ser exibidos; nomes iguais devem unir dias');
assert.equal(JSON.stringify(ferrero.diasCancelados),JSON.stringify([7]));
assert.equal(ferrero.corriere,true);
assert.ok(result.promotions.some(p=>p.tipo==='Upgrade'&&p.diasAtivos.includes(11)),
 'Promoções do tipo Upgrade precisam ser incluídas');
assert.equal(accesses,1);
assert.equal(ctx.getStorePrismaPromotionalCalendar('VALID_TOKEN','2026-11').status,'ok');
assert.equal(accesses,1,'Fonte em cache por 15 minutos não deve abrir planilha novamente');
assert.throws(()=>ctx.getStorePrismaPromotionalCalendar('BAD_TOKEN','2026-11'),/Unauthorized/);
assert.equal(ctx.getPrismaPromotionalCalendar('2026-05').status,'month_unavailable');
assert.throws(()=>ctx.getPrismaPromotionalCalendar('invalid'),/inválido/);
property.id='';
assert.equal(ctx.getPrismaPromotionalCalendar('2026-12').status,'unconfigured');
property.id='NOT_AUTHORIZED';
const originalOpen=env.SpreadsheetApp.openById;
env.SpreadsheetApp.openById=()=>{throw Error('Cannot access private sheet');};
const fail=ctx.getPrismaPromotionalCalendar('2027-01');
assert.equal(fail.status,'source_open_failed');
assert.ok(!JSON.stringify(fail).includes('NOT_AUTHORIZED'),'Não vazar configuração privada');


// BR-068 — Validação manual do administrador corporativo, sem divulgar IDs.
let check=ctx.validarAcessoPromocionalConecta();
assert.equal(check.status,'source_open_failed');
assert.equal(check.ok,false);
assert.ok(!JSON.stringify(check).includes('NOT_AUTHORIZED'));
property.id='';
check=ctx.validarAcessoPromocionalConecta();
assert.equal(check.status,'unconfigured');
property.id='SOURCE_ID_FAKE';
env.SpreadsheetApp.openById=originalOpen;
check=ctx.validarAcessoPromocionalConecta();
assert.equal(check.status,'ok');
assert.equal(check.mes,'2026-11');
assert.equal(check.total,2);
const originalAuth=env.getCurrentAuthContext_;
env.getCurrentAuthContext_=()=>({user:{role:'loja'}});
assert.throws(()=>ctx.validarAcessoPromocionalConecta(),
 /administradores autenticados/,'Teste de configuração deve exigir ADM');
env.getCurrentAuthContext_=originalAuth;
env.SpreadsheetApp.openById=()=>({getSheetByName:()=>null});
assert.equal(ctx.validarAcessoPromocionalConecta().status,'month_unavailable');
env.SpreadsheetApp.openById=()=>({getSheetByName:()=>({
 getLastRow(){throw Error('Sensitive raw spreadsheet details');}
})});
check=ctx.validarAcessoPromocionalConecta();
assert.equal(check.status,'source_read_failed');
assert.ok(!JSON.stringify(check).includes('Sensitive'));
env.SpreadsheetApp.openById=originalOpen;

// Teste frontend sem acesso real: períodos consecutivos agrupados, dois inícios separados.
const a=scripts.indexOf('function selectConectaCalendarView_('),
 b=scripts.indexOf('/* ============================================================\n   V2: AVALIAÇÕES',a);
assert.ok(a>0&&b>a,'Funções client-side do calendário promocional não encontradas');
const elements={};
['promotionalMonthTitle','promotionalCalendarStatus','promotionalCalendarGrid','promotionalFixed']
 .forEach(id=>{elements[id]={textContent:'',innerHTML:'',hidden:false}});
elements.promotionalMonthTitle.textContent='novembro de 2026';
const ui=vm.createContext({
 CALENDAR_CURSOR:new Date(2026,10,1),CALENDAR_VIEW:'promocional',
 PRISMA_PROMO_REQUEST_SEQ:0,PRISMA_PROMO_MONTHS_CACHE:{},AUTH_MODE:'corporate',
 document:{getElementById(id){return elements[id]||null}},
 safe:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
   .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
 Date,Set,Number,Array,Math
});
new vm.Script(scripts.slice(a,b),{filename:'PromotionalCalendar.client.js'}).runInContext(ui);
const intervals=ui.conectaPromoPeriodos_([1,2,5,6],30);
assert.equal(intervals.length,2);
assert.equal(intervals[0].start,1);
assert.equal(intervals[1].end,6);
ui.renderPrismaPromoMonth_(result);
assert.ok(elements.promotionalCalendarGrid.innerHTML.includes('Ferrero Rocher'));
assert.ok(elements.promotionalCalendarGrid.innerHTML.includes('Upgrade Teste'));
assert.ok(elements.promotionalCalendarGrid.innerHTML.includes('Vigentes'));
assert.ok(!elements.promotionalCalendarGrid.innerHTML.includes('Promoção oculta'));
assert.equal((elements.promotionalCalendarGrid.innerHTML.match(/class="promotional-calendar-cell/g)||[]).length,42);
ui.renderPrismaPromoMonth_({month:'2026-11',status:'unconfigured',promotions:[]});
assert.ok(elements.promotionalCalendarStatus.textContent.includes('Integração pendente'),
 'Integração sem acesso NÃO pode aparentar zero promoções');
assert.equal(elements.promotionalCalendarGrid.innerHTML,'');

assert.ok(index.includes('id="promotionalRetry"'));
assert.ok(backend.includes('function validarAcessoPromocionalConecta()'));
assert.ok(scripts.includes("if(data&&data.status==='ok')PRISMA_PROMO_MONTHS_CACHE[month]"));
assert.ok(scripts.includes("delete PRISMA_PROMO_MONTHS_CACHE[month]"));
let failures=0;
ui.google={script:{run:{
 withSuccessHandler(success){
   return {withFailureHandler(){
     return {getPrismaPromotionalCalendar(){
       failures++;
       success({status:'unconfigured',month:'2026-11',promotions:[]});
     }};
   }};
 }
}}};
ui.loadPrismaPromoCalendar_();
ui.loadPrismaPromoCalendar_();
assert.equal(failures,2,'Após corrigir propriedade, falha anterior não pode ficar no cache local');
assert.ok(elements.promotionalCalendarStatus.textContent.includes('Integração pendente'));
ui.renderPrismaPromoMonth_({month:'2026-11',status:'source_open_failed',promotions:[]});
assert.ok(elements.promotionalCalendarStatus.textContent.includes('Não foi possível abrir'));
ui.renderPrismaPromoMonth_({month:'2026-11',status:'source_read_failed',promotions:[]});
assert.ok(elements.promotionalCalendarStatus.textContent.includes('A aba do Growth foi localizada'));
assert.ok(!/getProperty\(.*\)\s*=>.*SOURCE_ID_FAKE/.test(backend));
console.log('OK — BR-068: sem cache de falhas, reconsulta e teste autenticado de origem Growth.');

console.log('OK — BR-064: calendários separados, fonte autorizada, cache, promoções ativas, canceladas, escondidas e estado sem conexão.');

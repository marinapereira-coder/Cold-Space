#!/usr/bin/env node
'use strict';
/* BR-063: tests renderings using authorized bootstrap/evaluations mock data,
   without remote services, real stores or real rating changes. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const index=fs.readFileSync(path.join(root,'Index.html'),'utf8');
const scripts=fs.readFileSync(path.join(root,'Scripts.html'),'utf8');
const styles=fs.readFileSync(path.join(root,'Styles.html'),'utf8');
const rules=fs.readFileSync(path.join(root,'docs/BANCO_DE_REGRAS_BACIO_CONECTA.md'),'utf8');

for(const id of ['homeStoreActivity','homeStoreActivityTabs','homeStoreActivityList',
 'homeStoreActivityMore','homeStorePendingCount','homeStoreAnsweredCount','homeStoreTotalCount',
 'homeStoreRating','homeStoreRatingContent']){
 assert.ok(index.includes('id="'+id+'"'),'Home da loja ausente: '+id);
}
assert.equal((index.match(/class="nav-btn(?: active)?"/g)||[]).length,13,
 'O menu com 13 ícones deve continuar disponível');
for(const id of ['home','agenda','cronograma','calendario','avaliacoes','campanhas',
 'comunicados','central','chat','respostas','relatorios','lojas','acessos']){
 assert.ok(index.includes('data-page="'+id+'"'),'Destino original removido: '+id);
}
assert.ok(rules.includes('BR-063')&&rules.includes('respondida'),'Regra BR-063 deve existir');
assert.ok(scripts.includes('initNavigationGroups_();')&&
 scripts.includes('syncNavigationFoldVisibility_();')&&
 scripts.includes('expandNavigationFoldForPage_(page);'),'Integração de submenus ausente');
assert.ok(styles.includes('.conecta-nav-fold-content[hidden]')&&
 styles.includes('.store-rating-summary')&&
 styles.includes('body.dark-mode .app-shell .store-activity-status.is-pending'),
 'Estilos de menu, notas e tema escuro ausentes');
assert.ok(scripts.includes('getStoreEvaluationWorkspace(STORE_ACCESS_TOKEN)')&&
 scripts.includes('getEvaluationWorkspace()'),'Avaliações precisam usar os endpoints oficiais existentes');
assert.ok(!scripts.includes('submitStoreRating('),'Loja não pode atribuir notas pela Minha Área');

const start=scripts.indexOf('function initNavigationGroups_()');
const stop=scripts.indexOf('function renderAgenda(){',start);
assert.ok(start>0&&stop>start,'Funções de Minha Área devem estar disponíveis');
const nodes={};
const ids=['homeStoreActivity','homeStoreActivityList','homeStoreActivityMore','homeStoreRating',
 'homeStoreRatingContent','homeStorePendingCount','homeStoreAnsweredCount','homeStoreTotalCount'];
ids.forEach(id=>{nodes[id]={hidden:true,innerHTML:'',textContent:''}});
const tabs=['pending','answered','all'].map(key=>({
 key,attributes:{},getAttribute(name){return name==='data-store-activity'?this.key:this.attributes[name]},
 setAttribute(name,value){this.attributes[name]=value},
 classList:{toggle(){}}
}));
const context=vm.createContext({
 CURRENT_ROLE:'loja',APP_DATA:{tasks:[
  {id:'1',title:'Resposta em aberto',status:'urgent',statusLabel:'Em atraso',deadlineLabel:'Prazo vencido'},
  {id:'2',title:'Entrega enviada',status:'success',statusLabel:'Respondido',deadlineLabel:'12/11'},
  {id:'3',title:'Correção necessária',status:'warning',statusLabel:'Ajuste necessário',deadlineLabel:'15/11'}
 ]},
 EVALUATION_DATA:null,
 document:{
  getElementById(id){return nodes[id]||null},
  querySelectorAll(sel){return sel==='[data-store-activity]'?tabs:[]}
 },
 safe(value){return String(value==null?'':value).replace(/&/g,'&amp;')
  .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')},
 responseStatusLabel(status){return status==='aprovada'?'Aprovada':status||'Avaliada'},
 starsText(v){const n=Math.round(Number(v));return '★'.repeat(n)+'☆'.repeat(5-n)}
});
new vm.Script(scripts.slice(start,stop),{filename:'store-home.js'}).runInContext(context);

context.renderStoreHomeActivity_();
assert.equal(nodes.homeStoreActivity.hidden,false);
assert.equal(nodes.homeStorePendingCount.textContent,2);
assert.equal(nodes.homeStoreAnsweredCount.textContent,1);
assert.equal(nodes.homeStoreTotalCount.textContent,3);
assert.ok(nodes.homeStoreActivityList.innerHTML.includes('Resposta em aberto'));
assert.ok(nodes.homeStoreActivityList.innerHTML.includes('Correção necessária'));
assert.ok(!nodes.homeStoreActivityList.innerHTML.includes('Entrega enviada'),
 'Respondidas não podem aparecer nas pendências');
context.HOME_STORE_ACTIVITY_FILTER='answered';context.renderStoreHomeActivity_();
assert.ok(nodes.homeStoreActivityList.innerHTML.includes('Entrega enviada'));
assert.ok(!nodes.homeStoreActivityList.innerHTML.includes('Resposta em aberto'));
context.HOME_STORE_ACTIVITY_FILTER='all';context.renderStoreHomeActivity_();
assert.ok(nodes.homeStoreActivityList.innerHTML.includes('Entrega enviada')&&
 nodes.homeStoreActivityList.innerHTML.includes('Resposta em aberto'));
context.renderStoreHomeRating_();
assert.ok(nodes.homeStoreRatingContent.innerHTML.includes('Carregando'));
context.EVALUATION_DATA={summary:{avgStars:4.4,total:3},items:[
 {demandTitle:'Fechamento avaliado',stars:4,status:'aprovada'},
 {demandTitle:'Sem nota válida',stars:null,status:'ajuste_necessario'}
]};
context.renderStoreHomeRating_();
assert.ok(nodes.homeStoreRatingContent.innerHTML.includes('4,4'));
assert.ok(nodes.homeStoreRatingContent.innerHTML.includes('★★★★☆'));
assert.ok(nodes.homeStoreRatingContent.innerHTML.includes('Fechamento avaliado'));
assert.ok(!nodes.homeStoreRatingContent.innerHTML.includes('Sem nota válida'),
 'Avaliação sem estrelas não deve gerar nota fictícia');
context.EVALUATION_DATA={summary:{avgStars:null,total:2},items:[]};
context.renderStoreHomeRating_();
assert.ok(nodes.homeStoreRatingContent.innerHTML.includes('Sem notas oficiais'));
context.CURRENT_ROLE='admin';context.renderStoreHomeActivity_();context.renderStoreHomeRating_();
assert.equal(nodes.homeStoreActivity.hidden,true);
assert.equal(nodes.homeStoreRating.hidden,true);

assert.ok(index.includes('id="homePriorities"')&&styles.includes('#homePriorities[hidden]'),
 'Prioridades da gestão devem continuar existentes, sem duplicar na loja');
assert.ok(index.includes('id="evaluationStarControls"'),
 'Filtro visual por notas oficiais deve existir');
for(const grade of ['all','5','4','3','2','1','none']){
 assert.ok(index.includes('data-eval-grade="'+grade+'"'),'Nota ausente: '+grade);
}
const evalStart=scripts.indexOf('function evaluationMatchesStarFilter_(');
const evalEnd=scripts.indexOf('function renderEvaluations(){',evalStart);
assert.ok(evalStart>0&&evalEnd>evalStart,'Filtro puro por estrelas não encontrado');
new vm.Script(scripts.slice(evalStart,evalEnd),{filename:'evaluation-filter.js'}).runInContext(context);
assert.equal(context.evaluationMatchesStarFilter_({stars:5},'5'),true);
assert.equal(context.evaluationMatchesStarFilter_({stars:4},'5'),false);
assert.equal(context.evaluationMatchesStarFilter_({stars:4},'4'),true);
assert.equal(context.evaluationMatchesStarFilter_({stars:null},'none'),true);
assert.equal(context.evaluationMatchesStarFilter_({stars:undefined},'none'),true);
assert.equal(context.evaluationMatchesStarFilter_({stars:0},'none'),true);
assert.equal(context.evaluationMatchesStarFilter_({stars:3},'all'),true);

console.log('OK — 13 destinos, submenus, pendentes/respondidas, notas oficiais e isolamento da loja.');

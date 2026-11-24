#!/usr/bin/env node
'use strict';

/** Testes isolados do diretório de links do Bacio Conecta.
 * Sem rede, sem acesso a lojas, usuários ou respostas reais.
 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const scripts=fs.readFileSync(path.join(root,'Scripts.html'),'utf8');
const index=fs.readFileSync(path.join(root,'Index.html'),'utf8');
const styles=fs.readFileSync(path.join(root,'Styles.html'),'utf8');
const rules=fs.readFileSync(path.join(root,'docs/BANCO_DE_REGRAS_BACIO_CONECTA.md'),'utf8');

const start=scripts.indexOf('var CENTRAL_LINKS_CATALOG=');
const stop=scripts.lastIndexOf('</script>');
assert.ok(start>0&&stop>start,'Catálogo e bloco da Central precisam existir');
const context=vm.createContext({URL,safe(value){
 return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
 .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}});
new vm.Script(scripts.slice(start,stop),{filename:'CentralOperations.js'}).runInContext(context);
assert.equal(context.CENTRAL_LINKS_CATALOG.length,96,'A Central reúne os 94 links originais e os dois novos aplicativos');

for(const id of ['centralSearchForm','centralSearch','centralSearchClear','centralSearchFeedback',
 'centralDepartmentGrid','centralLinksArea','centralLinksList','centralMainSections',
 'centralViewAllBtn','centralFavoritesToggle','centralFavoritesPanel']){
 assert.ok(index.includes('id="'+id+'"'),'Controle da Central ausente: '+id);
}
for(const item of ['Bacio di Latte','Uni Bacio','Corriere','Portal de Operações']){
 assert.ok(index.includes('<strong>'+item+'</strong>'),'Acesso frequente ausente: '+item);
}
for(const id of Object.keys(context.CENTRAL_DEPARTMENT_LABELS)){
 assert.ok(index.includes('data-central-department="'+id+'"'),'Pasta não encontrada: '+id);
}
assert.ok(index.includes('<strong>Corriere</strong><span>Link oficial a confirmar</span>'),
 'Corriere não pode ser associado a endereço privado ou edição fixa sem validação');
assert.ok(!index.includes('1xiEt-7unlR0Ne322BHZcaUzGzBBMe424'),
 'Não incluir documento corporativo privado no código público');
assert.equal((index.match(/data-central-department="/g)||[]).length,8);
assert.equal((index.match(/data-central-quick="/g)||[]).length,6,'Quatro atalhos originais e dois novos aplicativos');

const base=context.CENTRAL_LINKS_CATALOG.find(x=>x.name==='Base Lojas');
assert.ok(base&&base.department==='operacoes','Base Lojas original ausente');
assert.ok(context.centralMatchesQuery_(base,'base lojas'));
assert.ok(context.centralMatchesQuery_(base,'BÁSE LÓJAS'));
assert.ok(context.centralMatchesQuery_(base,'lojas base'),'Palavras em ordem diferente precisam funcionar');
assert.ok(context.centralMatchesQuery_(base,'planilha operações'),'Busca deve usar tipo e departamento');
assert.ok(!context.centralMatchesQuery_(base,'dedetização'));
assert.ok(!context.centralSafeUrl_('javascript:alert(1)'),'URLs inseguras não podem ser abertas');
assert.ok(context.centralSafeUrl_(base.url).startsWith('https://'));

const classFlags=new Map();
const main={classList:{toggle(key,value){classFlags.set(key,value)}}};
const list={innerHTML:''},input={value:''},results={hidden:true},feedback={textContent:''};
const clear={hidden:true},all={textContent:''},title={textContent:''},subtitle={textContent:''};
const nodes={
 centralLinksList:list,centralSearch:input,centralLinksArea:results,
 centralMainSections:main,centralSearchFeedback:feedback,centralSearchClear:clear,
 centralViewAllBtn:all,centralLinksTitle:title,centralLinksSubtitle:subtitle
};
const folders=Object.keys(context.CENTRAL_DEPARTMENT_LABELS).map(id=>{
 const a={'data-central-department':id,'aria-expanded':'false','aria-pressed':'false'};
 return {
  appended:[],
  getAttribute(name){return a[name]},
  setAttribute(name,value){a[name]=value},
  querySelector(sel){return sel==='.central-department-count'?this.counter:null},
  appendChild(x){this.counter=x;this.appended.push(x)},
  classList:{toggle(){}}
 };
});
context.document={
 getElementById(id){return nodes[id]||null},
 querySelectorAll(sel){return sel==='[data-central-department]'?folders:[]},
 createElement(){return {className:'',textContent:''}}
};

// Inicialmente a biblioteca permanece nas pastas, sem despejar 94 links na tela.
context.renderCentralLinks_();
assert.equal(results.hidden,true);
assert.equal(list.innerHTML,'');
assert.equal(clear.hidden,true);

// Busca mostra resultados imediatamente no painel acima das pastas.
input.value='base lojas';context.renderCentralLinks_();
assert.equal(results.hidden,false);
assert.equal(clear.hidden,false);
assert.equal(classFlags.get('central-is-searching'),true);
assert.ok(list.innerHTML.includes('Base Lojas'),'Resultado Base Lojas deve aparecer imediatamente');
assert.ok(!list.innerHTML.includes('Budget x Tendência'),'A busca não pode exibir links irrelevantes');
assert.ok(feedback.textContent.includes('2 resultados encontrados'));
assert.ok(list.innerHTML.includes('Base Lojas — aplicativo'));
assert.ok(context.CENTRAL_LINKS_CATALOG.some(item=>item.name==='Vendas'&&item.url.endsWith('/exec#hp')&&item.department==='operacoes'));

// Termos com acentos e ordem alternativa.
input.value='lojas base';context.renderCentralLinks_();
assert.ok(list.innerHTML.includes('Base Lojas'));
input.value='CIAO!';context.renderCentralLinks_();
assert.ok(list.innerHTML.includes('CIAO!'),'Busca com pontuação deve encontrar o link');

// Nenhum resultado: estado vazio útil e com feedback.
input.value='xzyqnaonexiste';context.renderCentralLinks_();
assert.equal(results.hidden,false);
assert.ok(list.innerHTML.includes('Nenhum link encontrado'));
assert.ok(feedback.textContent.includes('0 resultados'));

// Pasta selecionada: apenas o departamento, quantidade correta.
input.value='';context.CENTRAL_SELECTED_DEPARTMENT='rh';context.CENTRAL_BROWSE_ALL=false;
context.renderCentralLinks_();
assert.equal(results.hidden,false);
assert.ok(title.textContent.includes('RH & Pessoas'));
assert.ok(list.innerHTML.includes('Folha de Ponto'));
assert.ok(!list.innerHTML.includes('Base Lojas'));

// "Ver todos": catálogo original novamente disponível, mesmo após filtros.
context.CENTRAL_SELECTED_DEPARTMENT='all';context.CENTRAL_BROWSE_ALL=true;
context.renderCentralLinks_();
assert.ok(list.innerHTML.includes('Base Lojas'));
assert.ok(list.innerHTML.includes('Folha de Ponto'));
assert.equal(all.textContent,'Mostrar somente pastas');

// Ponto de volta para as pastas.
context.CENTRAL_BROWSE_ALL=false;context.renderCentralLinks_();
assert.equal(results.hidden,true);
assert.ok(rules.includes('BR-062'),'Banco de Regras deve documentar a pesquisa e as pastas');
assert.ok(styles.includes('.central-search-home')&&styles.includes('.central-main-sections.central-is-searching'));
console.log('OK — Central: catálogo de 96 links, pesquisa visível, acentos, pastas e atalhos preservados.');

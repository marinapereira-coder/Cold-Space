'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=n=>fs.readFileSync(path.join(__dirname,'../..',n),'utf8');
const index=read('Index.html'), client=read('Scripts.html'), server=read('Supabase.js');
const features=read('Features_V2.js'), styles=read('Styles.html'), rules=read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');
assert.ok(index.includes('data-builder-choice="form"')&&
 index.includes('data-builder-choice="grid"')&&index.includes('data-builder-choice="report"'),
 'Três modos devem existir no Criar do zero');
assert.ok(index.includes('gridBuilderPreview')&&index.includes('reportSectionList')&&
 index.includes('questionList')&&index.includes('importModelTab'),
 'Importação e três construtores precisam coexistir');
assert.ok(client.includes("modelSource:MODEL_TAB==='import'?'spreadsheet':MODEL_FORMAT==='grid'?'grid':MODEL_FORMAT==='report'?'report':'manual'"),
 'Cada tipo salva seu próprio model_source');
assert.ok(client.includes('manualGridTableHtml_(d.modelFields[0],previousAnswers,false)'),
 'A planilha é preenchida na própria grade pela loja');
assert.ok(client.includes("if(d.modelSource==='report')")&&
 client.includes('Preenchimento do relatório'),'Relatório mostra campos narrativos na loja');
assert.ok(client.includes("if(f.type==='grid')return '<div class=\"bacio-review-block\""),
 'A avaliação da gestão mostra a grade preenchida');
assert.ok(client.includes("GRID_CONFIG={title:field.label||'Planilha de conferência'"),
 'Edição existente preserva as linhas, colunas e título');
assert.ok(server.includes('columns: String(f.type')&&server.includes('rows: String(f.type'),
 'O servidor não pode descartar as definições de planilha');
assert.ok(server.includes('validateCustomModelAnswers_(input.answers||{},detail)')&&
 features.includes('validateCustomModelAnswers_(input.answers||{},detail)'),
 'Ambos os canais de autenticação precisam validar o mesmo modelo');
assert.ok(styles.lastIndexOf('</style>')>styles.indexOf('.bacio-manual-grid{')&&
 index.includes('gridColumnList')&&styles.includes('.bacio-builder-options'),
 'O estilo da grade precisa ficar dentro de <style>');
assert.ok(rules.includes('BR-044'),'Banco de regras precisa incluir os novos formatos');
const start=server.indexOf('function validateCustomModelAnswers_('),end=server.indexOf('function submitDemandResponse(',start);
assert.ok(start>=0&&end>start);
const ctx=vm.createContext({});
vm.runInContext(server.slice(start,end),ctx);
const grid={
 modelSource:'grid',responseRequired:true,
 modelFields:[{id:'manual_grid',type:'grid',columns:[
  {label:'Confirmação',type:'boolean',required:true},
  {label:'Observação',type:'text',required:false},
  {label:'Quantidade',type:'number',required:false}
 ],rows:['Item A','Item B']}]
};
const good={gridcell_manual_grid_0_0:'Sim',gridcell_manual_grid_1_0:'Não',
 gridcell_manual_grid_0_1:'Entrega correta',gridcell_manual_grid_1_2:'42'};
assert.doesNotThrow(()=>ctx.validateCustomModelAnswers_(good,grid));
assert.throws(()=>ctx.validateCustomModelAnswers_({...good,gridcell_manual_grid_0_4:'fora'},grid),/não autorizado/);
assert.throws(()=>ctx.validateCustomModelAnswers_({gridcell_manual_grid_0_0:'Sim'},grid),/obrigatórios/);
assert.throws(()=>ctx.validateCustomModelAnswers_({...good,gridcell_manual_grid_1_0:'talvez'},grid),/Selecione Sim/);
assert.throws(()=>ctx.validateCustomModelAnswers_({...good,gridcell_manual_grid_1_2:'xx'},grid),/Número inválido/);
assert.throws(()=>ctx.validateCustomModelAnswers_({...good,gridcell_manual_grid_1_2:'a'.repeat(2001)},grid),/2.000 caracteres/);
const optional={...grid,responseRequired:false};
assert.doesNotThrow(()=>ctx.validateCustomModelAnswers_({},optional));
const report={modelSource:'report',responseRequired:true,modelFields:[
 {id:'sec1',label:'Resumo',type:'textarea',required:true},
 {id:'sec2',label:'Data',type:'date',required:false}
]};
assert.doesNotThrow(()=>ctx.validateCustomModelAnswers_({sec1:'Inspeção realizada.',sec2:'2026-11-02'},report));
assert.throws(()=>ctx.validateCustomModelAnswers_({},report),/obrigatórios/);
assert.throws(()=>ctx.validateCustomModelAnswers_({sec1:'a',sec2:'amanhã'},report),/Data inválida/);
assert.throws(()=>ctx.validateCustomModelAnswers_({sec1:'a',admin:'vazar'},report),/não autorizado/);
assert.doesNotThrow(()=>ctx.validateCustomModelAnswers_({}, {modelSource:'manual'}),'Fluxo antigo preservado');
const gridStart=client.indexOf('function manualGridTableHtml_('),gridEnd=client.indexOf('function newField(',gridStart);
assert.ok(gridStart>=0&&gridEnd>gridStart);
const safe=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=vm.createContext({safe});
vm.runInContext(client.slice(gridStart,gridEnd),ui);
const html=ui.manualGridTableHtml_(grid.modelFields[0],good,false);
assert.ok(html.includes('<table')&&html.includes('gridcell_manual_grid_0_0')&&
 html.includes('data-required="1"')&&html.includes('textarea')&&
 html.includes('type="number"')&&html.includes('Sim'),'Grade editável com colunas e linhas');
const readOnly=ui.manualGridTableHtml_(grid.modelFields[0],good,true);
assert.ok(readOnly.includes('Entrega correta')&&!readOnly.includes('answer-input'),
 'A gestão recebe versão de consulta, não campos editáveis');
console.log('OK — Formulário, planilha manual, relatório, correção, campos obrigatórios e segurança.');

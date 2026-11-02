'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const load=name=>fs.readFileSync(path.join(__dirname,'../..',name),'utf8');
const client=load('Scripts.html'),backend=load('Supabase.js'),features=load('Features_V2.js'),index=load('Index.html');
assert.ok(client.includes("oninput=function(){renderStorePicker();}"),'O evento de digitação não passa InputEvent como seleção');
assert.ok(client.includes('STORE_PICKER_SELECTED'), 'A seleção de outras páginas do filtro deve ser preservada');
assert.ok(client.includes("rows:[]};IMPORTED_FIELDS=[];"),'Nova planilha não obriga linhas fixas');
assert.ok(index.includes('id="gridRowsSection" style="display:none"'),'Criador mostra somente colunas em modelos novos');
assert.ok(client.includes('addManualGridResponseRow_')&&client.includes('gridRows'),'Loja pode adicionar linhas');
assert.ok(backend.includes("if(field.rows.length){"),'Compatibilidade de modelos antigos');
const safe=x=>String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pickerStart=client.indexOf('function normalizePickerQuery_('),pickerEnd=client.indexOf('function renderAudienceRouting(',pickerStart);
assert.ok(pickerStart>=0&&pickerEnd>pickerStart);
const pickerHost={innerHTML:'',querySelectorAll:()=>[]},pickerSearch={value:'tésté'};
const stores=[{id:'1',codigo:'0001',nome:'OSCAR FREIRE',cidade:'São Paulo'},
 {id:'TESTE_CONECTA',codigo:'TESTE',nome:'LOJA TESTE - HOMOLOGAÇÃO',cidade:'Homologação'}];
const pickerCtx=vm.createContext({APP_DATA:{stores},STORE_PICKER_SELECTED:{},safe,
 document:{getElementById:id=>id==='storePickerList'?pickerHost:pickerSearch,querySelectorAll:()=>[]}});
vm.runInContext(client.slice(pickerStart,pickerEnd),pickerCtx);
pickerCtx.renderStorePicker(['TESTE_CONECTA']);
assert.ok(pickerHost.innerHTML.includes('LOJA TESTE - HOMOLOGAÇÃO')&&!pickerHost.innerHTML.includes('OSCAR FREIRE'),'Busca com acentos identifica a unidade teste');
assert.ok(pickerHost.innerHTML.includes('checked'),'Seleção aparece marcada');
pickerSearch.value='oscar';pickerCtx.renderStorePicker();
assert.ok(pickerHost.innerHTML.includes('OSCAR FREIRE')&&!pickerHost.innerHTML.includes('LOJA TESTE'),'Termo filtra corretamente');
assert.deepEqual(Object.keys(pickerCtx.STORE_PICKER_SELECTED),['TESTE_CONECTA'],'Seleção continua ativa mesmo invisível');
// Testa a grade com zero linhas na definição e quantidade variável por resposta.
const gridStart=client.indexOf('function manualGridRows_('),gridEnd=client.indexOf('function newField(',gridStart);
assert.ok(gridStart>=0&&gridEnd>gridStart);
const gridCtx=vm.createContext({safe});
vm.runInContext(client.slice(gridStart,gridEnd),gridCtx);
const grid={id:'manual_grid',type:'grid',label:'Levantamento',rows:[],columns:[
 {label:'Produto',type:'text',required:true},{label:'Quantidade',type:'number',required:true},
 {label:'Obs.',type:'text',required:false}]};
const response1={gridcell_manual_grid_0_0:'Sorvete',gridcell_manual_grid_0_1:'12',
 gridcell_manual_grid_1_0:'Cobertura',gridcell_manual_grid_1_1:'7'};
assert.equal(gridCtx.manualGridRows_(grid,{},0).length,1,'Primeira linha aparece vazia para a loja');
assert.equal(gridCtx.manualGridRows_(grid,response1,0).length,2,'Correção restaura as linhas da loja');
assert.equal(gridCtx.manualGridRows_(grid,response1,3).length,3,'Botão acrescenta linha abaixo');
assert.ok(gridCtx.manualGridTableHtml_(grid,response1,false).includes('gridcell_manual_grid_1_1'),
 'Planilha editável tem 2 linhas da resposta');
assert.ok(gridCtx.manualGridTableHtml_(grid,response1,true).includes('Sorvete'),
 'Gestão vê conteúdo enviado sem editar');
const fixed={...grid,rows:['Item predefinido']};
assert.equal(gridCtx.manualGridRows_(fixed,{},20).length,1,'Grade antiga com linhas fixas permanece igual');
const validStart=backend.indexOf('function validateCustomModelAnswers_('),validEnd=backend.indexOf('function submitDemandResponse(',validStart);
assert.ok(validStart>=0&&validEnd>validStart);
const validate=vm.createContext({});
vm.runInContext(backend.slice(validStart,validEnd),validate);
const detail={modelSource:'grid',responseRequired:true,modelFields:[grid]};
assert.doesNotThrow(()=>validate.validateCustomModelAnswers_(response1,detail),'Duas linhas são aceitas');
assert.throws(()=>validate.validateCustomModelAnswers_({},detail),/ao menos uma linha/);
assert.throws(()=>validate.validateCustomModelAnswers_({gridcell_manual_grid_0_0:'Sorvete'},detail),/obrigatórios/);
assert.throws(()=>validate.validateCustomModelAnswers_({...response1,gridcell_manual_grid_1_3:'extra'},detail),/não autorizado/);
assert.throws(()=>validate.validateCustomModelAnswers_({...response1,gridcell_manual_grid_50_0:'outro'},detail),/não autorizado/);
assert.throws(()=>validate.validateCustomModelAnswers_({...response1,gridcell_manual_grid_0_1:'xx'},detail),/Número inválido/);
assert.doesNotThrow(()=>validate.validateCustomModelAnswers_({}, {...detail,responseRequired:false}),'Resposta não obrigatória pode ficar vazia');
// Testa relatório com lojas distintas e correção posterior; apenas última entrega.
const reportsStart=features.indexOf('function getDemandReportsWorkspace()');
assert.ok(reportsStart>=0);
const demands=[{id:'d1',titulo:'Estoque',model_source:'grid',model_fields:[grid],
 loja_ids:[],status:'active',tipo:'demanda',ativa:true,cronograma:{}}];
const reportResponses=[
 {id:'old',demanda_id:'d1',loja_id:'1',usuario_email:'a@bdil.com.br',status:'ajuste_necessario',
  created_at:'2026-11-01T10:00:00Z',resposta_json:{gridcell_manual_grid_0_0:'Antigo',gridcell_manual_grid_0_1:'99'}},
 {id:'new',demanda_id:'d1',loja_id:'1',usuario_email:'a@bdil.com.br',status:'respondido',
  created_at:'2026-11-02T10:00:00Z',resposta_json:response1},
 {id:'other',demanda_id:'d1',loja_id:'2',usuario_email:'b@bdil.com.br',status:'respondido',
  created_at:'2026-11-02T09:00:00Z',resposta_json:{gridcell_manual_grid_0_0:'Gelato',gridcell_manual_grid_0_1:'5'}}
];
const reportCtx=vm.createContext({
 getCurrentAuthContext_:()=>({user:{role:'admin'}}),roleOf_:u=>u.role,
 getVisibleStores_:()=>[{id:'1',codigo:'0001',nome:'OSCAR FREIRE'},{id:'2',codigo:'0002',nome:'MOEMA'}],
 table_:(k,def)=>def,normalizeObjectArray_:x=>x||[],normalizeJsonObject_:x=>x||{},
 getTargetStoreIds_:(d,ids)=>ids,isConectaTestDemand_:()=>false,isConectaTestStoreId_:()=>false,
 safeSupabaseSelect_:url=>url.includes('bacio_demandas')?demands:url.includes('bacio_demanda_respostas')?reportResponses:[],
 mapEvaluationRowV2_:()=>null,roundOneV2_:x=>Math.round(x*10)/10,Date
});
vm.runInContext(features.slice(reportsStart),reportCtx);
const group=reportCtx.getDemandReportsWorkspace().groups[0];
assert.equal(group.gridRows.length,3,'Linhas de duas lojas consolidadas na mesma planilha');
assert.equal(group.gridRows.filter(r=>r.storeId==='1').length,2,'Última resposta da loja substitui a anterior');
assert.ok(!group.gridRows.some(r=>r.values.includes('Antigo')),'Correção anterior não contamina relatório');
assert.ok(group.gridRows.some(r=>r.storeId==='2'&&r.storeName.includes('MOEMA')),'Identificação automática da segunda loja');
assert.deepEqual(Array.from(group.gridColumns),['Produto','Quantidade','Obs.']);
assert.ok(client.includes('Exportar planilha (CSV)')&&client.includes('exportGridReportCSV_'),
 'Relatórios têm botão de download da planilha consolidada');
console.log('OK — Busca por teste, linhas dinâmicas, isolamento de lojas e CSV consolidado.');

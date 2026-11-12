'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'../..',f),'utf8');
const script=read('Scripts.html'),backend=read('Supabase.js'),
 features=read('Features_V2.js'),index=read('Index.html'),styles=read('Styles.html');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const model={id:'field1',label:'Quais produtos?',type:'multi_select',required:true,options:['A','B','C']};
const builderStart=script.indexOf('function renderManualQuestions(){');
const builderEnd=script.indexOf('// Importador multiabas',builderStart);
assert.ok(builderStart>=0&&builderEnd>builderStart,'Construtor localizado');
const host={innerHTML:'',querySelectorAll(){return []}};
const ctx=vm.createContext({
 MANUAL_FIELDS:[{...model,options:['A','B']}],
 document:{getElementById:()=>host,querySelector:()=>null},safe:esc,showToast:()=>{},
 newField:()=>({id:'new',label:'',type:'text',required:true,options:[]})
});
vm.runInContext(script.slice(builderStart,builderEnd),ctx);
ctx.renderManualQuestions();
assert.ok(host.innerHTML.includes('bacio-option-add')&&
 host.innerHTML.includes('bacio-option-remove')&&
 host.innerHTML.includes('Múltipla escolha (várias respostas)'), 'Botões + / remover e novo tipo aparecem');
assert.ok(!host.innerHTML.includes('Opções separadas por vírgula'),'Não exigir vírgula');
ctx.addManualChoice_(0,0);
assert.equal(ctx.MANUAL_FIELDS[0].options.length,3,'Botão + insere alternativa após a escolhida');
ctx.MANUAL_FIELDS[0].options[1]='C';
ctx.removeManualChoice_(0,2);
assert.deepEqual(Array.from(ctx.MANUAL_FIELDS[0].options),['A','C'],'Remover opção preserva as demais');
assert.ok(ctx.questionTypeOptions('select').includes('Lista de opções (uma resposta)'),
 'Lista de opção única permanece disponível');
const start=script.indexOf('function selectedMultipleAnswers_('),end=script.indexOf('function submitStoreResponse(',start);
assert.ok(start>0&&end>start);
const response=vm.createContext({safe:esc});
vm.runInContext(script.slice(start,end),response);
const form=response.responseInput(model,'["A","C"]');
assert.ok(form.includes('answer-multi-select')&&form.includes('type="checkbox"'));
assert.equal((form.match(/ checked/g)||[]).length,2,'Correção preenche as caixas já marcadas');
assert.deepEqual(Array.from(response.selectedMultipleAnswers_('["A","C"]')),['A','C']);
const answers={};
const selected=[{value:'A'},{value:'C'}];
const group={dataset:{key:'field1'},getAttribute:x=>x==='data-required'?'1':null,
 querySelectorAll:()=>selected};
const formHost={querySelectorAll:()=>[group]};
assert.equal(response.collectMultipleAnswers_(formHost,answers).length,0);
assert.equal(answers.field1,'["A","C"]','Respostas são serializadas por campo');
selected.splice(0);
assert.equal(response.collectMultipleAnswers_(formHost,answers).length,1,'Pergunta obrigatória exige uma marcação');
const vs=backend.indexOf('function validateMultipleChoiceAnswers_('),
 ve=backend.indexOf('function submitDemandResponse(',vs);
assert.ok(vs>0&&ve>vs,'Validação no servidor presente');
const validation=vm.createContext({});
vm.runInContext(backend.slice(vs,ve),validation);
const detail={modelSource:'manual',responseRequired:true,modelFields:[model]};
assert.doesNotThrow(()=>validation.validateMultipleChoiceAnswers_({field1:'["A","C"]'},detail));
assert.throws(()=>validation.validateMultipleChoiceAnswers_({field1:'["D"]'},detail),/não cadastrada/);
assert.throws(()=>validation.validateMultipleChoiceAnswers_({field1:'["A","A"]'},detail),/repetida/);
assert.throws(()=>validation.validateMultipleChoiceAnswers_({field1:'[]'},detail),/obrigatória/);
assert.throws(()=>validation.validateMultipleChoiceAnswers_({field1:'not-json'},detail),/inválida/);
assert.doesNotThrow(()=>validation.validateMultipleChoiceAnswers_({field1:'[]'},{...detail,responseRequired:false}));
assert.ok(backend.includes('validateMultipleChoiceAnswers_(input.answers||{},detail)')&&
 features.includes('validateMultipleChoiceAnswers_(input.answers||{},detail)'),'Validação em ambos os acessos');
const pubStart=script.indexOf('function updateDemandSaveAction_('),
 pubEnd=script.indexOf('function saveCampaign(',pubStart);
assert.ok(pubStart>0&&pubEnd>pubStart);
let status={value:'draft'},routing={value:'lojas'},button={textContent:''},hint={textContent:''};
const fields={fStatus:status,fAudienceGroup:routing,saveCampaignBtn:button,fPublicationHint:hint};
const pub=vm.createContext({CURRENT_ROLE:'admin',document:{getElementById:id=>fields[id]}});
vm.runInContext(script.slice(pubStart,pubEnd),pub);
pub.updateDemandSaveAction_();
assert.equal(button.textContent,'Salvar como rascunho');
assert.ok(hint.textContent.includes('não aparece'));
status.value='active';pub.updateDemandSaveAction_();
assert.equal(button.textContent,'Publicar e notificar lojas');
routing.value='consultor';pub.updateDemandSaveAction_();
assert.equal(button.textContent,'Publicar e notificar destinatário','BR-061 permite publicação interna apenas para destinatário validado no servidor');
assert.ok(index.includes('id="fPublicationHint"')&&styles.includes('.bacio-option-add'));
assert.ok(read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md').includes('BR-047'));
assert.ok(script.includes('collectMultipleAnswers_(document.getElementById(')&&
 script.includes('missing=missing.concat(collectMultipleAnswers_(host,answers));'),
 'Submissão real e simulada reúnem seleções marcadas');
console.log('OK — Opções com +, múltipla escolha validada e rascunho/publicação explícitos.');

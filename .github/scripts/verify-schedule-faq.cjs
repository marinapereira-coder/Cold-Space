'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('Cronograma.html','utf8').split('<script>')[1].split('</script>')[0];
const listeners={},root={dataset:{},addEventListener:(n,f)=>listeners[n]=f};
const NativeDate=Date;
class Clock extends NativeDate{constructor(...args){super(...(args.length?args:['2026-11-12T21:30:00Z']));}static now(){return new NativeDate('2026-11-12T21:30:00Z').getTime();}}
const app={user:{email:'ana@bdil.com.br',role:'admin'},stores:[{id:'1',nome:'Loja A',consultor:'Ana'},{id:'2',nome:'Loja B',consultor:'Bia'}],managementItems:[
 {id:'a',title:'Entrega A',owner:'ana@bdil.com.br',deadline:'2026-11-12T21:00:00Z',totalStores:1,targetStoreIds:['1'],cronograma:{departamentoSolicitante:'TI'}},
 {id:'b',title:'Entrega B',owner:'outra@bdil.com.br',deadline:'2026-11-12T23:00:00Z',totalStores:1,targetStoreIds:['2'],cronograma:{departamentoSolicitante:'RH'}},
 {id:'c',title:'Rascunho consultor',owner:'ana@bdil.com.br',deadline:'2026-11-13T21:00:00Z',timelineStatus:'draft',cronograma:{direcionamento:{modo:'consultor'}}}
]};
const ctx={window:{APP_DATA:app},document:{getElementById:()=>root},Intl,Date:Clock,requestDepartment:x=>x.cronograma.departamentoSolicitante||'Operações'};
vm.runInNewContext(source,ctx);ctx.window.renderConectaCronograma();
assert.match(root.innerHTML,/12\/11\/2026, 18:00/,'Exibe horário local do prazo');
assert.match(root.innerHTML,/bc-sched-badge late/,'Prazo vencido hoje já é atraso');
assert.match(root.innerHTML,/bc-sched-badge due_today/,'Prazo futuro hoje ainda vence hoje');
function change(id,value,checked){listeners.change({target:{id,value,checked}});}
change('bcSchedStore','1');assert.match(root.innerHTML,/Entrega A/);assert.ok(!root.innerHTML.includes('Entrega B'));
change('bcSchedArea','RH');assert.ok(!root.innerHTML.includes('Entrega A'),'Filtros combinam na mesma demanda');
change('bcSchedStore','');change('bcSchedArea','');change('bcSchedAudience','consultor');assert.match(root.innerHTML,/Rascunho consultor/);assert.ok(!root.innerHTML.includes('Entrega A'));
change('bcSchedAudience','');change('bcSchedMine','',true);assert.ok(!root.innerHTML.includes('Entrega B'));
app.user.email='';ctx.window.renderConectaCronograma();assert.ok(!root.innerHTML.includes('Entrega A'),'E-mail vazio não corresponde a qualquer responsável');
const faq=fs.readFileSync('FAQ.html','utf8');new vm.Script(faq.split('<script>')[1].split('</script>')[0]);
assert.ok(!/google\.script\.run|fetch\(|localStorage|sessionStorage/.test(faq),'FAQ não acessa conversas, não grava nem transmite dados');
assert.ok(fs.readFileSync('Index.html','utf8').includes("include('FAQ')"));
console.log('OK — cronograma: horário, atraso no mesmo dia, filtros combinados, autoria exata; FAQ sem transmissões.');

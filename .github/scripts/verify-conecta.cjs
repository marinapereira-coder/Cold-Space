#!/usr/bin/env node
'use strict';

/**
 * Banco de Regras — gate local/CI do Bacio Conecta.
 * Executar: node .github/scripts/verify-conecta.cjs
 * Sem rede, credenciais ou alterações de dados reais.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');

const legacy = read('Features.js');
const modern = read('Features_V2.js');
const scripts = read('Scripts.html');
const index = read('Index.html');
const styles = read('Styles.html');
const rules = read('docs/BANCO_DE_REGRAS_BACIO_CONECTA.md');

for (const [name, source] of [['Features.js', legacy], ['Features_V2.js', modern]]) {
  new vm.Script(source, {filename:name});
}
new vm.Script(scripts.replace(/^\s*<script>\s*/i, '').replace(/\s*<\/script>\s*$/i, ''), {filename:'Scripts.html'});

const countDeclaration = (name) => {
  const pattern = new RegExp('\\bfunction\\s+' + name + '\\s*\\(', 'g');
  return (legacy.match(pattern)||[]).length + (modern.match(pattern)||[]).length;
};
const uniqueChatEndpoints = [
  'getChatWorkspace', 'getStoreChatWorkspace',
  'getChatMessages', 'getStoreChatMessages',
  'sendContextChatMessage', 'sendStoreContextChatMessage',
  'getChatDirectMessages', 'getStoreChatDirectMessages',
  'sendChatDirectMessage', 'sendStoreChatDirectMessage'
];
for (const name of uniqueChatEndpoints) {
  assert.equal(countDeclaration(name), 1, 'Endpoint de chat duplicado/ausente: '+name);
}
assert.ok(legacy.includes('function legacyGetChatWorkspace_('), 'A versão antiga não pode sobrescrever o chat V2');
assert.ok(legacy.includes('function legacyGetChatMessages_('), 'Função antiga de leitura conflitante');
assert.ok(legacy.includes('function legacySendContextChatMessage_('), 'Função antiga de envio conflitante');
assert.ok(index.includes('data-chat-tab="lojas"'));
assert.ok(index.includes('data-chat-tab="adm"'));
assert.ok(!index.includes('data-chat-tab="demandas"'), 'Não voltar com a aba Demandas no chat');
assert.ok(index.includes('id="accessNavBtn"'), 'Gestão de usuários desapareceu');
assert.ok(scripts.includes('syncVerifiedPortalRole_'), 'Manter verificação do administrador');
assert.ok(styles.includes('overflow-y:auto'), 'O menu não pode voltar a esconder o acesso');
assert.ok(rules.includes('BR-001') && rules.includes('BR-010'), 'Banco de Regras incompleto');

const stores = Array.from({length:269}, (_,i) => ({
  id:String(i+1),nome:'LJ '+String(i+1).padStart(4,'0')+' - TESTE',
  codigo:String(i+1),ativa:true,email:'lj'+i+'@bdil.com.br',dados_extras:{}
}));
const users = [
  {email:'admin@bdil.com.br',nome:'Admin',role:'admin',ativo:true},
  {email:'operacoes@bdil.com.br',nome:'Operações',role:'admin',ativo:true},
  {email:'growth@bdil.com.br',nome:'Growth',role:'growth',ativo:true},
  {email:'loja@bdil.com.br',nome:'Loja',role:'loja',ativo:true},
  {email:'inativo@bdil.com.br',nome:'Inativo',role:'admin',ativo:false}
];

function checkOrder(sourceOrder) {
  const writes=[];
  let actingUser=users[0];
  const auth=()=>({user:actingUser,email:actingUser.email});
  const request=(url,method,payload)=>{
    if(url.includes('bacio_lojas'))return stores;
    if(url.includes('bacio_usuarios'))return users.filter(u=>u.ativo);
    if(url.includes('bacio_chat_mensagens')){
      if(method==='post'){writes.push(payload);return [{id:'new-msg',...payload}];}
      return [];
    }
    throw new Error('Consulta inesperada: '+url);
  };
  const ctx = vm.createContext({
    getCurrentAuthContext_:auth,
    getStoreAuthContext_:()=>auth(),
    getVisibleStores_:u=>u.role==='loja'?stores.filter(s=>s.id==='6'):u.role==='consultor'?stores.slice(0,2):stores,
    roleOf_:u=>u.role,
    isDepartmentUser_:u=>u.role==='growth',
    table_:(_k,fallback)=>fallback,
    supabaseRequest_:request,
    safeSupabaseSelect_:(url,fallback)=>{
      if(url.includes('bacio_chat_mensagens'))return [{
        id:'msg-1',usuario_email:'operacoes@bdil.com.br',
        usuario_nome:'Operações',mensagem:'Mensagem existente',
        conversa_loja_id:'6',created_at:'2026-10-31T15:00:00Z'
      }];
      return request(url,'get')||fallback;
    },
    parseJsonObject_:v=>v||{},
    console:{log(){},warn(){},error(){}}
  });
  for(const part of sourceOrder){
    vm.runInContext(part==='legacy'?legacy:modern,ctx,{filename:part+'.js'});
  }
  let directory=ctx.getChatWorkspace();
  assert.equal(directory.storeContacts.length,269,'Todas as lojas devem carregar para admin');
  assert.equal(directory.peopleContacts.length,2,'ADM inclui somente outros logins não-loja ativos');
  assert.equal(directory.storeContacts[5].title,'LJ 0006 - TESTE');
  assert.equal(directory.threads[5].storeId,'6');
  assert.equal(directory.threads[5].demandId,'');
  const messages=ctx.getChatMessages({storeId:'6',demandId:''});
  assert.equal(messages[0].message,'Mensagem existente');
  assert.equal(messages[0].storeId,'6');
  const sent=ctx.sendContextChatMessage({storeId:'6',demandId:'',message:'Teste automático'});
  assert.equal(sent.ok,true);
  assert.equal(writes[0].conversa_loja_id,'6');
  assert.equal(writes[0].demanda_id,null);
  assert.equal(writes[0].mensagem,'Teste automático');
  assert.equal(ctx.getChatDirectMessages({recipientEmail:'growth@bdil.com.br'}).length,0);
  ctx.sendChatDirectMessage({recipientEmail:'growth@bdil.com.br',message:'Mensagem ADM'});
  assert.equal(writes[1].destinatario_email,'growth@bdil.com.br');
  assert.ok(writes[1].conversa_usuario_chave.includes('growth@bdil.com.br'));
  assert.equal(writes[1].conversa_loja_id,null);

  // A loja não pode abrir a conversa de outra loja.
  actingUser={email:'loja@bdil.com.br',nome:'Loja',role:'loja',loja_id:'6',ativo:true};
  const onlyOwn=ctx.getChatVisibleStoresV2_(actingUser);
  assert.equal(onlyOwn.length,1);
  assert.equal(onlyOwn[0].id,'6');
  assert.throws(()=>ctx.getChatMessages({storeId:'7',demandId:''}),/acesso a esta conversa/);
  return directory.storeContacts.length;
}

assert.equal(checkOrder(['legacy','modern']),269);
assert.equal(checkOrder(['modern','legacy']),269);
console.log('OK — Banco de Regras: chat V2, ADM, histórico, envio, escopo, menu e duas ordens de carga.');

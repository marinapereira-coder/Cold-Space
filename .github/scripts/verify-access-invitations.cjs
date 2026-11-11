'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const backend = fs.readFileSync('Features_V2.js', 'utf8');
const frontend = fs.readFileSync('Scripts.html', 'utf8');
const start = backend.indexOf('\nfunction bacioInvitationEscape_(');
const end = backend.indexOf('\nfunction createStoreAccess(', start);
assert(start > 0 && end > start, 'Funções do convite devem existir no backend');
const invitationCode = backend.slice(start, end);

const sent = [];
let rows = [];
let isAdmin = true;
let props = {
  BACIO_CONECTA_URL: 'https://script.google.com/macros/s/AKfyEXAMPLE/exec'
};
const ctx = {
  Date, encodeURIComponent,
  PropertiesService: {getScriptProperties: () => ({getProperty: key => props[key] || ''})},
  requireAdmin_: () => {
    if (!isAdmin) throw new Error('Somente administradores');
    return {email:'gestora@bdil.com.br',user:{role:'admin'}};
  },
  roleOf_: u => String(u.role || '').toLowerCase(),
  isDepartmentUser_: u => ['marketing','rh','qualidade','treinamento','comercial','growth','ti'].includes(u.role),
  validateAllowedDomain_: email => {
    if (!email.endsWith('@bdil.com.br')) throw new Error('E-mail corporativo inválido');
  },
  table_: (_key, fallback) => fallback,
  supabaseRequest_: (path,method) => {
    assert.equal(method,'get');
    assert.match(path,/^\/rest\/v1\/bacio_usuarios\?select=/);
    return rows;
  },
  MailApp: {sendEmail: options => sent.push(options)}
};
vm.createContext(ctx);
vm.runInContext(invitationCode,ctx);

function invite(id='user-1'){ return ctx.sendConectaAccessInvitation({userId:id}); }
function activeUser(role='loja', provider='password', authId='auth-1') {
  return {id:'user-1',email:role==='loja'?'loja@example.com':'pessoa@bdil.com.br',
    nome:'Pessoa <Teste>',role,ativo:true,auth_provider:provider,auth_user_id:authId};
}
rows=[activeUser('loja')];
assert.equal(invite().ok,true);
assert.equal(sent.length,1);
assert.equal(sent[0].to,'loja@example.com');
assert.match(sent[0].body,/view=loja/);
assert.match(sent[0].htmlBody,/Pessoa &lt;Teste&gt;/);
assert.match(sent[0].body,/senha temporária fornecida pelo administrador/);
assert.doesNotMatch(sent[0].body,/auth-1|service.role|supabase_key/i);

sent.length=0;
rows=[activeUser('admin','google','')];
assert.equal(invite().ok,true);
assert.equal(sent.length,1);
assert.doesNotMatch(sent[0].body,/view=loja/);
assert.match(sent[0].body,/conta Google corporativa/);

sent.length=0;
rows=[activeUser('marketing','password','auth-marketing')];
assert.equal(invite().ok,true);
assert.match(sent[0].body,/view=loja/);

sent.length=0;
rows=[activeUser('loja')]; rows[0].ativo=false;
assert.throws(invite,/Ative este usuário/);
assert.equal(sent.length,0);

rows=[];
assert.throws(invite,/não foi encontrado/);
assert.equal(sent.length,0);

rows=[activeUser('loja','password','')];
assert.throws(invite,/não possui login com senha/);
assert.equal(sent.length,0);

rows=[activeUser('loja')];
isAdmin=false;
assert.throws(invite,/Somente administradores/);
assert.equal(sent.length,0);
isAdmin=true;

props={};
assert.throws(invite,/Configure BACIO_CONECTA_URL/);
assert.equal(sent.length,0);

assert.match(frontend,/function sendAccessInvitation\(userId,email\)/);
assert.match(frontend,/sendConectaAccessInvitation\(\{userId:userId\}\)/);
assert.match(frontend,/id="accessSendInvitation"/);
assert.match(frontend,/Enviar convite/);
assert.match(frontend,/Usuário criado, mas o convite não foi enviado/);
console.log('OK: convites de acesso, permissões, URLs, dados e interface.');

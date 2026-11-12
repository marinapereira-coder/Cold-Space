const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('Scripts.html','utf8');
const code=source.slice(source.indexOf('var STORE_REMEMBER_UNTIL='),source.indexOf('function switchProfileLogin'));
function storage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}}
const local=storage(),session=storage(),els={loading:{style:{}},storeRememberMe:{checked:false}};
let boot=0,refresh=0,login=0;
const ctx=vm.createContext({localStorage:local,sessionStorage:session,Date,Number,JSON,document:{getElementById:id=>els[id]},STORE_ACCESS_TOKEN:'',STORE_REFRESH_TOKEN:'',showToast(){},showStoreLogin(){login++},tryStoreRefreshOrLogin(){refresh++},startApp(){boot++}});
vm.runInContext(code,ctx);
ctx.STORE_ACCESS_TOKEN='access';ctx.STORE_REFRESH_TOKEN='refresh';ctx.persistStoreSession_();assert.equal(local.getItem(ctx.STORE_REMEMBER_KEY),null);
const expiry=Date.now()+30*86400000;ctx.STORE_REMEMBER_UNTIL=expiry;ctx.persistStoreSession_();
assert.deepEqual(Object.keys(JSON.parse(local.getItem(ctx.STORE_REMEMBER_KEY))).sort(),['expiresAt','refreshToken']);
ctx.STORE_REFRESH_TOKEN='rotated';ctx.persistStoreSession_();assert.equal(ctx.readRememberedStoreSession_().expiresAt,expiry);assert.equal(ctx.readRememberedStoreSession_().refreshToken,'rotated');
session.removeItem('bacio_store_access');session.removeItem('bacio_store_refresh');ctx.handleEntryState({});assert.equal(refresh,1);assert.equal(ctx.STORE_REFRESH_TOKEN,'rotated');
local.setItem(ctx.STORE_REMEMBER_KEY,JSON.stringify({refreshToken:'old',expiresAt:Date.now()-1}));assert.equal(ctx.readRememberedStoreSession_(),null);assert.equal(local.getItem(ctx.STORE_REMEMBER_KEY),null);
local.setItem(ctx.STORE_REMEMBER_KEY,'broken');assert.equal(ctx.readRememberedStoreSession_(),null);
ctx.handleEntryState({authenticated:true,bootstrap:{}});assert.equal(boot,1);
ctx.STORE_REMEMBER_UNTIL=expiry;local.setItem=()=>{throw Error('blocked')};ctx.persistStoreSession_();assert.equal(ctx.STORE_REMEMBER_UNTIL,0);assert.equal(session.getItem('bacio_store_refresh'),'rotated');
const clear=source.slice(source.indexOf('function clearStoreSession()'),source.indexOf('/*',source.indexOf('function clearStoreSession()')));ctx.stopStoreLiveSync_=()=>{};vm.runInContext(clear,ctx);ctx.clearStoreSession();assert.equal(session.getItem('bacio_store_refresh'),null);assert.equal(local.getItem(ctx.STORE_REMEMBER_KEY),null);
console.log('OK — persistência opt-in, reabertura, rotação, expiração, storage bloqueado, saída e corporativo.');

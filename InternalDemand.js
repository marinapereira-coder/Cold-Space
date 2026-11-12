/**
 * BR-061 — Demandas internas destinadas a um consultor ou departamento.
 * Somente o backend valida atribuição, lê histórico e grava respostas.
 * Nenhuma função desta API usa loja_ids como substituto de destinatários internos.
 */
function internalRoute_(d) {
  return normalizeJsonObject_(normalizeJsonObject_(d.cronograma).direcionamento);
}
function internalRoutingKey_(value) {
  return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function getInternalRouteRecipients_(route) {
  route=normalizeJsonObject_(route);
  var mode=String(route.modo||'');
  var target=internalRoutingKey_(route.valor);
  if(['consultor','departamento'].indexOf(mode)<0||!target)throw new Error('Selecione um destinatário interno válido.');
  var table=table_('TABLE_USUARIOS','bacio_usuarios');
  var users=supabaseRequest_('/rest/v1/'+table+'?select=*&ativo=eq.true&limit=5000','get')||[];
  var recipients=users.filter(function(u){
    if(u.ativo===false||!u.email)return false;
    if(mode==='consultor')return roleOf_(u)==='consultor'&&internalRoutingKey_(u.email)===target;
    return isDepartmentUser_(u)&&departmentOfUser_(u)===target;
  }).map(function(u){return String(u.email).trim().toLowerCase();});
  var unique=Array.from(new Set(recipients));
  if(!unique.length)throw new Error('O destinatário interno não possui login ativo no Bacio Conecta. Cadastre ou ative o usuário antes de publicar.');
  return unique;
}
function internalRoutingDirectory_(user){
  if(roleOf_(user)!=='admin'&&!isDepartmentUser_(user))return {consultores:[],departamentos:[]};
  var users=safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+
    '?select=id,nome,email,role,ativo&ativo=eq.true&limit=5000',[]);
  var consultants=[],departments={},labels={marketing:'Marketing',rh:'RH',qualidade:'Qualidade',treinamento:'Treinamento',
    comercial:'Comercial',growth:'Growth',ti:'TI'};
  users.forEach(function(u){
    if(u.ativo===false||!u.email)return;
    if(roleOf_(u)==='consultor')consultants.push({value:String(u.email).trim().toLowerCase(),
      label:String(u.nome||'Consultor')+' · '+String(u.email)});
    if(isDepartmentUser_(u)){
      var k=departmentOfUser_(u);
      if(k)departments[k]={value:k,label:labels[k]||k};
    }
  });
  consultants.sort(function(a,b){return a.label.localeCompare(b.label,'pt-BR');});
  return {consultores:consultants,departamentos:Object.keys(departments).sort().map(function(k){return departments[k];})};
}
function isInternalAssignee_(d,user,email) {
  if(!isDirectInternalDemand_(d)||String(d.status||'')!=='active'||d.ativa===false)return false;
  var route=internalRoute_(d),target=internalRoutingKey_(route.valor);
  if(!target)return false;
  if(route.modo==='consultor')return roleOf_(user)==='consultor'&&internalRoutingKey_(email||user.email)===target;
  if(route.modo==='departamento')return isDepartmentUser_(user)&&departmentOfUser_(user)===target;
  return false;
}
function mayReadInternalDemand_(d,auth) {
  if(roleOf_(auth.user)==='admin')return true;
  if(isInternalAssignee_(d,auth.user,auth.email))return true;
  return String(d.status)==='draft'&&isDepartmentUser_(auth.user)&&
    internalRoutingKey_(d.created_by)===internalRoutingKey_(auth.email)&&
    mayReadDepartmentDemand_(auth.user,d);
}
function internalReplyHistory_(demandId) {
  return supabaseRequest_('/rest/v1/bacio_demanda_entregas_internas?select=id,demanda_id,usuario_email,status,mensagem,created_at&demanda_id=eq.'+
    encodeURIComponent(String(demandId))+'&order=created_at.desc&limit=200','get')||[];
}
function internalReplyMap_(demands) {
  var ids=(demands||[]).filter(isDirectInternalDemand_).map(function(d){return String(d.id);}).filter(function(id){
    return /^[0-9a-f-]{36}$/i.test(id);
  });
  if(!ids.length)return {};
  var rows=safeSupabaseSelect_('/rest/v1/bacio_demanda_entregas_internas?select=demanda_id,usuario_email,status,mensagem,created_at&demanda_id=in.'+
    encodeURIComponent('('+ids.join(',')+')')+'&order=created_at.desc&limit=5000',[]);
  var byId={};
  rows.forEach(function(r){var id=String(r.demanda_id||'');if(!byId[id])byId[id]=r;});
  return byId;
}
function buildInternalDemandTasks_(demands,replies,auth) {
  return (demands||[]).filter(function(d){return isInternalAssignee_(d,auth.user,auth.email);}).map(function(d){
    var last=(replies||{})[String(d.id)],deadline=d.prazo_sla||'',late=deadline&&!isNaN(new Date(deadline).getTime())&&new Date(deadline).getTime()<Date.now();
    var answered=last&&last.status==='respondido',forward=last&&last.status==='encaminhamento_solicitado';
    return {id:String(d.id),title:d.titulo||'Demanda interna',description:d.descricao||'',
      deadline:deadline,deadlineLabel:formatDeadline_(deadline?new Date(deadline):null),
      status:answered?'success':late?'urgent':forward?'warning':'neutral',
      statusLabel:answered?'Resposta registrada':forward?'Encaminhamento solicitado':late?'Em atraso':'Aguardando sua resposta',
      timelineStatus:answered?'completed':late?'late':'active',
      type:'demanda',actionLabel:answered?'Ver resposta':'Responder',isDueToday:deadline?sameDay_(new Date(deadline),new Date()):false,
      internal:true,answeredCount:answered?1:0,totalStores:0};
  });
}
function getInternalDemandDetail_(d,auth) {
  if(!mayReadInternalDemand_(d,auth))throw new Error('Acesso não autorizado para esta demanda interna.');
  var history=internalReplyHistory_(d.id),last=history[0]||null,route=internalRoute_(d);
  return {id:String(d.id),title:d.titulo||'',description:d.descricao||'',type:d.tipo||'demanda',
    inicioEm:d.inicio_em||'',publicadaEm:d.publicada_em||'',deadline:d.prazo_sla||'',encerramentoEm:d.encerramento_em||'',
    publishStatus:String(d.status||'draft'),cronograma:normalizeJsonObject_(d.cronograma),
    timeline:timelineInfo_(d,last&&last.status==='respondido'?1:0,1,new Date()),
    responseRequired:d.resposta_obrigatoria!==false,modelSource:d.model_source||'manual',
    modelFields:normalizeObjectArray_(d.model_fields),lojaIds:[],totalStores:0,answeredCount:0,pendingCount:0,progress:0,
    stores:[],role:roleOf_(auth.user),internal:true,internalTarget:route.valor||'',
    internalMode:route.modo,canReply:isInternalAssignee_(d,auth.user,auth.email),
    internalHistory:history.map(function(row){return {
      id:String(row.id),email:row.usuario_email,status:row.status,message:row.mensagem,createdAt:row.created_at};})};
}
function notifyInternalDemand_(auth,d,kind) {
  var route=internalRoute_(d),recipients=kind==='assigned'?getInternalRouteRecipients_(route):[];
  if(kind==='reply'){
    var users=safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+'?select=email,role,ativo&ativo=eq.true&limit=5000',[]);
    recipients=users.filter(function(u){return roleOf_(u)==='admin'&&u.ativo!==false;}).map(function(u){return String(u.email).trim().toLowerCase();});
    var creator=String(d.created_by||'').trim().toLowerCase();
    if(creator && users.some(function(u){return u.ativo!==false&&String(u.email||'').trim().toLowerCase()===creator;}))
      recipients.push(creator);
  }
  recipients=Array.from(new Set(recipients)).filter(function(email){return email&&email!==String(auth.email||'').toLowerCase();});
  if(!recipients.length)return {sent:0,reason:'no_other_recipient'};
  var id=String(d.id||''),tag=/^[0-9a-f-]{36}$/i.test(id)?' [[bacio-demand:'+id+']]':'';
  var title=kind==='assigned'?'Nova demanda interna atribuída':'Nova resposta interna recebida';
  var payload=recipients.map(function(email){return {usuario_email:email,titulo:title,
    mensagem:title+': '+String(d.titulo||'')+tag,lida:false,created_at:new Date().toISOString()};});
  supabaseRequest_('/rest/v1/'+table_('TABLE_NOTIFICACOES','bacio_notificacoes'),'post',payload,'return=minimal');
  return {sent:payload.length};
}
function submitInternalDemandReply(input,authOverride) {
  input=input||{};
  var auth=authOverride||getCurrentAuthContext_(),id=String(input.demandId||'');
  if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Identificador de demanda inválido.');
  var rows=supabaseRequest_('/rest/v1/'+table_('TABLE_DEMANDAS','bacio_demandas')+
    '?select=*&id=eq.'+encodeURIComponent(id)+'&ativa=eq.true&limit=1','get')||[];
  var d=rows[0];
  if(!d||!isInternalAssignee_(d,auth.user,auth.email))throw new Error('Você não está autorizado a responder esta demanda interna.');
  if(d.tipo==='comunicado')throw new Error('Comunicados não aceitam respostas.');
  if(d.encerramento_em&&new Date(d.encerramento_em).getTime()<=Date.now())throw new Error('A demanda foi encerrada.');
  var status=String(input.status||'respondido');
  if(['respondido','encaminhamento_solicitado'].indexOf(status)<0)throw new Error('Situação de resposta inválida.');
  var message=String(input.message||'').trim();
  if(message.length<3||message.length>4000)throw new Error('Descreva a resposta (3 a 4.000 caracteres).');
  var payload={demanda_id:id,usuario_email:auth.email,status:status,mensagem:message,created_at:new Date().toISOString()};
  var saved=supabaseRequest_('/rest/v1/bacio_demanda_entregas_internas','post',payload,'return=representation')||[];
  var notificationError=null;
  try{notifyInternalDemand_(auth,d,'reply');}catch(e){notificationError=String(e);}
  return {ok:true,id:saved[0]&&saved[0].id||null,notificationError:notificationError};
}
function submitPasswordInternalDemandReply(token,input) {
  var auth=getStoreAuthContext_(token);
  if(roleOf_(auth.user)==='loja')throw new Error('Ação indisponível para lojas.');
  return submitInternalDemandReply(input,auth);
}

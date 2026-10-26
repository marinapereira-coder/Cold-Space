/**
 * BACIO CONECTA V2 — Resumo de pendências por e-mail
 * Complemento opt-in. NÃO envia automaticamente até EMAIL_COBRANCAS_ATIVAS=true
 * em Propriedades do Script e instalação explícita do gatilho.
 * Usa o mesmo critério de conclusão do robô de notificações existente.
 */
function bacioResumoPendenciasEmail_(dryRun) {
  var props = PropertiesService.getScriptProperties();
  if (!dryRun && props.getProperty('EMAIL_COBRANCAS_ATIVAS') !== 'true') {
    return {ok:false, motivo:'Envio desativado nas propriedades do script'};
  }
  var demandas = safeSupabaseSelect_('/rest/v1/'+table_('TABLE_DEMANDAS','bacio_demandas')+'?select=*&ativa=eq.true&limit=3000',[]);
  var respostas = safeSupabaseSelect_('/rest/v1/'+table_('TABLE_RESPOSTAS','bacio_demanda_respostas')+'?select=*&order=created_at.desc&limit=10000',[]);
  var lojas = safeSupabaseSelect_('/rest/v1/'+table_('TABLE_LOJAS','bacio_lojas')+'?select=*&ativa=eq.true&limit=5000',[]);
  var usuarios = safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+'?select=*&ativo=eq.true&limit=5000',[]);
  var now = new Date();
  var active = demandas.filter(function(d){
    var status=String(d.status||'active').toLowerCase();
    var start=validDateV2_(d.publicada_em);
    var end=validDateV2_(d.encerramento_em);
    return status!=='draft'&&status!=='closed'&&(!start||start<=now)&&(!end||end>=now);
  });
  var people = {};
  usuarios.forEach(function(u){if(u.id)people[String(u.id)]=u;});
  var latest = {};
  respostas.forEach(function(r){
    var key=String(r.demanda_id||'')+'|'+String(r.loja_id||'');
    if(!latest[key])latest[key]=r;
  });
  var recipients={};
  function add(email,store,task,role){
    email=String(email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;
    if(!recipients[email])recipients[email]={email:email,roles:{},items:{},count:0};
    var rec=recipients[email],key=String(task.id)+'|'+String(store.id);
    rec.roles[role]=true;
    if(!rec.items[key]){rec.items[key]={loja:store.nome||store.codigo||String(store.id),demanda:task.titulo||'Solicitação',prazo:task.prazo_sla||''};rec.count++;}
  }
  var unresolved=0;
  active.forEach(function(d){
    var targets=normalizeArray_(d.loja_ids).map(String);
    var all=targets.length===0;
    lojas.forEach(function(s){
      if(!all&&targets.indexOf(String(s.id))<0)return;
      if(responseCountsAsCompleteV2_(latest[String(d.id)+'|'+String(s.id)]))return;
      unresolved++;
      usuarios.forEach(function(u){
        if(String(u.role||'').toLowerCase()==='loja'&&String(u.loja_id||'')===String(s.id))add(u.email,s,d,'loja');
      });
      [ ['consultor_id','consultor'],['regional_id','regional'] ].forEach(function(pair){
        var id=s[pair[0]],role=pair[1];
        if(!id)return;
        var person=people[String(id)];
        if(person && String(person.role||'').toLowerCase()===role) add(person.email,s,d,role);
      });
    });
  });
  var report={ok:true,pendencias:unresolved,destinatarios:Object.keys(recipients).length,semEnvio:!!dryRun,porDestinatario:Object.keys(recipients).map(function(k){
    return {email:k,quantidade:recipients[k].count,perfis:Object.keys(recipients[k].roles)};
  })};
  if(dryRun)return report;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(5000))throw new Error('Envio já em execução.');
  try{
    var tz='America/Sao_Paulo',day=Utilities.formatDate(now,tz,'yyyy-MM-dd');
    var store=PropertiesService.getScriptProperties();
    var sent=0,skipped=0;
    Object.keys(recipients).forEach(function(email){
      var rec=recipients[email];
      var marker='BACIO_COBRANCA_'+Utilities.base64EncodeWebSafe(email).slice(0,100);
      if(store.getProperty(marker)===day){skipped++;return;}
      var names=Object.keys(rec.items).map(function(k){var x=rec.items[k];return '- '+x.loja+' — '+x.demanda+(x.prazo?' (prazo: '+x.prazo+')':'');});
      var portal=props.getProperty('BACIO_CONECTA_URL')||'';
      var text='Olá!\n\nExistem '+rec.count+' pendência(s) aguardando preenchimento ou regularização no Bacio Conecta:\n\n'+names.join('\n')+'\n\n'+(portal?'Acesse: '+portal+'\n\n':'')+'Este é um lembrete automático. Demandas já concluídas não precisam de nova resposta.\n';
      MailApp.sendEmail({to:email,subject:'Bacio Conecta | '+rec.count+' pendência(s) da sua responsabilidade',body:text,name:'Bacio Conecta'});
      store.setProperty(marker,day);
      sent++;
    });
    report.enviados=sent;report.ignoradosPorDuplicidade=skipped;
    return report;
  }finally{lock.releaseLock();}
}
/** Prévia sem envio, para homologação. */
function testarResumoPendenciasEmail(){requireAdmin_();return bacioResumoPendenciasEmail_(true);}
/** Envio manual exige flag EMAIL_COBRANCAS_ATIVAS=true. */
function enviarResumoPendenciasEmail(){requireAdmin_();return bacioResumoPendenciasEmail_(false);}
/** Agendamento diário explícito; não altera os gatilhos anteriores. */
function instalarGatilhoResumoPendenciasEmail(){
  requireAdmin_();
  var existing=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='executarResumoPendenciasEmailAgendado';});
  if(!existing.length)ScriptApp.newTrigger('executarResumoPendenciasEmailAgendado').timeBased().everyDays(1).atHour(10).create();
  return {ok:true,jaExistia:!!existing.length};
}
function executarResumoPendenciasEmailAgendado(){return bacioResumoPendenciasEmail_(false);}

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
    return status!=='draft'&&status!=='closed'&&d.resposta_obrigatoria!==false&&(!start||start<=now)&&(!end||end>=now);
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
    if(!rec.items[key]){
      var extras=normalizeJsonObject_(store.dados_extras);
      rec.items[key]={loja:(store.codigo?store.codigo+' · ':'')+(store.nome||String(store.id)),regional:extras.regional||'Não informada',demanda:task.titulo||'Solicitação',prazo:task.prazo_sla||''};
      rec.count++;
    }
  }
  var unresolved=0,totalTargets=0;
  active.forEach(function(d){
    var targets=normalizeArray_(d.loja_ids).map(String);
    var all=targets.length===0;
    lojas.forEach(function(s){
      if(!all&&targets.indexOf(String(s.id))<0)return;
      totalTargets++;
      if(responseCountsAsCompleteV2_(latest[String(d.id)+'|'+String(s.id)]))return;
      unresolved++;
      // E-mail oficial do cadastro da loja, além de usuários vinculados.
      add(s.email,s,d,'loja');
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
  var report={ok:true,pendencias:unresolved,totalEntregas:totalTargets,concluidas:Math.max(0,totalTargets-unresolved),destinatarios:Object.keys(recipients).length,semEnvio:!!dryRun,porDestinatario:Object.keys(recipients).map(function(k){
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
      MailApp.sendEmail({to:email,subject:'Bacio Conecta | '+rec.count+' pendência(s) da sua responsabilidade',body:text,htmlBody:bacioEmailRelatorioHtml_(rec,unresolved,totalTargets,portal),name:'Bacio Conecta'});
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

/**
 * Layout HTML do resumo: e-mail com contexto, barras, riscos e regionais.
 * Conteúdo HTML escapado e envio mantido sob flag e gatilho explícitos.
 */
function bacioEmailEscape_(v){
  return String(v==null?'':v).replace(/[&<>"']/g,function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}
function bacioEmailRelatorioHtml_(rec,unresolved,totalTargets,portal){
  var items=Object.keys(rec.items).map(function(k){return rec.items[k];});
  var regionals={},uniqueStores={};
  items.forEach(function(it){
    var r=it.regional||'Não informada';
    regionals[r]=(regionals[r]||0)+1;
    uniqueStores[it.loja]=true;
  });
  var unique=Object.keys(uniqueStores).length;
  var completed=Math.max(0,totalTargets-unresolved);
  var pct=totalTargets?Math.round(completed*100/totalTargets):100;
  var badge=rec.count>=10?'ATENÇÃO':'ACOMPANHAMENTO';
  var date=Utilities.formatDate(new Date(),'America/Sao_Paulo','dd/MM/yyyy HH:mm');
  var rowStyle='padding:10px 8px;border-bottom:1px solid #eadfd3;text-align:left;font:12px Arial,sans-serif;color:#523a2b;';
  var rows=items.slice(0,35).map(function(it){
    return '<tr><td style="'+rowStyle+'">'+bacioEmailEscape_(it.loja)+'</td>'+
      '<td style="'+rowStyle+'">'+bacioEmailEscape_(it.demanda)+'</td>'+
      '<td style="'+rowStyle+'">'+bacioEmailEscape_(it.prazo?String(it.prazo).slice(0,10).split('-').reverse().join('/'):'Sem prazo')+'</td></tr>';
  }).join('');
  if(items.length>35)rows+='<tr><td colspan="3" style="'+rowStyle+'">E mais '+(items.length-35)+' pendências. Consulte o portal para ver a lista completa.</td></tr>';
  var regionalRows=Object.keys(regionals).sort().map(function(name){
    return '<tr><td style="'+rowStyle+'">'+bacioEmailEscape_(name)+'</td><td style="'+rowStyle+'text-align:right;" colspan="2"><strong>'+regionals[name]+'</strong> pendência(s)</td></tr>';
  }).join('');
  var action=portal?'<a href="'+bacioEmailEscape_(portal)+'" style="display:inline-block;background:#65412b;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font:700 13px Arial,sans-serif;">Acessar Bacio Conecta</a>':'<p style="color:#765d4b;">Acesse o portal Bacio Conecta para concluir as pendências.</p>';
  return '<!DOCTYPE html><html lang="pt-BR"><body style="margin:0;background:#faf3e6;font-family:Arial,Helvetica,sans-serif;color:#523b2c;">'+
    '<div style="max-width:650px;margin:0 auto;background:#fffdf9;border:1px solid #eee3d7;">'+
    '<div style="background:#65412b;padding:22px 26px;color:#fff;"><div style="font-size:21px;letter-spacing:1px;">BACIO <span style="font-style:italic;">di LATTE</span></div><div style="margin-top:6px;font-size:11px;letter-spacing:2px;">BACIO CONECTA · ACOMPANHAMENTO OPERACIONAL</div></div>'+
    '<div style="padding:26px;"><p style="font-size:12px;color:#866f5f;">Atualizado em '+date+'</p>'+
    '<h2 style="font-size:22px;font-weight:normal;margin:8px 0;">Pendências de preenchimento</h2>'+
    '<p style="display:inline-block;color:#9f2525;background:#fff0e9;border-radius:9px;padding:9px 12px;font-size:12px;font-weight:bold;">'+badge+' · '+rec.count+' pendência(s)</p>'+
    '<p style="font-size:13px;line-height:1.6;">Identificamos registros que ainda precisam de retorno. Abaixo estão as pendências vinculadas à sua responsabilidade.</p>'+
    '<table role="presentation" style="width:100%;border-spacing:8px;margin:12px 0;"><tr>'+
    '<td style="background:#faf1e7;border-radius:9px;text-align:center;padding:14px;"><strong style="font-size:25px;color:#65412b;">'+unique+'</strong><br><span style="font-size:11px;">Lojas pendentes</span></td>'+
    '<td style="background:#faf1e7;border-radius:9px;text-align:center;padding:14px;"><strong style="font-size:25px;color:#65412b;">'+rec.count+'</strong><br><span style="font-size:11px;">Retornos pendentes</span></td></tr></table>'+
    '<p style="font-size:12px;color:#70533f;"><strong>Panorama geral das entregas ativas:</strong> '+completed+' de '+totalTargets+' concluídas ('+pct+'%)</p>'+
    '<div style="height:9px;background:#eae5df;border-radius:8px;overflow:hidden;"><div style="background:#41844a;width:'+pct+'%;height:9px;"></div></div>'+
    '<h3 style="font-size:15px;color:#765036;margin-top:27px;">Pendências por regional</h3>'+
    '<table style="border-collapse:collapse;width:100%;">'+regionalRows+'</table>'+
    '<h3 style="font-size:15px;color:#765036;margin-top:27px;">Lojas e demandas aguardando retorno</h3>'+
    '<table style="border-collapse:collapse;width:100%;"><thead><tr><th style="'+rowStyle+'">Loja</th><th style="'+rowStyle+'">Demanda</th><th style="'+rowStyle+'">Prazo</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div style="padding:25px 0;text-align:center;">'+action+'</div>'+
    '<p style="font-size:12px;color:#8f7968;line-height:1.5;">Esta comunicação é automática. Quando a resposta válida for registrada, a pendência deixa de ser cobrada nos próximos envios.</p>'+
    '</div><div style="padding:13px 26px;text-align:center;background:#f4e8d8;color:#806955;font-size:10px;">Equipe de Gestão de Performance — Bacio di Latte</div></div></body></html>';
}

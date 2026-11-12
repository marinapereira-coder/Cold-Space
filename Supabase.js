/**
 * BACIO CONECTA — Supabase v5 · Cronograma em colunas + lembretes em JSON
 * Camada server-side do Google Apps Script.
 *
 * SEGURANÇA:
 * - Nunca coloque SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY no HTML.
 * - Guarde os segredos em Configurações do projeto > Propriedades do script.
 * - As funções de escrita validam o perfil novamente no servidor.
 * - A exclusão é lógica (ativa=false), preservando histórico.
 */

function prop_(name, fallback) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value !== null && value !== '' ? value : fallback;
}

function table_(propertyName, fallback) {
  return prop_(propertyName, fallback);
}

function supabaseRequest_(path, method, payload, prefer) {
  var baseUrl = prop_('SUPABASE_URL', '').replace(/\/$/, '');
  var secretKey =
    prop_('SUPABASE_SECRET_KEY', '') ||
    prop_('SUPABASE_SERVICE_ROLE_KEY', '');

  if (!baseUrl || !secretKey) {
    throw new Error('Supabase não configurado nas Propriedades do script.');
  }

  var headers = {
    apikey: secretKey,
    Authorization: 'Bearer ' + secretKey,
    'Content-Type': 'application/json'
  };

  if (prefer) headers.Prefer = prefer;

  var options = {
    method: method || 'get',
    headers: headers,
    muteHttpExceptions: true
  };

  if (payload !== undefined && payload !== null) {
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(baseUrl + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Supabase (' + code + '): ' + text);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}

function safeSupabaseSelect_(path, fallback) {
  try {
    return supabaseRequest_(path, 'get') || fallback;
  } catch (err) {
    console.error(err);
    return fallback;
  }
}

function getCurrentAuthContext_() {
  var email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error(
      'Não foi possível identificar seu e-mail corporativo. ' +
      'Na implantação final, use “Usuário acessando o app” e restrinja o acesso à organização.'
    );
  }

  validateAllowedDomain_(email);

  var usuariosTable = table_('TABLE_USUARIOS', 'bacio_usuarios');
  var rows = supabaseRequest_(
    '/rest/v1/' + usuariosTable + '?select=*&email=eq.' + encodeURIComponent(email) + '&limit=1',
    'get'
  );

  if (!rows || !rows.length) {
    throw new Error('Seu e-mail ainda não está cadastrado no Bacio Conecta: ' + email);
  }

  var user = rows[0];
  if (user.ativo === false) {
    throw new Error('Seu acesso ao Bacio Conecta está desativado.');
  }

  return { email: email, user: user };
}

function roleOf_(user) {
  return String(user.role || user.perfil || '').trim().toLowerCase();
}

// Department access is based on the stored request owner, never on a browser filter.
// Existing admin/regional/consultor/store roles keep their original scope rules.
function departmentOfUser_(user) {
  var value=String(user.departamento||user.department||'').trim();
  var role=roleOf_(user);
  if(!value && ['marketing','rh','qualidade','treinamento','comercial','growth','ti'].indexOf(role)>=0)value=role;
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function departmentOfDemand_(demand) {
  var schedule=normalizeJsonObject_(demand.cronograma);
  return String(schedule.departamentoSolicitante||'Operações').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function isDepartmentUser_(user) {
  var role=roleOf_(user);
  return ['marketing','rh','qualidade','treinamento','comercial','growth','ti','departamento'].indexOf(role)>=0 && !!departmentOfUser_(user);
}
function mayReadDepartmentDemand_(user,demand) {
  return roleOf_(user)==='admin'||(isDepartmentUser_(user)&&departmentOfUser_(user)===departmentOfDemand_(demand));
}

/* Corporate departments authenticate through the existing Google corporate login.
   Store/password authentication is intentionally unchanged. */
function getDepartmentAccessWorkspace(){
  requireAdmin_();
  var users=safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+'?select=*&limit=5000',[]);
  return {items:users.filter(function(u){return isDepartmentUser_(u);}).map(function(u){
    return {id:String(u.id),nome:u.nome||'',email:u.email||'',departamento:departmentOfUser_(u),ativo:u.ativo!==false};
  })};
}
function saveDepartmentAccess(input){
  requireAdmin_();
  input=input||{};
  var email=String(input.email||'').trim().toLowerCase();
  var name=String(input.nome||'').trim();
  var dept=String(input.departamento||'').trim().toLowerCase();
  var allowed=['marketing','rh','qualidade','treinamento','comercial','growth','ti'];
  if(allowed.indexOf(dept)<0)throw new Error('Selecione um departamento permitido.');
  if(!email||!name||email.indexOf('@')<1)throw new Error('Informe nome e e-mail corporativo.');
  validateAllowedDomain_(email);
  var table=table_('TABLE_USUARIOS','bacio_usuarios');
  var existing=safeSupabaseSelect_('/rest/v1/'+table+'?select=*&email=eq.'+encodeURIComponent(email)+'&limit=1',[]);
  if(existing.length && !isDepartmentUser_(existing[0]))throw new Error('Este e-mail já pertence a outro perfil. Nenhum acesso foi alterado.');
  var payload={nome:name,email:email,role:dept,ativo:true,updated_at:new Date().toISOString()};
  var result=supabaseRequest_('/rest/v1/'+table+'?on_conflict=email','post',payload,'resolution=merge-duplicates,return=representation');
  return {ok:true,user:result&&result[0]||payload};
}

function requireAdmin_() {
  var auth = getCurrentAuthContext_();
  if (roleOf_(auth.user) !== 'admin') {
    throw new Error('Somente administradores podem realizar esta ação.');
  }
  return auth;
}

function operationDirectoryKey_(value) {
 return String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

// Operations are linked by the actual names in the store master until the
// import supplies separate regional/consultant IDs. Never match an empty key.
function operationScopeMatchesStore_(loja, role, scopeId) {
 var target=operationDirectoryKey_(scopeId);
 if(!target)return false;
 var extras=parseJsonObject_(loja.dados_extras);
 var rawId=String(role==='consultor'?loja.consultor_id||'':loja.regional_id||'');
 var rawName=String(role==='consultor'?extras.consultor||'':extras.regional||'');
 return operationDirectoryKey_(rawId)===target||operationDirectoryKey_(rawName)===target;
}

// Unidade fictícia reservada para homologação: nunca faz parte de envios gerais.
function isConectaTestStoreId_(id) {
  return String(id || '') === 'TESTE_CONECTA';
}

function isConectaTestDemand_(demand) {
  var ids = normalizeArray_(demand.loja_ids || demand.lojas_ids || demand.target_loja_ids || demand.lojas);
  return ids.length === 1 && isConectaTestStoreId_(ids[0]);
}

function getVisibleStores_(user) {
  var role = roleOf_(user);
  var lojasTable = table_('TABLE_LOJAS', 'bacio_lojas');
  var lojas = supabaseRequest_(
    '/rest/v1/' + lojasTable + '?select=*&order=nome.asc',
    'get'
  ) || [];

  return lojas.filter(function (loja) {
    if (loja.ativa === false) return false;
    if (role === 'admin') return true;
    if (role === 'regional') {
      return operationScopeMatchesStore_(loja,'regional',user.regional_id);
    }
    if (role === 'consultor') {
      return operationScopeMatchesStore_(loja,'consultor',user.consultor_id || user.id);
    }
    if (role === 'loja') {
      return String(loja.id || '') === String(user.loja_id || user.lojaId || '');
    }
    return false;
  });
}

function getRealBootstrap_(email,authOverride) {
  var auth = authOverride || getCurrentAuthContext_();
  var user = auth.user;
  var role = roleOf_(user);

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');
  var notificacoesTable = table_('TABLE_NOTIFICACOES', 'bacio_notificacoes');

  var lojas = getVisibleStores_(user);
  // Department authors need the active store directory to select recipients;
  // responses remain restricted by department demand ID below.
  if(isDepartmentUser_(user)){
    lojas=supabaseRequest_('/rest/v1/'+table_('TABLE_LOJAS','bacio_lojas')+'?select=*&limit=5000','get').filter(function(store){return store.ativa!==false;});
  }
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });

  var demandas = safeSupabaseSelect_(
    '/rest/v1/' + demandasTable + '?select=*&ativa=eq.true&order=created_at.desc',
    []
  ).filter(function (d) {
    if (isDirectInternalDemand_(d)) return mayReadInternalDemand_(d,auth);
    if (isDepartmentUser_(user)) return mayReadDepartmentDemand_(user,d);
    if (!demandaVisivelNoEscopo_(d, visibleLojaIds)) return false;
    if (role !== 'admin' && String(d.status || 'active').toLowerCase() === 'draft') return false;
    return true;
  });

  if (isDepartmentUser_(user)) {
    var allStores=supabaseRequest_('/rest/v1/'+table_('TABLE_LOJAS','bacio_lojas')+'?select=*&ativa=eq.true&limit=5000','get')||[];
    var allowed={};
    demandas.forEach(function(d){
      var ids=getTargetStoreIds_(d,allStores.map(function(l){return String(l.id);}));
      ids.forEach(function(id){allowed[String(id)]=true;});
    });
    lojas=allStores.filter(function(l){return allowed[String(l.id)];});
    visibleLojaIds=lojas.map(function(l){return String(l.id);});
  }

  var respostas = safeSupabaseSelect_(
    '/rest/v1/' + respostasTable + '?select=*&order=created_at.desc&limit=5000',
    []
  ).filter(function (r) {
    return visibleLojaIds.indexOf(String(r.loja_id || r.lojaId || '')) >= 0 && (!isDepartmentUser_(user)||demandas.some(function(d){return String(d.id)===String(r.demanda_id||r.demandaId||'');}));
  });

  var notifications = safeSupabaseSelect_(
    '/rest/v1/' + notificacoesTable +
      '?select=*&usuario_email=eq.' + encodeURIComponent(email) +
      '&order=created_at.desc&limit=30',
    []
  );

  var published = demandas.filter(function (d) {
    return String(d.status || 'active').toLowerCase() !== 'draft';
  });
  // Entregas internas não entram no contador de lojas nem nas campanhas.
  var storePublished=published.filter(function(d){return !isDirectInternalDemand_(d);});
  var internalReplies=internalReplyMap_(demandas);
  var tasks = buildTasks_(storePublished, respostas, lojas, role, user).concat(
    buildInternalDemandTasks_(published,internalReplies,auth));
  var campaigns = buildCampaigns_(storePublished, tasks);
  var announcements = role==='loja' ? attachStoreComunicadosLeiturasV2_(buildStoreCorrectionNotices_(published,respostas,lojas).concat(buildAnnouncements_(published)),String(user.loja_id||user.lojaId||'')) : buildAnnouncements_(published);
  // Defence in depth: filter the final payload as well as source rows.
  // This prevents cross-department records leaking through any future mapper.
  var managementItems = buildManagementItems_(demandas, respostas, lojas, role, internalReplies);
  if (isDepartmentUser_(user)) {
    var allowedDemandIds = {};
    demandas.forEach(function(d){
      if(isDirectInternalDemand_(d) ? mayReadInternalDemand_(d,auth) : mayReadDepartmentDemand_(user,d))
        allowedDemandIds[String(d.id)] = true;
    });
    managementItems = managementItems.filter(function(item){return allowedDemandIds[String(item.id)] === true;});
    tasks = tasks.filter(function(item){return allowedDemandIds[String(item.demandaId || item.demanda_id || item.id)] === true;});
    campaigns = campaigns.filter(function(item){return allowedDemandIds[String(item.demandaId || item.demanda_id || item.id)] === true;});
    announcements = announcements.filter(function(item){return allowedDemandIds[String(item.demandaId || item.demanda_id || item.id)] === true;});
  }

  // Demandas fictícias visíveis à gestão, excluídas de seus KPIs.
  var testDemandIds={};
  demandas.forEach(function(d){if(isConectaTestDemand_(d))testDemandIds[String(d.id)]=true;});
  var metricTasks=role==='loja'?tasks:tasks.filter(function(t){return !testDemandIds[String(t.id)];});
  var metricCampaigns=role==='loja'?campaigns:campaigns.filter(function(c){return !testDemandIds[String(c.id)];});

  var currentLoja = null;
  if (role === 'loja') {
    currentLoja = lojas.find(function (l) {
      return String(l.id) === String(user.loja_id || user.lojaId || '');
    }) || lojas[0] || null;
  }

  var city = currentLoja ? (currentLoja.cidade || currentLoja.nome || '') : 'São Paulo';

  return {
    mode: 'live',
    generatedAt: new Date().toISOString(),
    user: {
      id: user.id,
      nome: user.nome || niceNameFromEmail_(email),
      email: email,
      role: role,
      departamento: user.departamento || user.department || (isDepartmentUser_(user)?role:''),
      forcePasswordChange: user.force_password_change === true,
      lojaId: user.loja_id || user.lojaId || null,
      regionalId: user.regional_id || user.regionalId || null,
      contexto: getContextLabel_(role, user, currentLoja, lojas)
    },
    stores: lojas.map(function (l) {
      var extras = parseJsonObject_(l.dados_extras);
      return {
        id: String(l.id),
        codigo: l.codigo || '',
        nome: l.nome || '',
        email: l.email || '',
        cidade: l.cidade || '',
        regionalId: l.regional_id || null,
        consultorId: l.consultor_id || null,
        regional: extras.regional || '',
        consultor: extras.consultor || '',
        estado: extras.estado || '',
        formato: extras.formato || '',
        delivery: extras.delivery || '',
        endereco: extras.endereco || ''
      };
    }),
    weather: { city: city, temp: '', condition: '' },
    summary: {
      pending: metricTasks.filter(function (t) { return t.status !== 'success'; }).length,
      dueToday: metricTasks.filter(function (t) { return t.isDueToday && t.status !== 'success'; }).length,
      campaigns: metricCampaigns.length,
      unread: notifications.filter(function (n) { return !(n.lida || n.read); }).length
    },
    tasks: tasks,
    campaigns: campaigns,
    managementItems: managementItems,
    announcements: announcements,
    routingRecipients: internalRoutingDirectory_(user),
    notifications: mapConectaNotificationsByType_(notifications,demandas)
  };
}

function normalizeArray_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    var trimmed = value.trim();
    if (!trimmed) return [];
    try {
      var parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {}
    return trimmed.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  }
  return [];
}

function normalizeObjectArray_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}


function normalizeJsonObject_(value) {
  if (!value) return {};
  if (Object.prototype.toString.call(value) === '[object Object]') return value;
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value);
      return Object.prototype.toString.call(parsed) === '[object Object]' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

function timelineInfo_(demanda, answered, totalStores, now) {
  now = now || new Date();
  var cronograma = normalizeJsonObject_(demanda.cronograma);
  var savedStatus = String(demanda.status || 'active').toLowerCase();

  function parsedDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  // Datas principais ficam em colunas próprias no Supabase.
  // Mantemos fallback para o JSON antigo para não quebrar registros criados antes desta versão.
  var publishedAt = parsedDate(
    demanda.publicada_em || demanda.publicadaEm || cronograma.publicada_em || cronograma.publicadaEm
  );
  var startAt = parsedDate(
    demanda.inicio_em || demanda.inicioEm || cronograma.inicio_em || cronograma.inicioEm
  );
  var deadline = parsedDate(demanda.prazo_sla || demanda.prazoSla || demanda.prazo);
  var endAt = parsedDate(
    demanda.encerramento_em || demanda.encerramentoEm || cronograma.encerramento_em || cronograma.encerramentoEm
  );
  var complete = totalStores > 0 && answered >= totalStores;

  var code = 'active';
  var label = 'Em andamento';

  if (savedStatus === 'draft') {
    code = 'draft';
    label = 'Rascunho';
  } else if (savedStatus === 'closed' || (endAt && endAt.getTime() <= now.getTime())) {
    code = 'closed';
    label = 'Encerrada';
  } else if (startAt && startAt.getTime() > now.getTime()) {
    code = 'scheduled';
    label = 'Agendada';
  } else if (complete) {
    code = 'completed';
    label = 'Concluída';
  } else if (deadline && deadline.getTime() < now.getTime()) {
    code = 'late';
    label = 'Em atraso';
  } else if (deadline && sameDay_(deadline, now)) {
    code = 'due_today';
    label = 'Vence hoje';
  }

  return {
    code: code,
    label: label,
    publishedAt: publishedAt ? publishedAt.toISOString() : '',
    startAt: startAt ? startAt.toISOString() : '',
    deadline: deadline ? deadline.toISOString() : '',
    endAt: endAt ? endAt.toISOString() : '',
    reminders: Array.isArray(cronograma.lembretes) ? cronograma.lembretes : []
  };
}

function isDirectInternalDemand_(demanda) {
  var direction=normalizeJsonObject_(normalizeJsonObject_(demanda.cronograma).direcionamento);
  return direction.modo==='consultor'||direction.modo==='departamento';
}

function demandaVisivelNoEscopo_(demanda, visibleLojaIds) {
  if (isDirectInternalDemand_(demanda)) return false;
  var targetIds = normalizeArray_(
    demanda.loja_ids || demanda.lojas_ids || demanda.target_loja_ids || demanda.lojas
  );
  // Uma publicação geral não dá acesso à unidade fictícia de testes.
  if (!targetIds.length) return visibleLojaIds.some(function(id){ return !isConectaTestStoreId_(id); });
  return targetIds.some(function (id) {
    return visibleLojaIds.indexOf(String(id)) >= 0;
  });
}

function getTargetStoreIds_(demanda, visibleLojaIds) {
  if (isDirectInternalDemand_(demanda)) return [];
  var targetIds = normalizeArray_(
    demanda.loja_ids || demanda.lojas_ids || demanda.target_loja_ids || demanda.lojas
  );
  if (!targetIds.length) return visibleLojaIds.filter(function(id){ return !isConectaTestStoreId_(id); });
  return targetIds.filter(function (id) {
    return visibleLojaIds.indexOf(String(id)) >= 0;
  });
}

function latestResponsesByStore_(demandaId, respostas) {
  var map = {};
  respostas.forEach(function (r) {
    if (String(r.demanda_id || r.demandaId || '') !== String(demandaId)) return;
    var lojaId = String(r.loja_id || r.lojaId || '');
    if (!lojaId || map[lojaId]) return;
    map[lojaId] = r;
  });
  return map;
}

// Status do fluxo da última resposta da loja, diferente da conclusão da demanda.
// Conferir sempre a resposta mais recente: após corrigir, volta a aguardar análise.
function storeDemandReviewStatus_(response) {
  if(!response)return '';
  var status=String(response.status||'respondido').toLowerCase();
  if(status==='ajuste_necessario'||status==='reprovada')return status;
  if(status==='respondido')return 'aguardando_analise';
  return '';
}
function storeDemandReviewLabel_(status) {
  return ({ajuste_necessario:'Ajuste necessário',reprovada:'Reprovada',aguardando_analise:'Aguardando análise'})[status]||'';
}

function buildTasks_(demandas, respostas, lojas, role, user) {
  var now = new Date();
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });

  var tasks = demandas.filter(function(d){return String(d.tipo||d.type||'').toLowerCase()!=='comunicado';}).map(function (d) {
    var id = String(d.id);
    var targetIds = getTargetStoreIds_(d, visibleLojaIds);
    var latest = latestResponsesByStore_(id, respostas);
    var answered = 0;

    targetIds.forEach(function (lojaId) {
      if (latest[lojaId]) answered++;
    });

    var deadlineRaw = d.prazo_sla || d.prazoSla || d.prazo || null;
    var deadline = deadlineRaw ? new Date(deadlineRaw) : null;
    var isValidDeadline = deadline && !isNaN(deadline.getTime());
    var isLate = isValidDeadline && deadline.getTime() < now.getTime() && answered < targetIds.length;
    var isDueToday = isValidDeadline && sameDay_(deadline, now);
    var complete = targetIds.length > 0 && answered >= targetIds.length;

    var timeline = timelineInfo_(d, answered, targetIds.length, now);
    var status = complete ? 'success' : isLate ? 'urgent' : isDueToday ? 'warning' : 'neutral';
    var label;

    if (role === 'loja') {
      label = complete ? 'Respondido' : isLate ? 'Em atraso' : isDueToday ? 'Vence hoje' : 'Pendente';
    } else {
      var pending = Math.max(targetIds.length - answered, 0);
      label = complete
        ? '100% respondido'
        : pending + ' ' + (pending === 1 ? 'loja pendente' : 'lojas pendentes');
    }

    var reviewStatus=(role==='loja' && targetIds.length===1 && timeline.code!=='closed')
      ? storeDemandReviewStatus_(latest[targetIds[0]]) : '';
    if(reviewStatus){
      timeline.code=reviewStatus;
      timeline.label=storeDemandReviewLabel_(reviewStatus);
      if(reviewStatus==='ajuste_necessario'||reviewStatus==='reprovada'){
        status='warning';
        label=timeline.label;
      }else{
        status='success';
        label=timeline.label;
      }
    }

    return {
      id: id,
      title: d.titulo || d.title || 'Demanda',
      description: d.descricao || d.description || '',
      deadline: isValidDeadline ? deadline.toISOString() : '',
      deadlineLabel: formatDeadline_(deadline),
      status: status,
      statusLabel: label,
      actionLabel: role === 'loja' ? (reviewStatus==='ajuste_necessario'||reviewStatus==='reprovada'?'Revisar resposta':complete?'Ver resposta':'Responder') : 'Acompanhar',
      type: String(d.tipo || d.type || 'demanda'),
      isDueToday: Boolean(isDueToday),
      answeredCount: answered,
      totalStores: targetIds.length,
      timelineStatus: timeline.code,
      timelineLabel: timeline.label,
      timeline: timeline,
      cronograma: normalizeJsonObject_(d.cronograma),
      departamento: normalizeJsonObject_(d.cronograma).departamentoSolicitante || 'Operações',
      tipoSolicitacao: normalizeJsonObject_(d.cronograma).tipoSolicitacao || ''
    };
  });

  var score = { urgent: 4, warning: 3, neutral: 2, success: 1 };
  tasks.sort(function (a, b) {
    return (score[b.status] || 0) - (score[a.status] || 0);
  });

  return tasks;
}

function buildManagementItems_(demandas, respostas, lojas, role, internalReplies) {
  internalReplies=internalReplies||{};
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });
  return demandas.filter(function(d){return String(d.tipo||d.type||'').toLowerCase()!=='comunicado';}).map(function (d) {
    var id = String(d.id);
    var targetIds = getTargetStoreIds_(d, visibleLojaIds);
    var latest = latestResponsesByStore_(id, respostas);
    var answered = targetIds.filter(function (lojaId) { return Boolean(latest[lojaId]); }).length;
    // Resposta válida: usa a mesma regra das cobranças e notificações existentes.
    var completed = targetIds.filter(function (lojaId) { return responseCountsAsCompleteV2_(latest[lojaId]); }).length;
    var progress = targetIds.length ? Math.round((answered / targetIds.length) * 100) : 0;
    var savedStatus = String(d.status || 'active').toLowerCase();
    var internal=typeof isDirectInternalDemand_==='function'&&isDirectInternalDemand_(d),internalLast=internalReplies[id]||null;
    var timeline = timelineInfo_(d, answered, targetIds.length, new Date());
    var status = savedStatus === 'draft' ? 'draft' : progress >= 100 && targetIds.length ? 'success' : 'active';
    if(internal&&savedStatus==='active'){
      status=internalLast?(internalLast.status==='respondido'?'completed':'needs_revision'):
        (d.prazo_sla&&new Date(d.prazo_sla).getTime()<Date.now()?'late':'active');
      timeline.code=status;
      timeline.label=internalLast?(internalLast.status==='respondido'?'Resposta registrada':'Encaminhamento solicitado'):
        (status==='late'?'Em atraso':'Aguardando resposta interna');
    }
    // O progresso de respostas (1/1) não significa avaliação concluída.
    // Somente no perfil da própria loja exibimos o resultado de sua última entrega.
    var reviewStatus=(role==='loja' && savedStatus!=='draft' && timeline.code!=='closed' && targetIds.length===1)
      ? storeDemandReviewStatus_(latest[targetIds[0]]) : '';
    if(reviewStatus){
      status=reviewStatus;
      timeline.code=reviewStatus;
      timeline.label=storeDemandReviewLabel_(reviewStatus);
    }

    return {
      id: id,
      isHomologacao: isConectaTestDemand_(d),
      internal: internal,
      internalResponseStatus: internalLast?internalLast.status:'',
      title: d.titulo || d.title || 'Demanda',
      description: d.descricao || d.description || '',
      type: String(d.tipo || d.type || 'demanda').toLowerCase(),
      deadline: d.prazo_sla || '',
      deadlineLabel: formatDeadline_(d.prazo_sla ? new Date(d.prazo_sla) : null),
      progress: progress,
      answeredCount: answered,
      completedCount: completed,
      totalStores: targetIds.length,
      targetStoreIds: targetIds,
      progressLabel: internal ? (savedStatus==='draft'?'Atribuição interna em rascunho':
        internalLast?(internalLast.status==='respondido'?'Resposta interna registrada':'Encaminhamento solicitado'):
        'Aguardando resposta do destinatário')
        : targetIds.length
        ? answered + ' de ' + targetIds.length + ' lojas responderam'
        : 'Sem lojas vinculadas',
      status: status,
      publishStatus: savedStatus,
      owner: d.created_by || 'Operações',
      timelineStatus: savedStatus==='draft' && ['pendente','ajustes','reprovada'].indexOf(normalizeJsonObject_(d.cronograma).aprovacaoStatus)>=0?({'pendente':'pending_approval','ajustes':'needs_revision','reprovada':'rejected'})[normalizeJsonObject_(d.cronograma).aprovacaoStatus]:timeline.code,
      timelineLabel: savedStatus==='draft' && ['pendente','ajustes','reprovada'].indexOf(normalizeJsonObject_(d.cronograma).aprovacaoStatus)>=0?({'pendente':'Aguardando aprovação','ajustes':'Ajustes solicitados','reprovada':'Reprovada'})[normalizeJsonObject_(d.cronograma).aprovacaoStatus]:timeline.label,
      timeline: timeline,
      cronograma: normalizeJsonObject_(d.cronograma)
    };
  });
}

function buildCampaigns_(demandas, tasks) {
  var taskMap = {};
  tasks.forEach(function (t) { taskMap[t.id] = t; });

  return demandas
    .filter(function (d) {
      var tipo = String(d.tipo || d.type || '').toLowerCase();
      if(tipo==='comunicado')return false;
      var titulo = String(d.titulo || d.title || '').toLowerCase();
      return tipo.indexOf('campanha') >= 0 || titulo.indexOf('campanha') >= 0 || Boolean(d.insumos_campanha || d.insumosCampanha);
    })
    .map(function (d) {
      var task = taskMap[String(d.id)] || {};
      var total = Number(task.totalStores || 0);
      var answered = Number(task.answeredCount || 0);
      var progress = total ? Math.round((answered / total) * 100) : 0;
      return {
        id: String(d.id),
        title: d.titulo || d.title || 'Campanha',
        description: d.descricao || d.description || '',
        deadlineLabel: task.deadlineLabel || '',
        progress: progress,
        progressLabel: total ? answered + ' de ' + total + ' lojas responderam' : 'Aguardando respostas',
        imageUrl: d.imagem_url || d.image_url || d.imageUrl || ''
      };
    });
}

function buildAnnouncements_(demandas) {
  return demandas
    .filter(function (d) {
      return String(d.tipo || d.type || '').toLowerCase() === 'comunicado';
    })
    .map(function (d) {
      var text = ((d.titulo || '') + ' ' + (d.descricao || '')).toLowerCase();
      var kind = 'info';
      var label = 'Informativo';
      if (text.indexOf('urgente') >= 0 || text.indexOf('atenção') >= 0) {
        kind = 'important';
        label = 'Importante';
      } else if (text.indexOf('preencher') >= 0 || text.indexOf('enviar') >= 0 || text.indexOf('atualizar') >= 0) {
        kind = 'action';
        label = 'Exige ação';
      }
      return {
        id: String(d.id),
        isComunicado:true,
        title: d.titulo || d.title || 'Comunicado',
        excerpt: d.descricao || d.description || '',
        kind: kind,
        kindLabel: label,
        dateLabel: formatShortDate_(d.created_at || d.createdAt)
      };
    });
}


function mapBacioNotification_(n) {
 var message=String(n.mensagem||n.message||'');
 var demandTag=message.match(/\[\[bacio-demand:([a-z0-9-]{1,80})\]\]/i);
 var responseTag=message.match(/\[\[bacio-response:([a-z0-9-]{1,80})\]\]/i);
 var title=String(n.titulo||n.title||'Notificação');
 return {
  id:n.id,title:title,
  message:message.replace(/\s*\[\[bacio-(?:demand|response):[a-z0-9-]{1,80}\]\]/ig,'').trim(),
  demandId:demandTag?demandTag[1]:(n.demanda_id||n.demandId||null),
  responseId:responseTag?responseTag[1]:(n.resposta_id||n.responseId||null),
  requiresCorrection:!!demandTag&&/^(ajuste solicitado|entrega reprovada)$/i.test(title.trim()),
  read:Boolean(n.lida||n.read),createdAt:n.created_at||n.createdAt||''
 };
}
// Corrige somente a apresentação de avisos históricos vinculados a comunicados.
// Não altera registros no banco nem reenvia notificações.
function mapConectaNotificationsByType_(rows,demandas){
 var comunicadoIds={};
 (demandas||[]).forEach(function(d){
  if(String(d.tipo||d.type||'').toLowerCase()==='comunicado')comunicadoIds[String(d.id)]=true;
 });
 return (rows||[]).map(function(row){
  var item=mapBacioNotification_(row),id=String(item.demandId||'');
  var generic=/^(nova solicita[çc][aã]o publicada|nova demanda publicada|nova comunica[çc][aã]o|novo comunicado(?: publicado)?)$/i;
  if(comunicadoIds[id]&&generic.test(String(item.title||'').trim())){
    item.title='Novo comunicado publicado';
    item.isComunicado=true;
  }
  return item;
 });
}
function getResponseCorrectionFeedback_(demandId,storeId,responseId){
 if(!demandId||!storeId||!responseId)return '';
 var rows=safeSupabaseSelect_('/rest/v1/bacio_avaliacoes?select=resposta_id,status,comentario'+
  '&demanda_id=eq.'+encodeURIComponent(String(demandId))+
  '&loja_id=eq.'+encodeURIComponent(String(storeId))+'&limit=10',[]);
 var evaluation=rows.find(function(row){
  return String(row.resposta_id||'')===String(responseId)&&
   ['ajuste_necessario','reprovada'].indexOf(String(row.status||''))>=0;
 });
 return evaluation?String(evaluation.comentario||''):'';
}
// Comunicados de correção são derivados de avaliações oficiais da própria loja.
// Não criam conteúdo global e desaparecem após novo envio.
function buildStoreCorrectionNotices_(demandas,respostas,lojas){
 var visible={};(lojas||[]).forEach(function(store){visible[String(store.id)]=true;});
 var latest={};
 (respostas||[]).forEach(function(row){
  var key=String(row.demanda_id||'')+'|'+String(row.loja_id||'');
  if(!latest[key]||String(row.created_at||'')>String(latest[key].created_at||''))latest[key]=row;
 });
 var activeDemands={};
 (demandas||[]).forEach(function(d){
  if(d.ativa===false||String(d.status||'active').toLowerCase()==='draft')return;
  activeDemands[String(d.id)]=d;
 });
 var notices=[];
 Object.keys(latest).forEach(function(key){
  var response=latest[key],storeId=String(response.loja_id||''),status=String(response.status||'');
  var demand=activeDemands[String(response.demanda_id||'')];
  if(!visible[storeId]||!demand||['ajuste_necessario','reprovada'].indexOf(status)<0)return;
  var feedback=getResponseCorrectionFeedback_(demand.id,storeId,response.id);
  notices.push({id:'correcao-'+String(response.id),demandId:String(demand.id),
   title:(status==='reprovada'?'Resposta reprovada · ':'Ajuste solicitado · ')+String(demand.titulo||'Solicitação'),
   excerpt:feedback||'A gestão solicitou a revisão desta resposta.',
   kind:'action',kindLabel:'Aguardando correção',requiresCorrection:true,
   dateLabel:formatShortDate_(response.created_at)});
 });
 return notices.sort(function(a,b){return a.title.localeCompare(b.title);});
}
// A verificação de reenvio ocorre no servidor e considera a última resposta da loja.
function assertStoreResponseResubmissionAllowed_(demandId,storeId){
 var table=table_('TABLE_RESPOSTAS','bacio_demanda_respostas');
 var rows=supabaseRequest_('/rest/v1/'+table+'?select=id,status,created_at'+
  '&demanda_id=eq.'+encodeURIComponent(String(demandId))+
  '&loja_id=eq.'+encodeURIComponent(String(storeId))+
  '&order=created_at.desc&limit=1','get')||[];
 if(!rows.length)return;
 if(['ajuste_necessario','reprovada'].indexOf(String(rows[0].status||''))<0)
  throw new Error('Uma nova resposta só pode ser enviada após a gestão solicitar correção.');
}

function getContextLabel_(role, user, loja, lojas) {
  if (role === 'loja' && loja) {
    return (loja.codigo ? loja.codigo + ' · ' : '') + (loja.nome || loja.cidade || 'Loja');
  }
  if (isDepartmentUser_(user)) return 'Departamento · '+(user.departamento||user.department||role).toUpperCase();
  if (role === 'regional') return user.regional_nome || user.regional || 'Regional';
  if (role === 'consultor') return 'Consultoria · ' + lojas.length + ' lojas';
  return 'Matriz · Operações';
}

function sameDay_(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDeadline_(date) {
  if (!date || isNaN(date.getTime())) return 'Sem prazo definido';
  var now = new Date();
  var hh = Utilities.formatDate(date, Session.getScriptTimeZone(), 'HH:mm');
  if (sameDay_(date, now)) return 'Vence hoje às ' + hh;

  var tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay_(date, tomorrow)) return 'Vence amanhã às ' + hh;

  return 'Prazo: ' + Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM') + ' às ' + hh;
}

function formatShortDate_(value) {
  if (!value) return '';
  var date = new Date(value);
  if (isNaN(date.getTime())) return '';
  var now = new Date();
  if (sameDay_(date, now)) return 'Hoje';
  var yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay_(date, yesterday)) return 'Ontem';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM');
}

function validateAdminStoreTargets_(lojaIds) {
  var auth = requireAdmin_();
  var visible = getVisibleStores_(auth.user).map(function (l) { return String(l.id); });
  var ids = normalizeArray_(lojaIds);
  ids.forEach(function (id) {
    if (visible.indexOf(String(id)) < 0) {
      throw new Error('A loja ' + id + ' não está disponível para o seu perfil.');
    }
  });
  return auth;
}

// Prazo de resposta e encerramento são obrigatórios para nova publicação.
// Rascunhos podem ser incompletos. A edição de demandas já publicadas
// sem prazo legado permanece possível somente após corrigir o prazo.
function validateDemandDatesForPublication_(startValue,deadlineValue,endValue,nowValue){
 var now=nowValue?new Date(nowValue):new Date();
 var start=startValue?new Date(startValue):now;
 var deadline=deadlineValue?new Date(deadlineValue):null;
 var end=endValue?new Date(endValue):null;
 if(!Number.isFinite(start.getTime()))throw new Error('Data e horário de início inválidos.');
 if(!deadline||!Number.isFinite(deadline.getTime()))
  throw new Error('Informe um prazo de resposta válido antes de publicar a solicitação.');
 if(!end||!Number.isFinite(end.getTime()))
  throw new Error('Informe a data de encerramento antes de publicar a solicitação.');
 if(deadline.getTime()<=start.getTime())
  throw new Error('O prazo de resposta deve ser posterior ao início da solicitação.');
 if(end.getTime()<deadline.getTime())
  throw new Error('O encerramento não pode ser anterior ao prazo de resposta.');
 return {startAt:start.toISOString(),deadline:deadline.toISOString(),endAt:end.toISOString()};
}

function saveDemand(input,authOverride) {
  if (!input) throw new Error('Dados da campanha não informados.');
  var auth = authOverride || getCurrentAuthContext_();
  var departmentAuthor=isDepartmentUser_(auth.user);
  var requestedStoreIds=normalizeArray_(input.lojaIds || []);
  // Homologação só pode ser enviada diretamente pelo admin, sem misturar lojas reais.
  if(requestedStoreIds.some(isConectaTestStoreId_) &&
    (requestedStoreIds.length!==1 || roleOf_(auth.user)!=='admin')) {
    throw new Error('A loja de homologação deve ser selecionada sozinha por um administrador.');
  }
  if(!departmentAuthor)validateAdminStoreTargets_(input.lojaIds || []);
  if(departmentAuthor && input.id){
    var owned=supabaseRequest_('/rest/v1/'+table_('TABLE_DEMANDAS','bacio_demandas')+'?select=*&id=eq.'+encodeURIComponent(String(input.id))+'&limit=1','get')||[];
    if(!owned.length||!mayReadDepartmentDemand_(auth.user,owned[0])||String(owned[0].status)!=='draft'||normalizeJsonObject_(owned[0].cronograma).aprovacaoStatus==='reprovada')throw new Error('Somente solicitações próprias não publicadas podem ser editadas.');
  }

  var titulo = String(input.title || '').trim();
  var descricao = String(input.description || '').trim();
  var tipo = String(input.type || 'demanda').trim().toLowerCase();
  var publishStatus = String(input.publishStatus || 'draft').trim().toLowerCase();

  if (!titulo) throw new Error('Informe um título.');
  if (['campanha', 'demanda', 'comunicado'].indexOf(tipo) < 0) tipo = 'demanda';
  if (['draft', 'active', 'closed'].indexOf(publishStatus) < 0) publishStatus = 'draft';

  // O destinatário interno não é uma loja. Impedir broadcast acidental via API.
  var routing = normalizeJsonObject_(normalizeJsonObject_(input.cronograma).direcionamento);
  var routingMode = String(routing.modo || 'lojas').trim().toLowerCase();
  if (['lojas','regional','consultor_lojas','consultor','departamento'].indexOf(routingMode) < 0)
    throw new Error('Tipo de destinatário não reconhecido.');
  if (routingMode === 'consultor' || routingMode === 'departamento') {
    if(tipo==='comunicado')throw new Error('Comunicados devem continuar no mural informativo, não no fluxo de demandas internas.');
    if (!String(routing.valor || '').trim())
      throw new Error('Selecione um consultor ou departamento para esta atribuição.');
    if (requestedStoreIds.length)
      throw new Error('Atribuições internas não podem carregar lojas como destinatárias.');
    if (publishStatus === 'active') {
      if(roleOf_(auth.user)!=='admin')throw new Error('A publicação de demandas internas exige aprovação administrativa.');
      getInternalRouteRecipients_(routing);
    }
  }

  var modelFields = Array.isArray(input.modelFields) ? input.modelFields : [];
  modelFields = modelFields.map(function (f, index) {
    return {
      id: f.id || 'field-' + index,
      label: String(f.label || '').trim(),
      type: String(f.type || 'text'),
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map(String) : [],
      sourceColumn: f.sourceColumn == null ? null : Number(f.sourceColumn),
      originalLabel: f.originalLabel || null,
      columns: String(f.type||'')==='grid'&&Array.isArray(f.columns) ?
        f.columns.slice(0,10).map(function(c){return {label:String(c.label||'').trim().slice(0,100),
          type:['boolean','number','text'].indexOf(String(c.type))>=0?String(c.type):'text',
          required:c.required===true};}) : [],
      rows: String(f.type||'')==='grid'&&Array.isArray(f.rows) ?
        f.rows.slice(0,50).map(function(value){return String(value||'').trim().slice(0,120);}) : []
    };
  }).filter(function (f) { return Boolean(f.label); });

  var sourceType=String(input.modelSource||'manual');
  if(['manual','spreadsheet','grid','report'].indexOf(sourceType)<0)throw new Error('Formato de resposta inválido.');
  if(sourceType==='manual'){
    modelFields.forEach(function(f){
      if(f.type!=='multi_select')return;
      var choices=(f.options||[]).map(function(x){return String(x||'').trim();});
      if(choices.length<2||choices.length>30||choices.some(function(x){return !x||x.length>120;})||
        new Set(choices.map(function(x){return x.toLowerCase();})).size!==choices.length){
        throw new Error('Múltipla escolha exige de 2 a 30 opções diferentes e preenchidas.');
      }
      f.options=choices;
    });
  }
  if(sourceType==='grid'){
    var grids=modelFields.filter(function(field){return field.type==='grid';});
    if(grids.length!==1||modelFields.length!==1||grids[0].columns.length<1||grids[0].columns.length>10||
       grids[0].rows.length>50||
       grids[0].columns.some(function(col){return !col.label;})||
       grids[0].rows.some(function(row){return !row;}))throw new Error('Defina de 1 a 10 colunas e de 1 a 50 linhas válidas na planilha.');
  }
  if(sourceType==='report'&&modelFields.some(function(field){
    return ['text','textarea','number','date'].indexOf(field.type)<0;
  }))throw new Error('O relatório possui um campo não permitido.');
  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var existingCronograma = {};
  var existingRow = null;

  if (input.id) {
    var existingRows = supabaseRequest_(
      '/rest/v1/' + demandasTable +
        '?select=cronograma,status,inicio_em,publicada_em,encerramento_em,prazo_sla' +
        '&id=eq.' + encodeURIComponent(String(input.id)) + '&limit=1',
      'get'
    ) || [];
    if (existingRows.length) {
      existingRow = existingRows[0];
      existingCronograma = normalizeJsonObject_(existingRow.cronograma);
      var previousDirection=normalizeJsonObject_(existingCronograma.direcionamento);
      if(String(existingRow.status)==='active' &&
         (String(previousDirection.modo||'lojas')!==routingMode||
          (routingMode==='consultor'||routingMode==='departamento')&&
          internalRoutingKey_(previousDirection.valor)!==internalRoutingKey_(routing.valor)))
        throw new Error('Não é permitido trocar o destinatário de uma demanda já publicada. Crie outra demanda.');
    }
  }

  var incomingCronograma = normalizeJsonObject_(input.cronograma);
  var cronograma = {};
  Object.keys(existingCronograma).forEach(function (key) { cronograma[key] = existingCronograma[key]; });
  Object.keys(incomingCronograma).forEach(function (key) { cronograma[key] = incomingCronograma[key]; });

  if(departmentAuthor){
    cronograma.departamentoSolicitante=String(auth.user.departamento||auth.user.department||roleOf_(auth.user));
    if(existingCronograma.aprovacaoStatus==='reprovada')throw new Error('Solicitação reprovada definitivamente não pode ser reenviada.');
    cronograma.aprovacaoStatus='pendente';
    if(existingCronograma.aprovacaoStatus==='ajustes'){
      cronograma.decisaoJustificativa='';
      var history=Array.isArray(cronograma.historicoAprovacao)?cronograma.historicoAprovacao:[];
      history.push({acao:'reenviada',por:auth.email,em:new Date().toISOString()});
      cronograma.historicoAprovacao=history;
    }
    publishStatus='draft';
  }

  // As datas principais agora ficam em colunas próprias.
  // Aceitamos nomes alternativos vindos do HTML para manter compatibilidade.
  var inicioEm = input.startAt || input.inicioEm || input.inicio_em ||
    (existingRow ? existingRow.inicio_em : null) ||
    cronograma.inicio_em || cronograma.inicioEm || null;

  var publicadaEm = input.publishedAt || input.publicadaEm || input.publicada_em ||
    (existingRow ? existingRow.publicada_em : null) ||
    cronograma.publicada_em || cronograma.publicadaEm || null;

  var encerramentoEm = input.endAt || input.encerramentoEm || input.encerramento_em ||
    (existingRow ? existingRow.encerramento_em : null) ||
    cronograma.encerramento_em || cronograma.encerramentoEm || null;

  var prazoSla = input.deadline || input.prazoSla || input.prazo_sla ||
    (existingRow ? existingRow.prazo_sla : null) || null;

  // Para uma nova solicitação, início é automático. A gestão informa prazo
  // e encerramento antes de publicar; a validação também é obrigatória aqui.
  if(!inicioEm && !existingRow)inicioEm=new Date().toISOString();
  if(publishStatus==='active' && (tipo==='demanda'||tipo==='campanha')){
    var verifiedDates=validateDemandDatesForPublication_(inicioEm,prazoSla,encerramentoEm);
    inicioEm=verifiedDates.startAt;
    prazoSla=verifiedDates.deadline;
    encerramentoEm=verifiedDates.endAt;
  }

  if (publishStatus === 'active' && !publicadaEm) {
    publicadaEm = new Date().toISOString();
  }
  if (publishStatus === 'closed' && !encerramentoEm) {
    encerramentoEm = new Date().toISOString();
  }

  // O JSON fica reservado para regras flexíveis, principalmente lembretes.
  delete cronograma.publicada_em;
  delete cronograma.publicadaEm;
  delete cronograma.inicio_em;
  delete cronograma.inicioEm;
  delete cronograma.encerramento_em;
  delete cronograma.encerramentoEm;
  if (!Array.isArray(cronograma.lembretes)) cronograma.lembretes = [];

  var payload = {
    titulo: titulo,
    descricao: descricao,
    tipo: tipo,
    inicio_em: inicioEm || null,
    publicada_em: publicadaEm || null,
    prazo_sla: prazoSla || null,
    encerramento_em: encerramentoEm || null,
    cronograma: cronograma,
    status: publishStatus,
    resposta_obrigatoria: input.responseRequired !== false,
    model_source: sourceType,
    model_fields: modelFields,
    import_meta: input.importMeta || null,
    loja_ids: normalizeArray_(input.lojaIds || []),
    updated_at: new Date().toISOString(),
    ativa: true
  };

  var result;

  if (input.id) {
    result = supabaseRequest_(
      '/rest/v1/' + demandasTable + '?id=eq.' + encodeURIComponent(String(input.id)),
      'patch',
      payload,
      'return=representation'
    );
  } else {
    payload.created_by = auth.email;
    payload.created_at = new Date().toISOString();
    result = supabaseRequest_(
      '/rest/v1/' + demandasTable,
      'post',
      payload,
      'return=representation'
    );
  }

  // Notify only on first publication (draft -> active or new active).
  // Editing an already published item must not generate duplicate alerts.
  var wasPublished = existingRow && String(existingRow.status || '').toLowerCase() === 'active';
  if (publishStatus === 'active' && !wasPublished) {
    var publishedId = result && result[0] && result[0].id || input.id;
    try {
      var notificationResult = isDirectInternalDemand_({cronograma:cronograma}) ?
        notifyInternalDemand_(auth,{id:publishedId,titulo:titulo,cronograma:cronograma},'assigned') :
        notifyDemandPublished_(auth, {
          id: publishedId,
          title: titulo,
          type: tipo,
          department: String(cronograma.departamentoSolicitante||'Operações'),
          lojaIds: normalizeArray_(input.lojaIds || [])
        });
      return {ok:true,row:result&&result[0]?result[0]:null,notifications:notificationResult};
    } catch (notificationError) {
      console.error('Falha ao notificar publicação da demanda: '+String(notificationError));
      return {ok:true,row:result&&result[0]?result[0]:null,notificationError:String(notificationError)};
    }
  }
  if (departmentAuthor && input.id && existingCronograma.aprovacaoStatus==='ajustes' && cronograma.aprovacaoStatus==='pendente') {
    try {
      var resend=notifyDemandPendingApproval_({title:titulo,department:cronograma.departamentoSolicitante});
      return {ok:true,row:result&&result[0]?result[0]:null,notifications:resend};
    } catch(err) {
      return {ok:true,row:result&&result[0]?result[0]:null,notificationError:String(err)};
    }
  }
  // New department requests notify administrators once, never again on edits.
  if(departmentAuthor && !input.id && publishStatus==='draft' && cronograma.aprovacaoStatus==='pendente'){
    try{
      var approvalNotice=notifyDemandPendingApproval_({title:titulo,department:cronograma.departamentoSolicitante});
      return {ok:true,row:result&&result[0]?result[0]:null,notifications:approvalNotice};
    }catch(err){
      console.error('Falha no aviso de aprovação: '+String(err));
      return {ok:true,row:result&&result[0]?result[0]:null,notificationError:String(err)};
    }
  }
  return { ok: true, row: result && result[0] ? result[0] : null };
}

function notifyDemandPendingApproval_(demand) {
  var users=safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+'?select=email,role,ativo&ativo=eq.true&role=eq.admin&limit=5000',[]);
  var unique={};
  users.forEach(function(u){var email=String(u.email||'').trim().toLowerCase();if(email)unique[email]=true;});
  var emails=Object.keys(unique);
  if(!emails.length)return {sent:0,reason:'no_active_admin'};
  var now=new Date().toISOString();
  var payload=emails.map(function(email){return {
    usuario_email:email,titulo:'Solicitação aguardando aprovação',
    mensagem:'Nova solicitação de '+String(demand.department||'departamento')+' para aprovar: '+String(demand.title||''),
    lida:false,created_at:now
  };});
  supabaseRequest_('/rest/v1/'+table_('TABLE_NOTIFICACOES','bacio_notificacoes'),'post',payload,'return=minimal');
  return {sent:payload.length};
}

function notifyDemandPublished_(auth, demand) {
  var ids = (demand.lojaIds || []).map(String);
  var idSet = {};
  ids.forEach(function(id){idSet[id]=true;});
  var users = supabaseRequest_('/rest/v1/' + table_('TABLE_USUARIOS','bacio_usuarios') +
    '?select=*&ativo=eq.true&limit=5000','get') || [];
  var stores = supabaseRequest_('/rest/v1/' + table_('TABLE_LOJAS','bacio_lojas') +
    '?select=*&limit=5000','get') || [];
  var selectedStores=stores.filter(function(store){
    return (ids.length ? !!idSet[String(store.id)] : !isConectaTestStoreId_(store.id)) && store.ativa!==false;
  });
  if(ids.length===0)selectedStores.forEach(function(store){idSet[String(store.id)]=true;});
  var recipients={};
  users.forEach(function(user){
    var email=String(user.email||'').trim().toLowerCase();
    if(!email)return;
    var role=roleOf_(user),canSee=false;
    if(role==='admin')canSee=true;
    else if(isDepartmentUser_(user))canSee=departmentOfUser_(user)===String(demand.department||'Operações').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    else if(role==='loja')canSee=!!idSet[String(user.loja_id||user.lojaId||'')];
    else if(role==='consultor')canSee=selectedStores.some(function(store){
      return String(store.consultor_id||'')===String(user.consultor_id||user.id||'');
    });
    else if(role==='regional')canSee=selectedStores.some(function(store){
      return String(store.regional_id||'')===String(user.regional_id||'');
    });
    if(canSee)recipients[email]=true;
  });
  var emails=Object.keys(recipients);
  if(!emails.length)return {sent:0,reason:'no_active_recipients'};
  var isComunicado=String(demand.type||'').toLowerCase()==='comunicado';
  var now=new Date().toISOString(),message=(isComunicado?'Novo comunicado publicado: ':'Nova '+(demand.type==='campanha'?'campanha':'demanda')+' publicada: ')+demand.title;
  // Abrir a demanda pelo ID, sem depender de correspondência do título.
  var demandId=String(demand.id||'');
  if(/^[a-z0-9-]{1,80}$/i.test(demandId))message+=' [[bacio-demand:'+demandId+']]';
  var payload=emails.map(function(email){return {
    usuario_email:email,titulo:isComunicado?'Novo comunicado publicado':'Nova solicitação publicada',mensagem:message,
    lida:false,created_at:now
  };});
  // A single batch creates one notification per eligible user.
  supabaseRequest_('/rest/v1/'+table_('TABLE_NOTIFICACOES','bacio_notificacoes'),'post',payload,'return=minimal');
  return {sent:payload.length};
}

function decideDepartmentRequest(id,decision,reason) {
 var auth=requireAdmin_();
 decision=String(decision||'');
 if(['ajustes','reprovada'].indexOf(decision)<0)throw new Error('Decisão inválida.');
 reason=String(reason||'').trim();
 if(reason.length<5)throw new Error('Informe a justificativa com pelo menos 5 caracteres.');
 var table=table_('TABLE_DEMANDAS','bacio_demandas');
 var rows=supabaseRequest_('/rest/v1/'+table+'?select=*&id=eq.'+encodeURIComponent(String(id))+'&limit=1','get')||[];
 if(!rows.length)throw new Error('Solicitação não encontrada.');
 var d=rows[0],c=normalizeJsonObject_(d.cronograma);
 if(String(d.status)!=='draft'||c.aprovacaoStatus!=='pendente')throw new Error('Solicitação não está aguardando aprovação.');
 var now=new Date().toISOString();
 c.aprovacaoStatus=decision;
 c.decisaoJustificativa=reason;
 c.decisaoPor=auth.email;
 c.decisaoEm=now;
 var history=Array.isArray(c.historicoAprovacao)?c.historicoAprovacao:[];
 history.push({acao:decision,justificativa:reason,por:auth.email,em:now});
 c.historicoAprovacao=history;
 supabaseRequest_('/rest/v1/'+table+'?id=eq.'+encodeURIComponent(String(id)),'patch',{cronograma:c,updated_at:now},'return=minimal');
 var users=safeSupabaseSelect_('/rest/v1/'+table_('TABLE_USUARIOS','bacio_usuarios')+'?select=email,role,ativo&ativo=eq.true&limit=5000',[]);
 var department=String(c.departamentoSolicitante||'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');
 var recipient={};
 users.forEach(function(u){if(isDepartmentUser_(u)&&departmentOfUser_(u)===department){var email=String(u.email||'').toLowerCase().trim();if(email)recipient[email]=true;}});
 if(d.created_by && users.some(function(u){return String(u.email||'').toLowerCase()===String(d.created_by).toLowerCase() && isDepartmentUser_(u)}))recipient[String(d.created_by).toLowerCase()]=true;
 var notificationError=null;
 try{
 var emails=Object.keys(recipient);
 if(emails.length){
 var msg=(decision==='ajustes'?'Ajustes solicitados':'Solicitação reprovada')+': '+String(d.titulo||'')+'. Motivo: '+reason;
 supabaseRequest_('/rest/v1/'+table_('TABLE_NOTIFICACOES','bacio_notificacoes'),'post',emails.map(function(email){return {usuario_email:email,titulo:decision==='ajustes'?'Ajustes solicitados':'Solicitação reprovada',mensagem:msg,lida:false,created_at:now};}),'return=minimal');
 }
 }catch(err){notificationError=String(err);}
 return {ok:true,notificationError:notificationError};
}

function setDemandStatus(demandaId, newStatus) {
  requireAdmin_();
  if (!demandaId) throw new Error('Campanha/demanda não informada.');

  var status = String(newStatus || '').toLowerCase();
  if (['draft', 'active', 'closed'].indexOf(status) < 0) {
    throw new Error('Status inválido.');
  }

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var rows = supabaseRequest_(
    '/rest/v1/' + demandasTable + '?select=id,publicada_em,encerramento_em&id=eq.' +
      encodeURIComponent(String(demandaId)) + '&limit=1',
    'get'
  ) || [];

  if (!rows.length) throw new Error('Demanda não encontrada.');

  var row = rows[0];
  var fullRows=supabaseRequest_('/rest/v1/'+demandasTable+'?select=*&id=eq.'+encodeURIComponent(String(demandaId))+'&limit=1','get')||[];
  var full=fullRows[0]||{};
  var schedule=normalizeJsonObject_(full.cronograma);
  var internal=isDirectInternalDemand_(full);
  if(status==='active'&&internal){
    getInternalRouteRecipients_(internalRoute_(full));
    validateDemandDatesForPublication_(full.inicio_em,full.prazo_sla,full.encerramento_em);
  }
  if(status==='active' && schedule.aprovacaoStatus==='pendente'){
    var history=Array.isArray(schedule.historicoAprovacao)?schedule.historicoAprovacao:[];
    history.push({acao:'aprovada',por:getCurrentAuthContext_().email,em:new Date().toISOString()});
    schedule.historicoAprovacao=history;
    schedule.aprovacaoStatus='aprovada';
    schedule.aprovadoPor=getCurrentAuthContext_().email;
    schedule.aprovadoEm=new Date().toISOString();
  }
  var payload = {
    status: status,
    cronograma: schedule,
    updated_at: new Date().toISOString()
  };

  if (status === 'active' && !row.publicada_em) {
    payload.publicada_em = new Date().toISOString();
  }
  if (status === 'closed' && !row.encerramento_em) {
    payload.encerramento_em = new Date().toISOString();
  }
  if (status !== 'closed' && row.encerramento_em && !internal) {
    payload.encerramento_em = null;
  }

  var result = supabaseRequest_(
    '/rest/v1/' + demandasTable + '?id=eq.' + encodeURIComponent(String(demandaId)),
    'patch',
    payload,
    'return=representation'
  );

  var notificationInfo=null;
  if(status==='active'&&String(full.status||'')!=='active'){
    try{
      notificationInfo=internal ?
        notifyInternalDemand_(getCurrentAuthContext_(),full,'assigned') :
        notifyDemandPublished_(getCurrentAuthContext_(),{
          id:full.id,title:full.titulo||'',type:full.tipo||'demanda',
          department:schedule.departamentoSolicitante||'Operações',lojaIds:normalizeArray_(full.loja_ids||[])
        });
    }catch(e){notificationInfo={error:String(e)};}
  }
  return { ok: true, row: result && result[0] ? result[0] : null, notifications:notificationInfo };
}

// BR-055: exclusão lógica em lote, apenas admin, escopo/tipo conferidos no servidor.
// Uma única operação PATCH atualiza os IDs validados sem apagar históricos.
function archiveConectaItemsBulk(input) {
 requireAdmin_();
 input=input||{};
 var kind=String(input.kind||'');
 if(kind!=='comunicado'&&kind!=='solicitacao')throw new Error('Tipo de exclusão inválido.');
 var ids=Array.isArray(input.ids)?input.ids.map(String):[];
 if(!ids.length||ids.length>100||new Set(ids).size!==ids.length||
    ids.some(function(id){return !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);}))
    throw new Error('Selecione de 1 a 100 registros válidos, sem repetições.');
 var table=table_('TABLE_DEMANDAS','bacio_demandas');
 var joined='('+ids.join(',')+')';
 var rows=supabaseRequest_('/rest/v1/'+table+'?select=id,tipo,ativa&id=in.'+encodeURIComponent(joined),'get')||[];
 if(rows.length!==ids.length||rows.some(function(row){
    return row.ativa===false||(kind==='comunicado'
      ? String(row.tipo||'').toLowerCase()!=='comunicado'
      : String(row.tipo||'').toLowerCase()==='comunicado');
 }))throw new Error('A seleção contém registros indisponíveis ou de outra categoria. Atualize a lista.');
 // Filtrar também pela categoria no UPDATE, protegendo contra alterações concorrentes.
 var category=kind==='comunicado'?'&tipo=eq.comunicado':'&tipo=neq.comunicado';
 var updated=supabaseRequest_('/rest/v1/'+table+'?id=in.'+encodeURIComponent(joined)+category+'&ativa=eq.true',
    'patch',{ativa:false,updated_at:new Date().toISOString()},'return=representation')||[];
 if(updated.length!==ids.length)throw new Error('Alguns registros mudaram durante a operação. Atualize a lista e confira.');
 return {ok:true,count:updated.length};
}

function deleteDemand(demandaId) {
  requireAdmin_();
  if (!demandaId) throw new Error('Campanha/demanda não informada.');

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  supabaseRequest_(
    '/rest/v1/' + demandasTable + '?id=eq.' + encodeURIComponent(String(demandaId)),
    'patch',
    { ativa: false, updated_at: new Date().toISOString() },
    'return=minimal'
  );

  return { ok: true };
}

// A visualização de planilha é filtrada no servidor para perfis não-admin.
// Preserva cabeçalhos/valores por loja, sem liberar outras carteiras.
function scopedCampaignImportMeta_(meta,stores) {
  var source=normalizeJsonObject_(meta);
  if(!source.perStore&&!source.sheetLayouts)return source;
  var allowed={};
  (stores||[]).forEach(function(store){
    var match=String(store.nome||'').match(/LJ\s*0*(\d{1,5})/i);
    var raw=match?match[1]:String(store.codigo||'');
    var number=raw.match(/\d+/);
    if(number)allowed[('0000'+String(Number(number[0]))).slice(-4)]=true;
  });
  var selected={},sections=[];
  Object.keys(source.perStore||{}).forEach(function(code){
    if(!allowed[code])return;
    selected[code]=source.perStore[code];
    sections=sections.concat(source.perStore[code]||[]);
  });
  return {version:source.version,fileName:source.fileName,
    sheets:source.sheets,perStore:selected,storeSections:sections,
    editableColumns:source.editableColumns||null};
}

function getDemandDetail(demandaId,authOverride) {
  if (!demandaId) throw new Error('Campanha/demanda não informada.');

  var auth = authOverride || getCurrentAuthContext_();
  var user = auth.user;
  var role = roleOf_(user);
  var lojas = getVisibleStores_(user);
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');

  var rows = supabaseRequest_(
    '/rest/v1/' + demandasTable + '?select=*&id=eq.' + encodeURIComponent(String(demandaId)) + '&ativa=eq.true&limit=1',
    'get'
  );

  if (!rows || !rows.length) throw new Error('Campanha/demanda não encontrada.');
  var demanda = rows[0];

  if (isDirectInternalDemand_(demanda)) return getInternalDemandDetail_(demanda,auth);

  if (!(isDepartmentUser_(user) ? mayReadDepartmentDemand_(user,demanda) : demandaVisivelNoEscopo_(demanda, visibleLojaIds))) {
    throw new Error('Você não tem acesso a esta campanha/demanda.');
  }
  if (role !== 'admin' && !isDepartmentUser_(user) && String(demanda.status || 'active').toLowerCase() === 'draft') {
    throw new Error('Este item ainda está em rascunho.');
  }

  if(isDepartmentUser_(user)){
    var allStores=supabaseRequest_('/rest/v1/'+table_('TABLE_LOJAS','bacio_lojas')+'?select=*&ativa=eq.true&limit=5000','get')||[];
    visibleLojaIds=allStores.map(function(l){return String(l.id);});
    lojas=allStores;
  }
  var targetIds = getTargetStoreIds_(demanda, visibleLojaIds);
  var targetStores = lojas.filter(function (l) {
    return targetIds.indexOf(String(l.id)) >= 0;
  });

  var respostas = supabaseRequest_(
    '/rest/v1/' + respostasTable +
      '?select=*&demanda_id=eq.' + encodeURIComponent(String(demandaId)) +
      '&order=created_at.desc',
    'get'
  ) || [];

  respostas = respostas.filter(function (r) {
    return targetIds.indexOf(String(r.loja_id || '')) >= 0;
  });

  var latest = latestResponsesByStore_(demandaId, respostas);
  var storeStatus = targetStores.map(function (loja) {
    var response = latest[String(loja.id)] || null;
    return {
      id: String(loja.id),
      codigo: loja.codigo || '',
      nome: loja.nome || '',
      cidade: loja.cidade || '',
      responded: Boolean(response),
      responseId: response ? response.id : null,
      respondedAt: response ? response.created_at : null,
      respondedBy: response ? response.usuario_email : null,
      status: response ? (response.status || 'respondido') : 'pendente'
    };
  });

  var answered = storeStatus.filter(function (s) { return s.responded; }).length;
  var myResponse = null;
  if (role === 'loja') {
    myResponse = latest[String(user.loja_id || user.lojaId || '')] || null;
  }

  return {
    id: String(demanda.id),
    title: demanda.titulo || '',
    description: demanda.descricao || '',
    type: String(demanda.tipo || 'demanda').toLowerCase(),
    inicioEm: demanda.inicio_em || '',
    publicadaEm: demanda.publicada_em || '',
    deadline: demanda.prazo_sla || '',
    deadlineLabel: formatDeadline_(demanda.prazo_sla ? new Date(demanda.prazo_sla) : null),
    encerramentoEm: demanda.encerramento_em || '',
    publishStatus: String(demanda.status || 'active').toLowerCase(),
    cronograma: normalizeJsonObject_(demanda.cronograma),
    timeline: timelineInfo_(demanda, answered, storeStatus.length, new Date()),
    responseRequired: demanda.resposta_obrigatoria !== false,
    modelSource: demanda.model_source || 'manual',
    modelFields: normalizeObjectArray_(demanda.model_fields),
    importMeta: role==='admin'?(demanda.import_meta||null):scopedCampaignImportMeta_(demanda.import_meta,targetStores),
    lojaIds: normalizeArray_(demanda.loja_ids),
    totalStores: storeStatus.length,
    answeredCount: answered,
    pendingCount: Math.max(storeStatus.length - answered, 0),
    progress: storeStatus.length ? Math.round((answered / storeStatus.length) * 100) : 0,
    stores: storeStatus,
    myResponse: myResponse ? {
      id: myResponse.id,
      status: myResponse.status || 'respondido',
      answers: myResponse.resposta_json || {},
      observacao: myResponse.observacao || '',
      createdAt: myResponse.created_at || '',
      userEmail: myResponse.usuario_email || '',
      feedback: ['ajuste_necessario','reprovada'].indexOf(String(myResponse.status||''))>=0 ?
        getResponseCorrectionFeedback_(demandaId,String(user.loja_id||user.lojaId||''),myResponse.id) : ''
    } : null,
    role: role
  };
}

// Verifica no servidor todas as células de resposta para impedir edição das
// quantidades/códigos originais ou respostas de outra loja via payload manipulado.
function sheetEditableColumnsServer_(headers){
 var result={},width=Math.max.apply(null,(headers||[]).map(function(r){return r.length;}).concat([0]));
 for(var i=0;i<width;i++){
  var text=(headers||[]).map(function(row){return String(row[i]||'');}).join(' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/plaquinhas?|insumos?\s+recebidos?|recebeu\s+(os\s+)?insumos?|recebimento\s+confirmado/.test(text))result[i]={type:'boolean',required:true};
  else if(/observacoes|observacao|comentarios?|justificativa/.test(text))result[i]={type:'text',required:false};
  else if(/quantidade\s+recebida|qtd\.?\s+recebida/.test(text))result[i]={type:'number',required:false};
 }
 return result;
}
function validateSheetCellAnswers_(answers,detail) {
 answers=answers||{};
 var meta=detail&&detail.importMeta||{},sections=meta.storeSections||[];
 if(!sections.length)return;
 var keys=Object.keys(answers).filter(function(k){return k.indexOf('sheetcell_')===0;});
 // Versões anteriores aceitam a conferência legada. Modelos novos exigem
 // preenchimento das confirmações da própria planilha, inclusive via API.
 if(!keys.length&&Number(meta.version||0)<5)return;
 if(keys.length>600)throw new Error('Número de células preenchidas excede o limite.');
 var allowed={},required={};
 sections.forEach(function(sec){
  var sheet=String(sec.sheet||''),index=(meta.sheets||[]).findIndex(function(t){return String(t.sheet)===sheet;});
  if(index<0)throw new Error('Aba de resposta não identificada.');
  var rules=meta.editableColumns&&Object.prototype.hasOwnProperty.call(meta.editableColumns,sheet)?
    meta.editableColumns[sheet]:sheetEditableColumnsServer_(sec.sheetHeaders||[]);
  Object.keys(rules||{}).forEach(function(col){
   var rule=rules[col]||{},type=String(rule.type||'readonly');
   if(['boolean','text','number'].indexOf(type)<0)return;
   var key='sheetcell_'+index+'_'+Number(sec.sourceRow)+'_'+Number(col);
   allowed[key]=type;
   if(rule.required===true)required[key]=true;
  });
 });
 keys.forEach(function(key){
  var type=allowed[key],value=answers[key];
  if(!type)throw new Error('A célula '+key+' não está autorizada para edição.');
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('Valor de resposta inválido.');
  value=String(value).trim();
  if(value.length>2000)throw new Error('O campo excede 2.000 caracteres.');
  if(type==='boolean'&&value&&['Sim','Não','Recebimento errado / anotar observação','Não se aplica'].indexOf(value)<0)
   throw new Error('Selecione uma opção válida de recebimento.');
  if(type==='number'&&value&&(!isFinite(Number(value))||Number(value)<0))throw new Error('Quantidade inválida.');
 });
 Object.keys(required).forEach(function(k){
  if(!String(answers[k]||'').trim())throw new Error('Preencha todas as colunas de confirmação destacadas antes de enviar.');
 });
}
// Validação no servidor dos novos modelos manuais, sem interferir com Excel importado.
function validateCustomModelAnswers_(answers,detail){
  var source=String(detail&&detail.modelSource||'manual'),fields=detail&&detail.modelFields||[];
  if(['grid','report'].indexOf(source)<0)return;
  answers=answers||{};
  if(typeof answers!=='object'||Array.isArray(answers))throw new Error('Dados de resposta inválidos.');
  var keys=Object.keys(answers),allowed={},required={};
  if(keys.length>700)throw new Error('Número de campos de resposta excede o limite.');
  if(source==='grid'){
    var field=fields.find(function(f){return f.type==='grid';});
    if(!field||!Array.isArray(field.rows)||!Array.isArray(field.columns)||
        field.rows.length>50||field.columns.length>10)throw new Error('Planilha inválida.');
    if(field.rows.length){
      // Compatibilidade: planilhas antigas seguem com linhas fixas.
      field.rows.forEach(function(row,ri){
        field.columns.forEach(function(col,ci){
          var key='gridcell_'+String(field.id)+'_'+ri+'_'+ci;
          allowed[key]=String(col.type||'text');
          if(detail.responseRequired!==false&&col.required===true)required[key]=true;
        });
      });
    }else{
      // Planilha sem linhas fixas: somente a linha inicial, definida pelo modelo,
      // pode ser preenchida. A loja nunca pode criar novas linhas no payload.
      var prefix='gridcell_'+String(field.id)+'_',present={};
      // Entregas anteriores à BR-051 podem ter várias linhas; permitir somente
      // corrigir linhas já existentes, nunca adicionar novas.
      var previous=(detail.myResponse&&detail.myResponse.answers)||{},maxAllowedRow=0;
      Object.keys(previous).forEach(function(key){
        if(key.indexOf(prefix)!==0)return;
        var parts=key.slice(prefix.length).split('_'),ri=Number(parts[0]);
        if(parts.length===2&&/^\d+$/.test(parts[0])&&ri>=0&&ri<50)
          maxAllowedRow=Math.max(maxAllowedRow,ri);
      });
      keys.forEach(function(key){
        if(key.indexOf(prefix)!==0)return;
        var parts=key.slice(prefix.length).split('_'),ri=Number(parts[0]),ci=Number(parts[1]);
        if(parts.length!==2||!/^\d+$/.test(parts[0])||!/^\d+$/.test(parts[1])||
           !Number.isInteger(ri)||!Number.isInteger(ci)||ri<0||ri>maxAllowedRow||
           ci<0||ci>=field.columns.length||key!==prefix+ri+'_'+ci)return;
        allowed[key]=String(field.columns[ci].type||'text');
        if(String(answers[key]||'').trim())present[ri]=true;
      });
      if(detail.responseRequired!==false&&!Object.keys(present).length)
        throw new Error('Preencha ao menos uma linha da planilha antes de enviar.');
      Object.keys(present).forEach(function(ri){
        field.columns.forEach(function(col,ci){
          if(detail.responseRequired!==false&&col.required===true)
            required[prefix+ri+'_'+ci]=true;
        });
      });
    }
  }else{
    fields.forEach(function(f){allowed[String(f.id)]=String(f.type||'text');
      if(detail.responseRequired!==false&&f.required===true)required[String(f.id)]=true;});
  }
  keys.forEach(function(key){
    var type=allowed[key],val=answers[key];
    if(!type)throw new Error('Campo não autorizado na resposta: '+key);
    if(typeof val!=='string'&&typeof val!=='number')throw new Error('Valor de resposta inválido.');
    var str=String(val).trim();
    if(str.length>2000)throw new Error('O campo excede 2.000 caracteres.');
    if(type==='boolean'&&str&&['Sim','Não','Não se aplica'].indexOf(str)<0)
      throw new Error('Selecione Sim, Não ou Não se aplica.');
    if(type==='number'&&str&&!isFinite(Number(str)))throw new Error('Número inválido.');
    if(type==='date'&&str&&!/^\d{4}-\d{2}-\d{2}$/.test(str))throw new Error('Data inválida.');
  });
  Object.keys(required).forEach(function(key){
    if(!String(answers[key]||'').trim())throw new Error('Preencha as colunas e os campos obrigatórios.');
  });
}

// Só as opções cadastradas podem ser marcadas pela loja. O payload usa
// JSON string para continuar compatível com respostas de texto já salvas.
function validateMultipleChoiceAnswers_(answers,detail){
 var fields=detail&&detail.modelFields||[];
 var multi=fields.filter(function(f){return String(f.type||'')==='multi_select';});
 if(!multi.length)return;
 if(!answers||typeof answers!=='object'||Array.isArray(answers))
  throw new Error('Formato de respostas inválido.');
 multi.forEach(function(f){
  var id=String(f.id||''),raw=answers[id],selections=[];
  if(raw!==undefined&&raw!==null&&String(raw)!==''){
    if(typeof raw!=='string'||raw.length>4000)
      throw new Error('Múltipla escolha inválida.');
    try{selections=JSON.parse(raw);}catch(error){throw new Error('Múltipla escolha inválida.');}
    if(!Array.isArray(selections))throw new Error('Múltipla escolha inválida.');
  }
  var choices=(f.options||[]).map(String);
  if(selections.length>choices.length||selections.length>30||
     selections.some(function(x){return typeof x!=='string'||choices.indexOf(x)<0;})||
     new Set(selections).size!==selections.length)
    throw new Error('A resposta contém uma opção não cadastrada ou repetida.');
  if(detail.responseRequired!==false&&f.required===true&&!selections.length)
    throw new Error('Marque pelo menos uma opção na pergunta obrigatória.');
 });
}

function submitDemandResponse(input) {
  var auth = getCurrentAuthContext_();
  var user = auth.user;
  var role = roleOf_(user);

  if (!input || !input.demandaId) throw new Error('Demanda não informada.');

  var lojas = getVisibleStores_(user);
  var visibleIds = lojas.map(function (l) { return String(l.id); });
  var lojaId = String(input.lojaId || user.loja_id || user.lojaId || '');

  if (!lojaId) throw new Error('Loja não identificada.');
  if (visibleIds.indexOf(lojaId) < 0) {
    throw new Error('Você não tem permissão para responder por esta loja.');
  }
  if (role === 'loja' && lojaId !== String(user.loja_id || user.lojaId || '')) {
    throw new Error('Você não tem permissão para responder por outra loja.');
  }

  var detail = getDemandDetail(input.demandaId);
  var targetIds = detail.stores.map(function (s) { return String(s.id); });
  if (targetIds.indexOf(lojaId) < 0) {
    throw new Error('Esta loja não faz parte desta campanha/demanda.');
  }
  if(role==='loja'){
    validateSheetCellAnswers_(input.answers||{},detail);
    validateCustomModelAnswers_(input.answers||{},detail);
    validateMultipleChoiceAnswers_(input.answers||{},detail);
    assertStoreResponseResubmissionAllowed_(input.demandaId,lojaId);
  }

  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');
  var payload = {
    demanda_id: String(input.demandaId),
    loja_id: lojaId,
    usuario_email: auth.email,
    status: role==='loja' ? 'respondido' : (input.status || 'respondido'),
    resposta_json: input.answers || {},
    observacao: input.observacao || '',
    created_at: new Date().toISOString()
  };

  var inserted = supabaseRequest_(
    '/rest/v1/' + respostasTable,
    'post',
    payload,
    'return=representation'
  );

  // O acesso corporativo de loja precisa ter o mesmo fluxo de aviso da
  // sessão de loja com senha: quem recebe o aviso é a gestão autorizada.
  if(role==='loja'&&typeof notifyManagementV2_==='function'){
    notifyManagementV2_('Nova resposta recebida',
      String(detail.title||'Demanda')+' · '+String((lojas.find(function(l){return String(l.id)===lojaId;})||{}).nome||'Loja'),
      lojaId,String(input.demandaId),
      inserted&&inserted[0]&&inserted[0].id?String(inserted[0].id):'');
  }
  return { ok: true, row: inserted && inserted[0] ? inserted[0] : null };
}

function markNotificationRead(notificationId) {
  if (!notificationId) throw new Error('Notificação não informada.');
  var auth = getCurrentAuthContext_();
  var notificacoesTable = table_('TABLE_NOTIFICACOES', 'bacio_notificacoes');

  supabaseRequest_(
    '/rest/v1/' + notificacoesTable + '?id=eq.' + encodeURIComponent(notificationId) +
      '&usuario_email=eq.' + encodeURIComponent(auth.email),
    'patch',
    { lida: true },
    'return=minimal'
  );

  return { ok: true };
}

function sendChatMessage(input) {
  var auth = getCurrentAuthContext_();
  var user = auth.user;
  var message = String((input && input.message) || '').trim();
  if (!message) throw new Error('Digite uma mensagem.');

  var chatTable = table_('TABLE_CHAT', 'bacio_chat_mensagens');
  var payload = {
    usuario_email: auth.email,
    usuario_nome: user.nome || niceNameFromEmail_(auth.email),
    role: user.role || user.perfil || '',
    loja_id: user.loja_id || user.lojaId || null,
    mensagem: message,
    created_at: new Date().toISOString()
  };

  var inserted = supabaseRequest_(
    '/rest/v1/' + chatTable,
    'post',
    payload,
    'return=representation'
  );

  return { ok: true, row: inserted && inserted[0] ? inserted[0] : null };
}


/* ================================================================
 * BASE DE LOJAS — IMPORTAR / ATUALIZAR
 * - Somente admin
 * - Compara a planilha com o Supabase antes de gravar
 * - Faz UPSERT por id estável
 * - Preserva histórico e IDs já existentes
 * - Pode marcar como inativas lojas ausentes da nova base
 * ================================================================ */

function parseJsonObject_(value) {
  if (!value) return {};
  if (Object.prototype.toString.call(value) === '[object Object]') return value;
  if (typeof value === 'string') {
    try {
      var parsed = JSON.parse(value);
      return parsed && Object.prototype.toString.call(parsed) === '[object Object]' ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return {};
}

function limparTextoLoja_(value) {
  if (value === null || value === undefined) return '';
  var texto = String(value).trim();
  if (!texto) return '';
  var upper = texto.toUpperCase();
  if (upper === '#N/A' || upper === '#REF!' || upper === '#VALUE!' || upper === 'NAN') return '';
  return texto;
}

function criarIdLoja_(codigo, nome) {
  var codigoLimpo = limparTextoLoja_(codigo);
  if (codigoLimpo) {
    return codigoLimpo.toUpperCase().replace(/\s+/g, '');
  }

  var nomeLimpo = limparTextoLoja_(nome);
  var match = nomeLimpo.match(/\bLJ\s*0*(\d+)\b/i);
  if (!match) return '';

  var numero = String(match[1]);
  while (numero.length < 4) numero = '0' + numero;
  return 'LJ' + numero;
}

function normalizeStoreImportRows_(rows) {
  rows = Array.isArray(rows) ? rows : [];

  var byId = {};
  var rejected = [];
  var duplicateCount = 0;

  rows.forEach(function (row, index) {
    row = row || {};

    var nome = limparTextoLoja_(row.nome);
    var codigo = limparTextoLoja_(row.codigo);
    var id = criarIdLoja_(codigo, nome);

    if (!nome) {
      rejected.push({ linha: index + 2, motivo: 'Centro de Custo vazio' });
      return;
    }

    if (!id) {
      rejected.push({ linha: index + 2, nome: nome, motivo: 'Código da loja não identificado' });
      return;
    }

    var extras = {
      regional: limparTextoLoja_(row.regional),
      consultor: limparTextoLoja_(row.consultor),
      estado: limparTextoLoja_(row.estado),
      formato: limparTextoLoja_(row.formato),
      delivery: limparTextoLoja_(row.delivery),
      endereco: limparTextoLoja_(row.endereco)
    };

    Object.keys(extras).forEach(function (key) {
      if (!extras[key]) delete extras[key];
    });

    if (byId[id]) duplicateCount++;

    byId[id] = {
      id: id,
      codigo: codigo || id,
      nome: nome,
      email: limparTextoLoja_(row.email).toLowerCase() || null,
      cidade: limparTextoLoja_(row.cidade) || null,
      ativa: true,
      dados_extras: extras,
      updated_at: new Date().toISOString()
    };
  });

  return {
    stores: Object.keys(byId).map(function (id) { return byId[id]; }),
    rejected: rejected,
    duplicateCount: duplicateCount
  };
}

function comparableStore_(row) {
  row = row || {};
  var extras = parseJsonObject_(row.dados_extras);
  return {
    codigo: limparTextoLoja_(row.codigo),
    nome: limparTextoLoja_(row.nome),
    email: limparTextoLoja_(row.email).toLowerCase(),
    cidade: limparTextoLoja_(row.cidade),
    regional: limparTextoLoja_(extras.regional),
    consultor: limparTextoLoja_(extras.consultor),
    estado: limparTextoLoja_(extras.estado),
    formato: limparTextoLoja_(extras.formato),
    delivery: limparTextoLoja_(extras.delivery),
    endereco: limparTextoLoja_(extras.endereco),
    ativa: row.ativa !== false
  };
}

function diffStore_(existing, incoming) {
  var before = comparableStore_(existing);
  var after = comparableStore_(incoming);
  var labels = {
    codigo: 'Código',
    nome: 'Centro de Custo',
    email: 'E-mail',
    cidade: 'Cidade',
    regional: 'Regional',
    consultor: 'Consultor',
    estado: 'Estado',
    formato: 'Formato',
    delivery: 'Delivery',
    endereco: 'Endereço',
    ativa: 'Status'
  };

  var changes = [];
  Object.keys(labels).forEach(function (key) {
    var a = before[key];
    var b = after[key];
    if (String(a == null ? '' : a) !== String(b == null ? '' : b)) {
      changes.push({
        campo: key,
        label: labels[key],
        antes: key === 'ativa' ? (a ? 'Ativa' : 'Inativa') : String(a || ''),
        depois: key === 'ativa' ? (b ? 'Ativa' : 'Inativa') : String(b || '')
      });
    }
  });
  return changes;
}

function getAllStoresForImport_() {
  var lojasTable = table_('TABLE_LOJAS', 'bacio_lojas');
  return supabaseRequest_(
    '/rest/v1/' + lojasTable + '?select=*&order=nome.asc',
    'get'
  ) || [];
}

function previewBaseLojas(input) {
  requireAdmin_();

  var rows = input && Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new Error('Nenhuma linha foi recebida para comparação.');

  var normalized = normalizeStoreImportRows_(rows);
  var incoming = normalized.stores;
  var existing = getAllStoresForImport_();

  var existingById = {};
  existing.forEach(function (store) { existingById[String(store.id)] = store; });

  var incomingIds = {};
  var novos = [];
  var alterados = [];
  var semAlteracao = [];

  incoming.forEach(function (store) {
    incomingIds[String(store.id)] = true;
    var current = existingById[String(store.id)];

    if (!current) {
      novos.push({
        id: store.id,
        codigo: store.codigo,
        nome: store.nome,
        regional: parseJsonObject_(store.dados_extras).regional || '',
        consultor: parseJsonObject_(store.dados_extras).consultor || ''
      });
      return;
    }

    var changes = diffStore_(current, store);
    if (changes.length) {
      alterados.push({
        id: store.id,
        codigo: store.codigo,
        nome: store.nome,
        changes: changes
      });
    } else {
      semAlteracao.push(String(store.id));
    }
  });

  var ausentes = existing.filter(function (store) {
    return store.ativa !== false && !incomingIds[String(store.id)];
  }).map(function (store) {
    return {
      id: String(store.id),
      codigo: store.codigo || '',
      nome: store.nome || ''
    };
  });

  return {
    ok: true,
    totalPlanilha: rows.length,
    validas: incoming.length,
    rejeitadas: normalized.rejected,
    duplicadasNaPlanilha: normalized.duplicateCount,
    novos: novos,
    alterados: alterados,
    semAlteracao: semAlteracao.length,
    ausentes: ausentes,
    stats: {
      novas: novos.length,
      alteradas: alterados.length,
      semAlteracao: semAlteracao.length,
      ausentes: ausentes.length,
      rejeitadas: normalized.rejected.length,
      duplicadas: normalized.duplicateCount
    }
  };
}

function importarBaseLojas(input) {
  requireAdmin_();

  var rows = input && Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new Error('Nenhuma linha válida foi recebida para importação.');

  var normalized = normalizeStoreImportRows_(rows);
  var validas = normalized.stores;
  if (!validas.length) {
    return {
      ok: false,
      totalRecebidas: rows.length,
      gravadas: 0,
      rejeitadas: normalized.rejected,
      duplicadasNaPlanilha: normalized.duplicateCount,
      inativadas: 0
    };
  }

  var lojasTable = table_('TABLE_LOJAS', 'bacio_lojas');
  var existing = getAllStoresForImport_();
  var incomingIds = {};
  validas.forEach(function (store) { incomingIds[String(store.id)] = true; });

  var tamanhoLote = 100;
  var gravadas = 0;

  for (var inicio = 0; inicio < validas.length; inicio += tamanhoLote) {
    var lote = validas.slice(inicio, inicio + tamanhoLote);
    var resultado = supabaseRequest_(
      '/rest/v1/' + lojasTable + '?on_conflict=id',
      'post',
      lote,
      'resolution=merge-duplicates,return=representation'
    );
    gravadas += Array.isArray(resultado) ? resultado.length : lote.length;
  }

  var inativadas = 0;
  if (input && input.deactivateMissing === true) {
    existing.forEach(function (store) {
      if (store.ativa !== false && !incomingIds[String(store.id)]) {
        supabaseRequest_(
          '/rest/v1/' + lojasTable + '?id=eq.' + encodeURIComponent(String(store.id)),
          'patch',
          { ativa: false, updated_at: new Date().toISOString() },
          'return=minimal'
        );
        inativadas++;
      }
    });
  }

  return {
    ok: true,
    totalRecebidas: rows.length,
    validas: validas.length,
    gravadas: gravadas,
    rejeitadas: normalized.rejected,
    duplicadasNaPlanilha: normalized.duplicateCount,
    inativadas: inativadas
  };
}

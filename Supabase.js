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

function requireAdmin_() {
  var auth = getCurrentAuthContext_();
  if (roleOf_(auth.user) !== 'admin') {
    throw new Error('Somente administradores podem realizar esta ação.');
  }
  return auth;
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
      return String(loja.regional_id || '') === String(user.regional_id || '');
    }
    if (role === 'consultor') {
      var consultorId = user.consultor_id || user.id;
      return String(loja.consultor_id || '') === String(consultorId || '');
    }
    if (role === 'loja') {
      return String(loja.id || '') === String(user.loja_id || user.lojaId || '');
    }
    return false;
  });
}

function getRealBootstrap_(email) {
  var auth = getCurrentAuthContext_();
  var user = auth.user;
  var role = roleOf_(user);

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');
  var notificacoesTable = table_('TABLE_NOTIFICACOES', 'bacio_notificacoes');

  var lojas = getVisibleStores_(user);
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });

  var demandas = safeSupabaseSelect_(
    '/rest/v1/' + demandasTable + '?select=*&ativa=eq.true&order=created_at.desc',
    []
  ).filter(function (d) {
    if (!demandaVisivelNoEscopo_(d, visibleLojaIds)) return false;
    if (role !== 'admin' && String(d.status || 'active').toLowerCase() === 'draft') return false;
    return true;
  });

  var respostas = safeSupabaseSelect_(
    '/rest/v1/' + respostasTable + '?select=*&order=created_at.desc&limit=5000',
    []
  ).filter(function (r) {
    return visibleLojaIds.indexOf(String(r.loja_id || r.lojaId || '')) >= 0;
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

  var tasks = buildTasks_(published, respostas, lojas, role, user);
  var campaigns = buildCampaigns_(published, tasks);
  var announcements = buildAnnouncements_(published);
  var managementItems = buildManagementItems_(demandas, respostas, lojas);

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
      pending: tasks.filter(function (t) { return t.status !== 'success'; }).length,
      dueToday: tasks.filter(function (t) { return t.isDueToday && t.status !== 'success'; }).length,
      campaigns: campaigns.length,
      unread: notifications.filter(function (n) { return !(n.lida || n.read); }).length
    },
    tasks: tasks,
    campaigns: campaigns,
    managementItems: managementItems,
    announcements: announcements,
    notifications: notifications.map(function (n) {
      return {
        id: n.id,
        title: n.titulo || n.title || 'Notificação',
        message: n.mensagem || n.message || '',
        read: Boolean(n.lida || n.read),
        createdAt: n.created_at || n.createdAt || ''
      };
    })
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

function demandaVisivelNoEscopo_(demanda, visibleLojaIds) {
  var targetIds = normalizeArray_(
    demanda.loja_ids || demanda.lojas_ids || demanda.target_loja_ids || demanda.lojas
  );
  if (!targetIds.length) return true;
  return targetIds.some(function (id) {
    return visibleLojaIds.indexOf(String(id)) >= 0;
  });
}

function getTargetStoreIds_(demanda, visibleLojaIds) {
  var targetIds = normalizeArray_(
    demanda.loja_ids || demanda.lojas_ids || demanda.target_loja_ids || demanda.lojas
  );
  if (!targetIds.length) return visibleLojaIds.slice();
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

function buildTasks_(demandas, respostas, lojas, role, user) {
  var now = new Date();
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });

  var tasks = demandas.map(function (d) {
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

    return {
      id: id,
      title: d.titulo || d.title || 'Demanda',
      description: d.descricao || d.description || '',
      deadline: isValidDeadline ? deadline.toISOString() : '',
      deadlineLabel: formatDeadline_(deadline),
      status: status,
      statusLabel: label,
      actionLabel: role === 'loja' ? (complete ? 'Ver resposta' : 'Responder') : 'Acompanhar',
      type: String(d.tipo || d.type || 'demanda'),
      isDueToday: Boolean(isDueToday),
      answeredCount: answered,
      totalStores: targetIds.length,
      timelineStatus: timeline.code,
      timelineLabel: timeline.label,
      timeline: timeline,
      cronograma: normalizeJsonObject_(d.cronograma)
    };
  });

  var score = { urgent: 4, warning: 3, neutral: 2, success: 1 };
  tasks.sort(function (a, b) {
    return (score[b.status] || 0) - (score[a.status] || 0);
  });

  return tasks;
}

function buildManagementItems_(demandas, respostas, lojas) {
  var visibleLojaIds = lojas.map(function (l) { return String(l.id); });
  return demandas.map(function (d) {
    var id = String(d.id);
    var targetIds = getTargetStoreIds_(d, visibleLojaIds);
    var latest = latestResponsesByStore_(id, respostas);
    var answered = targetIds.filter(function (lojaId) { return Boolean(latest[lojaId]); }).length;
    var progress = targetIds.length ? Math.round((answered / targetIds.length) * 100) : 0;
    var savedStatus = String(d.status || 'active').toLowerCase();
    var timeline = timelineInfo_(d, answered, targetIds.length, new Date());
    var status = savedStatus === 'draft' ? 'draft' : progress >= 100 && targetIds.length ? 'success' : 'active';

    return {
      id: id,
      title: d.titulo || d.title || 'Demanda',
      description: d.descricao || d.description || '',
      type: String(d.tipo || d.type || 'demanda').toLowerCase(),
      deadline: d.prazo_sla || '',
      deadlineLabel: formatDeadline_(d.prazo_sla ? new Date(d.prazo_sla) : null),
      progress: progress,
      progressLabel: targetIds.length
        ? answered + ' de ' + targetIds.length + ' lojas responderam'
        : 'Sem lojas vinculadas',
      status: status,
      publishStatus: savedStatus,
      owner: d.created_by || 'Operações',
      timelineStatus: timeline.code,
      timelineLabel: timeline.label,
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
        title: d.titulo || d.title || 'Comunicado',
        excerpt: d.descricao || d.description || '',
        kind: kind,
        kindLabel: label,
        dateLabel: formatShortDate_(d.created_at || d.createdAt)
      };
    });
}

function getContextLabel_(role, user, loja, lojas) {
  if (role === 'loja' && loja) {
    return (loja.codigo ? loja.codigo + ' · ' : '') + (loja.nome || loja.cidade || 'Loja');
  }
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

function saveDemand(input) {
  if (!input) throw new Error('Dados da campanha não informados.');
  var auth = validateAdminStoreTargets_(input.lojaIds || []);

  var titulo = String(input.title || '').trim();
  var descricao = String(input.description || '').trim();
  var tipo = String(input.type || 'demanda').trim().toLowerCase();
  var publishStatus = String(input.publishStatus || 'draft').trim().toLowerCase();

  if (!titulo) throw new Error('Informe um título.');
  if (['campanha', 'demanda', 'comunicado'].indexOf(tipo) < 0) tipo = 'demanda';
  if (['draft', 'active', 'closed'].indexOf(publishStatus) < 0) publishStatus = 'draft';

  var modelFields = Array.isArray(input.modelFields) ? input.modelFields : [];
  modelFields = modelFields.map(function (f, index) {
    return {
      id: f.id || 'field-' + index,
      label: String(f.label || '').trim(),
      type: String(f.type || 'text'),
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map(String) : [],
      sourceColumn: f.sourceColumn == null ? null : Number(f.sourceColumn),
      originalLabel: f.originalLabel || null
    };
  }).filter(function (f) { return Boolean(f.label); });

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
    }
  }

  var incomingCronograma = normalizeJsonObject_(input.cronograma);
  var cronograma = {};
  Object.keys(existingCronograma).forEach(function (key) { cronograma[key] = existingCronograma[key]; });
  Object.keys(incomingCronograma).forEach(function (key) { cronograma[key] = incomingCronograma[key]; });

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
    model_source: input.modelSource || 'manual',
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

  return { ok: true, row: result && result[0] ? result[0] : null };
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
  var payload = {
    status: status,
    updated_at: new Date().toISOString()
  };

  if (status === 'active' && !row.publicada_em) {
    payload.publicada_em = new Date().toISOString();
  }
  if (status === 'closed' && !row.encerramento_em) {
    payload.encerramento_em = new Date().toISOString();
  }
  if (status !== 'closed' && row.encerramento_em) {
    payload.encerramento_em = null;
  }

  var result = supabaseRequest_(
    '/rest/v1/' + demandasTable + '?id=eq.' + encodeURIComponent(String(demandaId)),
    'patch',
    payload,
    'return=representation'
  );

  return { ok: true, row: result && result[0] ? result[0] : null };
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

function getDemandDetail(demandaId) {
  if (!demandaId) throw new Error('Campanha/demanda não informada.');

  var auth = getCurrentAuthContext_();
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

  if (!demandaVisivelNoEscopo_(demanda, visibleLojaIds)) {
    throw new Error('Você não tem acesso a esta campanha/demanda.');
  }
  if (role !== 'admin' && String(demanda.status || 'active').toLowerCase() === 'draft') {
    throw new Error('Este item ainda está em rascunho.');
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
    importMeta: demanda.import_meta || null,
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
      userEmail: myResponse.usuario_email || ''
    } : null,
    role: role
  };
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

  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');
  var payload = {
    demanda_id: String(input.demandaId),
    loja_id: lojaId,
    usuario_email: auth.email,
    status: input.status || 'respondido',
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

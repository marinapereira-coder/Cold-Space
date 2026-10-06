/**
 * BACIO CONECTA V2 — FUNCIONALIDADES COMPLEMENTARES
 *
 * Este arquivo trabalha JUNTO com:
 * - Code.gs V2
 * - Supabase.gs atual
 *
 * Não coloque chaves secretas no HTML.
 * Toda autenticação administrativa do Supabase Auth acontece aqui, no servidor.
 */

/* ======================================================================
 * ENTRADA / AUTENTICAÇÃO HÍBRIDA
 * ====================================================================== */

function getEntryBootstrap(portalMode) {
  var mode = String(portalMode || 'escritorio').trim().toLowerCase();

  if (mode === 'loja') {
    return {
      authenticated: false,
      mode: 'store'
    };
  }

  return {
    authenticated: true,
    mode: 'corporate',
    bootstrap: getBootstrapData()
  };
}


function storeLogin(email, password) {
  email = String(email || '').trim().toLowerCase();
  password = String(password || '');

  if (!email || !password) {
    throw new Error('Informe o e-mail e a senha.');
  }

  var session = supabaseAuthRequestV2_(
    '/auth/v1/token?grant_type=password',
    'post',
    {
      email: email,
      password: password
    }
  );

  if (!session || !session.access_token) {
    throw new Error('Não foi possível iniciar a sessão da loja.');
  }

  var bootstrap = getStoreBootstrap(session.access_token);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token || '',
    expiresIn: session.expires_in || 0,
    bootstrap: bootstrap
  };
}


function storeRefreshSession(refreshToken) {
  refreshToken = String(refreshToken || '').trim();

  if (!refreshToken) {
    throw new Error('Sessão expirada. Entre novamente.');
  }

  var session = supabaseAuthRequestV2_(
    '/auth/v1/token?grant_type=refresh_token',
    'post',
    {
      refresh_token: refreshToken
    }
  );

  if (!session || !session.access_token) {
    throw new Error('Não foi possível renovar a sessão.');
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token || refreshToken,
    expiresIn: session.expires_in || 0,
    bootstrap: getStoreBootstrap(session.access_token)
  };
}


function storeChangePassword(accessToken, newPassword) {
  newPassword = String(newPassword || '');

  if (newPassword.length < 8) {
    throw new Error('A nova senha deve ter pelo menos 8 caracteres.');
  }

  var ctx = getStoreAuthContext_(accessToken);

  supabaseAuthRequestV2_(
    '/auth/v1/user',
    'put',
    {
      password: newPassword
    },
    accessToken
  );

  var usuariosTable = table_('TABLE_USUARIOS', 'bacio_usuarios');

  supabaseRequest_(
    '/rest/v1/' + usuariosTable +
      '?id=eq.' + encodeURIComponent(String(ctx.user.id)),
    'patch',
    {
      force_password_change: false,
      updated_at: new Date().toISOString()
    },
    'return=minimal'
  );

  return { ok: true };
}


function getStoreBootstrap(accessToken) {
  var ctx = getStoreAuthContext_(accessToken);
  return buildStoreBootstrapV2_(ctx);
}


function getStoreAuthContext_(accessToken) {
  accessToken = String(accessToken || '').trim();

  if (!accessToken) {
    throw new Error('Sessão da loja não encontrada. Entre novamente.');
  }

  var authUser = supabaseAuthRequestV2_(
    '/auth/v1/user',
    'get',
    null,
    accessToken
  );

  if (!authUser || !authUser.id || !authUser.email) {
    throw new Error('Sessão da loja inválida. Entre novamente.');
  }

  var email = String(authUser.email || '').trim().toLowerCase();
  var usuariosTable = table_('TABLE_USUARIOS', 'bacio_usuarios');

  var rows = safeSupabaseSelect_(
    '/rest/v1/' + usuariosTable +
      '?select=*&auth_user_id=eq.' + encodeURIComponent(String(authUser.id)) +
      '&limit=1',
    []
  );

  if (!rows.length) {
    rows = safeSupabaseSelect_(
      '/rest/v1/' + usuariosTable +
        '?select=*&email=eq.' + encodeURIComponent(email) +
        '&limit=1',
      []
    );
  }

  if (!rows.length) {
    throw new Error('Este login ainda não está vinculado a uma loja no Bacio Conecta.');
  }

  var user = rows[0];

  if (user.ativo === false) {
    throw new Error('Este acesso está desativado.');
  }

  if (roleOf_(user) !== 'loja') {
    throw new Error('Este login não está configurado como acesso de loja.');
  }

  if (!user.loja_id) {
    throw new Error('Este login não possui uma loja vinculada.');
  }

  if (!user.auth_user_id) {
    supabaseRequest_(
      '/rest/v1/' + usuariosTable +
        '?id=eq.' + encodeURIComponent(String(user.id)),
      'patch',
      {
        auth_user_id: String(authUser.id),
        auth_provider: 'password',
        updated_at: new Date().toISOString()
      },
      'return=minimal'
    );

    user.auth_user_id = String(authUser.id);
    user.auth_provider = 'password';
  }

  return {
    email: email,
    user: user,
    authUser: authUser,
    accessToken: accessToken
  };
}


function supabaseAuthRequestV2_(path, method, payload, bearerToken) {
  var baseUrl = prop_('SUPABASE_URL', '').replace(/\/$/, '');
  var secretKey =
    prop_('SUPABASE_SECRET_KEY', '') ||
    prop_('SUPABASE_SERVICE_ROLE_KEY', '');

  if (!baseUrl || !secretKey) {
    throw new Error('Supabase não configurado nas Propriedades do script.');
  }

  var headers = {
    apikey: secretKey,
    Authorization: 'Bearer ' + (bearerToken || secretKey),
    'Content-Type': 'application/json'
  };

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
    var message = authErrorMessageV2_(code, text);
    throw new Error(message);
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}


function authErrorMessageV2_(code, text) {
  var msg = '';

  try {
    var parsed = JSON.parse(text || '{}');
    msg = parsed.msg || parsed.message || parsed.error_description || parsed.error || '';
  } catch (e) {
    msg = String(text || '');
  }

  var lower = String(msg || '').toLowerCase();

  if (
    code === 400 &&
    (
      lower.indexOf('invalid login') >= 0 ||
      lower.indexOf('invalid credentials') >= 0
    )
  ) {
    return 'E-mail ou senha inválidos.';
  }

  if (lower.indexOf('email not confirmed') >= 0) {
    return 'Este e-mail ainda não foi confirmado.';
  }

  if (code === 401) {
    return 'Sessão inválida ou expirada. Entre novamente.';
  }

  return 'Supabase Auth (' + code + '): ' + (msg || 'falha na autenticação');
}


function buildStoreBootstrapV2_(ctx) {
  var user = ctx.user;
  var email = ctx.email;

  var demandasTable = table_('TABLE_DEMANDAS', 'bacio_demandas');
  var respostasTable = table_('TABLE_RESPOSTAS', 'bacio_demanda_respostas');
  var notificacoesTable = table_('TABLE_NOTIFICACOES', 'bacio_notificacoes');

  var lojas = getVisibleStores_(user);

  var visibleLojaIds = lojas.map(function (l) {
    return String(l.id);
  });

  if (!visibleLojaIds.length) {
    throw new Error(
      'A loja vinculada a este acesso não está ativa ou não foi encontrada.'
    );
  }

  var demandas = safeSupabaseSelect_(
    '/rest/v1/' +
      demandasTable +
      '?select=*&ativa=eq.true&order=created_at.desc',
    []
  ).filter(function (d) {

    if (!demandaVisivelNoEscopo_(d, visibleLojaIds)) {
      return false;
    }

    return (
      String(d.status || 'active').toLowerCase() !==
      'draft'
    );

  });

  var respostas = safeSupabaseSelect_(
    '/rest/v1/' +
      respostasTable +
      '?select=*&order=created_at.desc&limit=5000',
    []
  ).filter(function (r) {

    return (
      visibleLojaIds.indexOf(
        String(r.loja_id || '')
      ) >= 0
    );

  });

  var notifications = safeSupabaseSelect_(
    '/rest/v1/' +
      notificacoesTable +
      '?select=*&usuario_email=eq.' +
      encodeURIComponent(email) +
      '&order=created_at.desc&limit=50',
    []
  );

  var tasks =
    buildTasks_(
      demandas,
      respostas,
      lojas,
      'loja',
      user
    );

  var campaigns =
    buildCampaigns_(
      demandas,
      tasks
    );

  var announcements =
    buildAnnouncements_(
      demandas
    );

  var managementItems =
    buildManagementItems_(
      demandas,
      respostas,
      lojas
    );

  var currentLoja =
    lojas[0] ||
    null;

  var city =
    currentLoja
      ? (
          currentLoja.cidade ||
          currentLoja.nome ||
          ''
        )
      : '';

  return {
    mode: 'live',
    authMode: 'store',
    generatedAt: new Date().toISOString(),

    user: {
      id: user.id,

      nome:
        user.nome ||
        v2NiceNameFromEmail_(email),

      email: email,

      role: 'loja',

      lojaId:
        user.loja_id ||
        null,

      regionalId:
        user.regional_id ||
        null,

      consultorId:
        user.consultor_id ||
        null,

      forcePasswordChange:
        user.force_password_change === true,

      contexto:
        currentLoja
          ? (
              (
                currentLoja.codigo
                  ? currentLoja.codigo + ' · '
                  : ''
              ) +
              currentLoja.nome
            )
          : 'Loja'
    },

    stores:
      lojas.map(
        mapStoreV2_
      ),

    weather: {
      city: city,
      temp: '',
      condition: ''
    },

    summary: {
      pending:
        tasks.filter(
          function (t) {
            return t.status !== 'success';
          }
        ).length,

      dueToday:
        tasks.filter(
          function (t) {
            return (
              t.isDueToday &&
              t.status !== 'success'
            );
          }
        ).length,

      campaigns:
        campaigns.length,

      unread:
        notifications.filter(
          function (n) {
            return !(
              n.lida ||
              n.read
            );
          }
        ).length
    },

    tasks: tasks,

    campaigns: campaigns,

    managementItems:
      managementItems,

    announcements:
      announcements,

    notifications:
      notifications.map(
        function (n) {

          return {
            id: n.id,

            title:
              n.titulo ||
              n.title ||
              'Notificação',

            message:
              n.mensagem ||
              n.message ||
              '',

            read:
              Boolean(
                n.lida ||
                n.read
              ),

            createdAt:
              n.created_at ||
              n.createdAt ||
              ''
          };

        }
      )
  };
}


function mapStoreV2_(l) {
  var extras =
    parseJsonObject_(
      l.dados_extras
    );

  return {
    id: String(l.id),

    codigo:
      l.codigo ||
      '',

    nome:
      l.nome ||
      '',

    email:
      l.email ||
      '',

    cidade:
      l.cidade ||
      '',

    regionalId:
      l.regional_id ||
      null,

    consultorId:
      l.consultor_id ||
      null,

    regional:
      extras.regional ||
      '',

    consultor:
      extras.consultor ||
      '',

    estado:
      extras.estado ||
      '',

    formato:
      extras.formato ||
      '',

    delivery:
      extras.delivery ||
      '',

    endereco:
      extras.endereco ||
      ''
  };
}


function v2NiceNameFromEmail_(email) {
  var base =
    String(email || '')
      .split('@')[0] ||
    'Loja';

  return base
    .replace(
      /[._-]+/g,
      ' '
    )
    .split(' ')
    .filter(Boolean)
    .map(
      function (part) {

        return (
          part.charAt(0).toUpperCase() +
          part.slice(1).toLowerCase()
        );

      }
    )
    .join(' ');
}


/* ======================================================================
 * DETALHES E RESPOSTAS — PORTAL DA LOJA
 * ====================================================================== */

function getStoreDemandDetail(
  accessToken,
  demandaId
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  return getDemandDetailForStoreV2_(
    ctx,
    demandaId
  );
}


function getDemandDetailForStoreV2_(
  ctx,
  demandaId
) {

  if (!demandaId) {

    throw new Error(
      'Campanha/demanda não informada.'
    );

  }

  var user =
    ctx.user;

  var lojas =
    getVisibleStores_(
      user
    );

  var visibleLojaIds =
    lojas.map(
      function (l) {
        return String(l.id);
      }
    );

  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );

  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );

  var rows =
    supabaseRequest_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&id=eq.' +
        encodeURIComponent(
          String(demandaId)
        ) +
        '&ativa=eq.true&limit=1',
      'get'
    ) || [];

  if (!rows.length) {

    throw new Error(
      'Campanha/demanda não encontrada.'
    );

  }

  var demanda =
    rows[0];

  if (
    !demandaVisivelNoEscopo_(
      demanda,
      visibleLojaIds
    )
  ) {

    throw new Error(
      'Esta campanha/demanda não está disponível para sua loja.'
    );

  }

  if (
    String(
      demanda.status ||
      'active'
    )
    .toLowerCase() ===
    'draft'
  ) {

    throw new Error(
      'Este item ainda está em rascunho.'
    );

  }

  var targetIds =
    getTargetStoreIds_(
      demanda,
      visibleLojaIds
    );

  var targetStores =
    lojas.filter(
      function (l) {

        return (
          targetIds.indexOf(
            String(l.id)
          ) >= 0
        );

      }
    );

  var respostas =
    supabaseRequest_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&demanda_id=eq.' +
        encodeURIComponent(
          String(demandaId)
        ) +
        '&order=created_at.desc',
      'get'
    ) || [];

  respostas =
    respostas.filter(
      function (r) {

        return (
          targetIds.indexOf(
            String(
              r.loja_id ||
              ''
            )
          ) >= 0
        );

      }
    );

  var latest =
    latestResponsesByStore_(
      demandaId,
      respostas
    );

  var lojaId =
    String(
      user.loja_id ||
      ''
    );

  var myResponse =
    latest[lojaId] ||
    null;

  var answered =
    myResponse
      ? 1
      : 0;

  var total =
    targetStores.length;

  return {
    id:
      String(
        demanda.id
      ),

    title:
      demanda.titulo ||
      '',

    description:
      demanda.descricao ||
      '',

    type:
      String(
        demanda.tipo ||
        'demanda'
      )
      .toLowerCase(),

    inicioEm:
      demanda.inicio_em ||
      '',

    publicadaEm:
      demanda.publicada_em ||
      '',

    deadline:
      demanda.prazo_sla ||
      '',

    deadlineLabel:
      formatDeadline_(
        demanda.prazo_sla
          ? new Date(
              demanda.prazo_sla
            )
          : null
      ),

    encerramentoEm:
      demanda.encerramento_em ||
      '',

    publishStatus:
      String(
        demanda.status ||
        'active'
      )
      .toLowerCase(),

    cronograma:
      normalizeJsonObject_(
        demanda.cronograma
      ),

    timeline:
      timelineInfo_(
        demanda,
        answered,
        total,
        new Date()
      ),

    responseRequired:
      demanda.resposta_obrigatoria !==
      false,

    modelSource:
      demanda.model_source ||
      'manual',

    modelFields:
      normalizeObjectArray_(
        demanda.model_fields
      ),

    importMeta:
      demanda.import_meta ||
      null,

    lojaIds:
      normalizeArray_(
        demanda.loja_ids
      ),

    totalStores:
      total,

    answeredCount:
      answered,

    pendingCount:
      myResponse
        ? 0
        : total,

    progress:
      myResponse
        ? 100
        : 0,

    stores:
      targetStores.map(
        function (loja) {

          return {
            id:
              String(
                loja.id
              ),

            codigo:
              loja.codigo ||
              '',

            nome:
              loja.nome ||
              '',

            cidade:
              loja.cidade ||
              '',

            responded:
              Boolean(
                myResponse
              ),

            responseId:
              myResponse
                ? myResponse.id
                : null,

            respondedAt:
              myResponse
                ? myResponse.created_at
                : null,

            respondedBy:
              myResponse
                ? myResponse.usuario_email
                : null,

            status:
              myResponse
                ? (
                    myResponse.status ||
                    'respondido'
                  )
                : 'pendente'
          };

        }
      ),

    myResponse:
      myResponse
        ? {
            id:
              myResponse.id,

            status:
              myResponse.status ||
              'respondido',

            answers:
              normalizeJsonObject_(
                myResponse.resposta_json
              ),

            observacao:
              myResponse.observacao ||
              '',

            createdAt:
              myResponse.created_at ||
              '',

            userEmail:
              myResponse.usuario_email ||
              ''
          }
        : null,

    role:
      'loja'
  };
}


function submitStoreDemandResponse(
  accessToken,
  input
) {

  input =
    input ||
    {};

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  var user =
    ctx.user;

  if (!input.demandaId) {

    throw new Error(
      'Demanda não informada.'
    );

  }

  var lojaId =
    String(
      user.loja_id ||
      ''
    );

  var detail =
    getDemandDetailForStoreV2_(
      ctx,
      input.demandaId
    );

  if (
    !detail.stores.some(
      function (s) {

        return (
          String(s.id) ===
          lojaId
        );

      }
    )
  ) {

    throw new Error(
      'Sua loja não faz parte desta campanha/demanda.'
    );

  }

  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );

  var payload = {
    demanda_id:
      String(
        input.demandaId
      ),

    loja_id:
      lojaId,

    usuario_email:
      ctx.email,

    status:
      'respondido',

    resposta_json:
      input.answers ||
      {},

    observacao:
      input.observacao ||
      '',

    created_at:
      new Date()
      .toISOString()
  };

  var inserted =
    supabaseRequest_(
      '/rest/v1/' +
        respostasTable,
      'post',
      payload,
      'return=representation'
    );

  notifyManagementV2_(
    'Nova resposta recebida',

    (
      detail.title ||
      'Demanda'
    ) +
    ' · ' +
    storeLabelByIdV2_(
      lojaId
    ),

    lojaId
  );

  return {
    ok: true,

    row:
      inserted &&
      inserted[0]
        ? inserted[0]
        : null
  };
}


/* ======================================================================
 * RESPOSTAS / AVALIAÇÃO DA ENTREGA
 * ====================================================================== */

function getResponsesWorkspace() {
  var auth =
    getCurrentAuthContext_();

  var user =
    auth.user;

  if (
    roleOf_(user) ===
    'loja'
  ) {

    throw new Error(
      'Esta área é destinada aos perfis de gestão.'
    );

  }

  return buildResponsesWorkspaceV2_(
    user
  );
}


function buildResponsesWorkspaceV2_(
  user
) {

  var visibleStores =
    getVisibleStores_(
      user
    );

  var visibleIds = {};
  var storeMap = {};

  visibleStores.forEach(
    function (s) {

      var id =
        String(s.id);

      visibleIds[id] =
        true;

      storeMap[id] =
        s;

    }
  );

  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );

  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );

  var avaliacoesTable =
    'bacio_avaliacoes';

  var respostas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&order=created_at.desc&limit=10000',
      []
    )
    .filter(
      function (r) {

        return Boolean(
          visibleIds[
            String(
              r.loja_id ||
              ''
            )
          ]
        );

      }
    );

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&order=created_at.desc&limit=3000',
      []
    );

  var avaliacoes =
    safeSupabaseSelect_(
      '/rest/v1/' +
        avaliacoesTable +
        '?select=*&order=updated_at.desc&limit=10000',
      []
    );

  var demandMap = {};

  demandas.forEach(
    function (d) {

      demandMap[
        String(d.id)
      ] = d;

    }
  );

  var evaluationMap = {};

  avaliacoes.forEach(
    function (a) {

      evaluationMap[
        String(
          a.demanda_id
        ) +
        '|' +
        String(
          a.loja_id
        )
      ] = a;

    }
  );

  var latest = {};

  respostas.forEach(
    function (r) {

      var key =
        String(
          r.demanda_id ||
          ''
        ) +
        '|' +
        String(
          r.loja_id ||
          ''
        );

      if (!latest[key]) {
        latest[key] = r;
      }

    }
  );

  var items =
    Object.keys(
      latest
    )
    .map(
      function (key) {

        var r =
          latest[key];

        var d =
          demandMap[
            String(
              r.demanda_id
            )
          ] || {};

        var store =
          storeMap[
            String(
              r.loja_id
            )
          ] || {};

        var evaluation =
          evaluationMap[key] ||
          null;

        return {
          responseId:
            String(
              r.id
            ),

          demandaId:
            String(
              r.demanda_id ||
              ''
            ),

          demandaTitle:
            d.titulo ||
            'Demanda',

          demandaType:
            d.tipo ||
            'demanda',

          storeId:
            String(
              r.loja_id ||
              ''
            ),

          storeName:
            store.nome ||
            '',

          storeLabel:
            storeLabelV2_(
              store
            ),

          userEmail:
            r.usuario_email ||
            '',

          status:
            evaluation
              ? String(
                  evaluation.status ||
                  'respondido'
                )
              : String(
                  r.status ||
                  'respondido'
                ),

          answers:
            normalizeJsonObject_(
              r.resposta_json
            ),

          observacao:
            r.observacao ||
            '',

          createdAt:
            r.created_at ||
            '',

          deadline:
            d.prazo_sla ||
            '',

          modelFields:
            normalizeObjectArray_(
              d.model_fields
            ),

          evaluation:
            evaluation
              ? mapEvaluationRowV2_(
                  evaluation,
                  d,
                  store
                )
              : null
        };

      }
    );

  items.sort(
    function (a, b) {

      return String(
        b.createdAt ||
        ''
      )
      .localeCompare(
        String(
          a.createdAt ||
          ''
        )
      );

    }
  );

  return {
    items:
      items,

    stats: {
      total:
        items.length,

      aprovadas:
        items.filter(
          function (i) {
            return (
              i.status ===
              'aprovada'
            );
          }
        ).length,

      aguardando:
        items.filter(
          function (i) {
            return (
              i.status ===
              'respondido'
            );
          }
        ).length,

      ajuste:
        items.filter(
          function (i) {
            return (
              i.status ===
              'ajuste_necessario'
            );
          }
        ).length,

      reprovadas:
        items.filter(
          function (i) {
            return (
              i.status ===
              'reprovada'
            );
          }
        ).length
    }
  };
}


function evaluateDemandDelivery(
  input
) {

  input =
    input ||
    {};

  var auth =
    getCurrentAuthContext_();

  var user =
    auth.user;

  if (
    roleOf_(user) ===
    'loja'
  ) {

    throw new Error(
      'Lojas não podem avaliar entregas.'
    );

  }

  var responseId =
    String(
      input.responseId ||
      ''
    )
    .trim();

  var demandaId =
    String(
      input.demandaId ||
      ''
    )
    .trim();

  var lojaId =
    String(
      input.lojaId ||
      ''
    )
    .trim();

  var status =
    String(
      input.status ||
      ''
    )
    .trim()
    .toLowerCase();

  var stars =
    Number(
      input.stars ||
      0
    );

  var comment =
    String(
      input.comment ||
      ''
    )
    .trim();

  if (
    !responseId ||
    !demandaId ||
    !lojaId
  ) {

    throw new Error(
      'Resposta, demanda ou loja não informada.'
    );

  }

  if (
    [
      'aprovada',
      'ajuste_necessario',
      'reprovada'
    ]
    .indexOf(
      status
    ) < 0
  ) {

    throw new Error(
      'Selecione um resultado válido.'
    );

  }

  if (
    stars < 1 ||
    stars > 5 ||
    Math.floor(stars) !==
    stars
  ) {

    throw new Error(
      'A nota deve ser de 1 a 5 estrelas.'
    );

  }

  var visibleIds =
    getVisibleStores_(
      user
    )
    .map(
      function (s) {
        return String(s.id);
      }
    );

  if (
    visibleIds.indexOf(
      lojaId
    ) < 0
  ) {

    throw new Error(
      'Você não tem acesso a esta loja.'
    );

  }

  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );

  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );

  var responseRows =
    supabaseRequest_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&id=eq.' +
        encodeURIComponent(
          responseId
        ) +
        '&limit=1',
      'get'
    ) || [];

  if (!responseRows.length) {

    throw new Error(
      'Resposta não encontrada.'
    );

  }

  var response =
    responseRows[0];

  if (
    String(
      response.demanda_id
    ) !==
    demandaId ||
    String(
      response.loja_id
    ) !==
    lojaId
  ) {

    throw new Error(
      'A resposta não corresponde à demanda/loja informada.'
    );

  }

  var demandRows =
    supabaseRequest_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&id=eq.' +
        encodeURIComponent(
          demandaId
        ) +
        '&limit=1',
      'get'
    ) || [];

  if (!demandRows.length) {

    throw new Error(
      'Demanda não encontrada.'
    );

  }

  var demand =
    demandRows[0];

  var allResponses =
    supabaseRequest_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&demanda_id=eq.' +
        encodeURIComponent(
          demandaId
        ) +
        '&loja_id=eq.' +
        encodeURIComponent(
          lojaId
        ) +
        '&order=created_at.asc',
      'get'
    ) || [];

  var firstDeliveryRaw =
    allResponses.length
      ? allResponses[0].created_at
      : response.created_at;

  var firstDelivery =
    firstDeliveryRaw
      ? new Date(
          firstDeliveryRaw
        )
      : null;

  var deadline =
    demand.prazo_sla
      ? new Date(
          demand.prazo_sla
        )
      : null;

  var slaMet =
    null;

  if (
    firstDelivery &&
    !isNaN(
      firstDelivery.getTime()
    ) &&
    deadline &&
    !isNaN(
      deadline.getTime()
    )
  ) {

    slaMet =
      firstDelivery.getTime() <=
      deadline.getTime();

  }

  var now =
    new Date()
    .toISOString();

  var payload = {
    resposta_id:
      responseId,

    demanda_id:
      demandaId,

    loja_id:
      lojaId,

    status:
      status,

    estrelas:
      stars,

    sla_cumprido:
      slaMet,

    primeira_entrega_em:
      firstDeliveryRaw ||
      response.created_at ||
      now,

    prazo_sla:
      demand.prazo_sla ||
      null,

    comentario:
      comment ||
      null,

    avaliador_email:
      auth.email,

    avaliador_nome:
      user.nome ||
      v2NiceNameFromEmail_(
        auth.email
      ),

    updated_at:
      now
  };

  var saved =
    supabaseRequest_(
      '/rest/v1/bacio_avaliacoes?on_conflict=demanda_id,loja_id',
      'post',
      payload,
      'resolution=merge-duplicates,return=representation'
    );

  supabaseRequest_(
    '/rest/v1/' +
      respostasTable +
      '?id=eq.' +
      encodeURIComponent(
        responseId
      ),
    'patch',
    {
      status:
        status
    },
    'return=minimal'
  );

  notifyStoreUsersV2_(
    lojaId,

    evaluationTitleV2_(
      status
    ),

    evaluationMessageV2_(
      demand.titulo ||
      'Demanda',

      status,

      stars,

      comment,

      slaMet
    )
  );

  return {
    ok:
      true,

    slaCumprido:
      slaMet,

    evaluation:
      saved &&
      saved[0]
        ? saved[0]
        : payload
  };
}


function getEvaluationWorkspace() {
  var auth =
    getCurrentAuthContext_();

  var user =
    auth.user;

  return buildEvaluationWorkspaceV2_(
    user
  );
}


function getStoreEvaluationWorkspace(
  accessToken
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  return buildEvaluationWorkspaceV2_(
    ctx.user
  );
}


function buildEvaluationWorkspaceV2_(
  user
) {

  var visibleStores =
    getVisibleStores_(
      user
    );

  var visibleIds = {};
  var storeMap = {};

  visibleStores.forEach(
    function (s) {

      visibleIds[
        String(
          s.id
        )
      ] = true;

      storeMap[
        String(
          s.id
        )
      ] = s;

    }
  );

  var evals =
    safeSupabaseSelect_(
      '/rest/v1/bacio_avaliacoes?select=*&order=updated_at.desc&limit=10000',
      []
    )
    .filter(
      function (a) {

        return Boolean(
          visibleIds[
            String(
              a.loja_id ||
              ''
            )
          ]
        );

      }
    );

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_DEMANDAS',
          'bacio_demandas'
        ) +
        '?select=id,titulo&limit=5000',
      []
    );

  var demandMap = {};

  demandas.forEach(
    function (d) {

      demandMap[
        String(
          d.id
        )
      ] = d;

    }
  );

  var items =
    evals.map(
      function (a) {

        return mapEvaluationRowV2_(
          a,

          demandMap[
            String(
              a.demanda_id
            )
          ] || {},

          storeMap[
            String(
              a.loja_id
            )
          ] || {}
        );

      }
    );

  var grouped = {};

  visibleStores.forEach(
    function (s) {

      grouped[
        String(
          s.id
        )
      ] = [];

    }
  );

  items.forEach(
    function (i) {

      if (
        !grouped[
          i.storeId
        ]
      ) {

        grouped[
          i.storeId
        ] = [];

      }

      grouped[
        i.storeId
      ]
      .push(i);

    }
  );

  var stores =
    Object.keys(
      grouped
    )
    .map(
      function (storeId) {

        var list =
          grouped[
            storeId
          ];

        if (!list.length) {
          return null;
        }

        var store =
          storeMap[
            storeId
          ] || {};

        var starTotal =
          list.reduce(
            function (
              sum,
              i
            ) {

              return (
                sum +
                Number(
                  i.stars ||
                  0
                )
              );

            },
            0
          );

        var slaKnown =
          list.filter(
            function (i) {

              return (
                i.slaMet === true ||
                i.slaMet === false
              );

            }
          );

        var slaOk =
          slaKnown.filter(
            function (i) {

              return (
                i.slaMet ===
                true
              );

            }
          ).length;

        return {
          storeId:
            storeId,

          storeLabel:
            storeLabelV2_(
              store
            ),

          total:
            list.length,

          avgStars:
            roundOneV2_(
              starTotal /
              list.length
            ),

          slaRate:
            slaKnown.length
              ? Math.round(
                  (
                    slaOk /
                    slaKnown.length
                  ) *
                  100
                )
              : null,

          approved:
            list.filter(
              function (i) {

                return (
                  i.status ===
                  'aprovada'
                );

              }
            ).length,

          adjustment:
            list.filter(
              function (i) {

                return (
                  i.status ===
                  'ajuste_necessario'
                );

              }
            ).length,

          rejected:
            list.filter(
              function (i) {

                return (
                  i.status ===
                  'reprovada'
                );

              }
            ).length
        };

      }
    )
    .filter(Boolean)
    .sort(
      function (a, b) {

        return a.storeLabel
          .localeCompare(
            b.storeLabel
          );

      }
    );

  var totalStars =
    items.reduce(
      function (
        sum,
        i
      ) {

        return (
          sum +
          Number(
            i.stars ||
            0
          )
        );

      },
      0
    );

  var slaItems =
    items.filter(
      function (i) {

        return (
          i.slaMet === true ||
          i.slaMet === false
        );

      }
    );

  var slaOkAll =
    slaItems.filter(
      function (i) {

        return (
          i.slaMet ===
          true
        );

      }
    ).length;

  return {
    items:
      items,

    stores:
      stores,

    summary: {
      total:
        items.length,

      avgStars:
        items.length
          ? roundOneV2_(
              totalStars /
              items.length
            )
          : 0,

      slaRate:
        slaItems.length
          ? Math.round(
              (
                slaOkAll /
                slaItems.length
              ) *
              100
            )
          : null,

      approved:
        items.filter(
          function (i) {

            return (
              i.status ===
              'aprovada'
            );

          }
        ).length
    }
  };
}


function mapEvaluationRowV2_(
  a,
  demand,
  store
) {

  return {
    id:
      String(
        a.id ||
        ''
      ),

    responseId:
      String(
        a.resposta_id ||
        ''
      ),

    demandId:
      String(
        a.demanda_id ||
        ''
      ),

    demandTitle:
      demand.titulo ||
      'Demanda',

    storeId:
      String(
        a.loja_id ||
        ''
      ),

    storeLabel:
      storeLabelV2_(
        store
      ),

    stars:
      Number(
        a.estrelas ||
        0
      ),

    slaMet:
      a.sla_cumprido === null ||
      a.sla_cumprido === undefined
        ? null
        : Boolean(
            a.sla_cumprido
          ),

    firstDeliveryAt:
      a.primeira_entrega_em ||
      '',

    deadline:
      a.prazo_sla ||
      '',

    status:
      a.status ||
      'aprovada',

    comment:
      a.comentario ||
      '',

    evaluatorEmail:
      a.avaliador_email ||
      '',

    evaluatorName:
      a.avaliador_nome ||
      '',

    evaluatedAt:
      a.updated_at ||
      a.created_at ||
      ''
  };
}


function evaluationTitleV2_(
  status
) {

  if (
    status ===
    'aprovada'
  ) {

    return (
      'Entrega aprovada'
    );

  }

  if (
    status ===
    'ajuste_necessario'
  ) {

    return (
      'Ajuste solicitado'
    );

  }

  return (
    'Entrega reprovada'
  );
}


function evaluationMessageV2_(
  title,
  status,
  stars,
  comment,
  slaMet
) {

  var result =
    status ===
    'aprovada'

      ? 'Sua entrega foi aprovada.'

      : status ===
        'ajuste_necessario'

        ? 'O escritório solicitou um ajuste na sua entrega.'

        : 'Sua entrega foi reprovada e precisa de revisão.';

  var slaText =
    slaMet === true

      ? ' SLA cumprido.'

      : slaMet === false

        ? ' SLA não cumprido.'

        : '';

  var commentText =
    comment
      ? (
          ' Comentário: ' +
          comment
        )
      : '';

  return (
    String(
      title ||
      'Demanda'
    ) +
    ' · ' +
    result +
    ' Nota: ' +
    stars +
    '/5.' +
    slaText +
    commentText
  );
}


function roundOneV2_(
  value
) {

  return (
    Math.round(
      Number(
        value ||
        0
      ) *
      10
    ) /
    10
  );
}


/* ======================================================================
 * CALENDÁRIO
 * ====================================================================== */

function getCalendarWorkspace() {
  var auth =
    getCurrentAuthContext_();

  return buildCalendarWorkspaceV2_(
    auth.user
  );
}


function getStoreCalendarWorkspace(
  accessToken
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  return buildCalendarWorkspaceV2_(
    ctx.user
  );
}


function buildCalendarWorkspaceV2_(
  user
) {

  var role =
    roleOf_(
      user
    );

  var stores =
    getVisibleStores_(
      user
    );

  var visibleIds =
    stores.map(
      function (s) {
        return String(s.id);
      }
    );

  var manualEvents =
    safeSupabaseSelect_(
      '/rest/v1/bacio_calendario_eventos?select=*&ativa=eq.true&order=inicio_em.asc&limit=5000',
      []
    )
    .filter(
      function (event) {

        return calendarEventVisibleV2_(
          event,
          user,
          stores
        );

      }
    )
    .map(
      function (event) {

        return {
          id:
            String(
              event.id
            ),

          source:
            'manual',

          type:
            event.tipo ||
            'outro',

          title:
            event.titulo ||
            'Evento',

          description:
            event.descricao ||
            '',

          start:
            event.inicio_em ||
            '',

          end:
            event.fim_em ||
            '',

          allDay:
            event.dia_inteiro ===
            true,

          scopeType:
            event.escopo_tipo ||
            'todos',

          scopeIds:
            normalizeArray_(
              event.escopo_ids
            ),

          reminders:
            normalizeObjectArray_(
              event.lembretes
            ),

          canDelete:
            role ===
            'admin'
        };

      }
    );

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_DEMANDAS',
          'bacio_demandas'
        ) +
        '?select=*&ativa=eq.true&order=created_at.desc&limit=5000',
      []
    )
    .filter(
      function (d) {

        if (
          String(
            d.status ||
            'active'
          )
          .toLowerCase() ===
          'draft'
        ) {

          return false;

        }

        return demandaVisivelNoEscopo_(
          d,
          visibleIds
        );

      }
    );

  var demandEvents = [];

  demandas.forEach(
    function (d) {

      var due =
        d.prazo_sla ||
        '';

      var start =
        d.inicio_em ||
        '';

      if (due) {

        demandEvents.push(
          {
            id:
              'demanda-prazo-' +
              String(
                d.id
              ),

            source:
              'demanda',

            type:
              'demanda',

            title:
              'Prazo · ' +
              (
                d.titulo ||
                'Demanda'
              ),

            description:
              d.descricao ||
              '',

            start:
              due,

            end:
              '',

            allDay:
              false,

            demandId:
              String(
                d.id
              ),

            eventKind:
              'deadline'
          }
        );

      }

      else if (start) {

        demandEvents.push(
          {
            id:
              'demanda-inicio-' +
              String(
                d.id
              ),

            source:
              'demanda',

            type:
              'demanda',

            title:
              d.titulo ||
              'Demanda',

            description:
              d.descricao ||
              '',

            start:
              start,

            end:
              '',

            allDay:
              false,

            demandId:
              String(
                d.id
              ),

            eventKind:
              'start'
          }
        );

      }

    }
  );

  var events =
    manualEvents.concat(
      demandEvents
    );

  events.sort(
    function (a, b) {

      return String(
        a.start ||
        ''
      )
      .localeCompare(
        String(
          b.start ||
          ''
        )
      );

    }
  );

  return {
    events:
      events,

    generatedAt:
      new Date()
      .toISOString()
  };
}


function calendarEventVisibleV2_(
  event,
  user,
  visibleStores
) {

  var role =
    roleOf_(
      user
    );

  var scope =
    String(
      event.escopo_tipo ||
      'todos'
    )
    .toLowerCase();

  var ids =
    normalizeArray_(
      event.escopo_ids
    );

  if (
    role ===
    'admin'
  ) {

    return true;

  }

  if (
    scope ===
      'todos' ||
    !ids.length
  ) {

    return true;

  }

  if (
    role ===
    'loja'
  ) {

    var lojaId =
      String(
        user.loja_id ||
        ''
      );

    var loja =
      visibleStores[0] ||
      {};

    if (
      scope ===
      'lojas'
    ) {

      return (
        ids.indexOf(
          lojaId
        ) >= 0
      );

    }

    if (
      scope ===
      'regional'
    ) {

      return (
        ids.indexOf(
          String(
            loja.regional_id ||
            ''
          )
        ) >= 0
      );

    }

    if (
      scope ===
      'consultor'
    ) {

      return (
        ids.indexOf(
          String(
            loja.consultor_id ||
            ''
          )
        ) >= 0
      );

    }

    return false;
  }

  if (
    scope ===
    'lojas'
  ) {

    return visibleStores.some(
      function (s) {

        return (
          ids.indexOf(
            String(s.id)
          ) >= 0
        );

      }
    );

  }

  if (
    scope ===
    'regional'
  ) {

    return visibleStores.some(
      function (s) {

        return (
          ids.indexOf(
            String(
              s.regional_id ||
              ''
            )
          ) >= 0
        );

      }
    );

  }

  if (
    scope ===
    'consultor'
  ) {

    return visibleStores.some(
      function (s) {

        return (
          ids.indexOf(
            String(
              s.consultor_id ||
              ''
            )
          ) >= 0
        );

      }
    );

  }

  return false;
}


function saveCalendarEvent(
  input
) {

  input =
    input ||
    {};

  var auth =
    requireAdmin_();

  var title =
    String(
      input.title ||
      ''
    )
    .trim();

  var type =
    String(
      input.type ||
      'outro'
    )
    .trim()
    .toLowerCase();

  var start =
    String(
      input.start ||
      ''
    )
    .trim();

  var end =
    String(
      input.end ||
      ''
    )
    .trim();

  var scopeType =
    String(
      input.scopeType ||
      'todos'
    )
    .trim()
    .toLowerCase();

  var scopeIds =
    Array.isArray(
      input.scopeIds
    )
      ? input.scopeIds.map(
          String
        )
      : [];

  if (
    !title ||
    !start
  ) {

    throw new Error(
      'Informe o título e o início do evento.'
    );

  }

  if (
    [
      'todos',
      'regional',
      'consultor',
      'lojas'
    ]
    .indexOf(
      scopeType
    ) < 0
  ) {

    throw new Error(
      'Público do evento inválido.'
    );

  }

  if (
    scopeType !==
      'todos' &&
    !scopeIds.length
  ) {

    throw new Error(
      'Selecione pelo menos um item do público.'
    );

  }

  var startDate =
    new Date(
      start
    );

  var endDate =
    end
      ? new Date(
          end
        )
      : null;

  if (
    isNaN(
      startDate.getTime()
    )
  ) {

    throw new Error(
      'Data de início inválida.'
    );

  }

  if (
    endDate &&
    !isNaN(
      endDate.getTime()
    ) &&
    endDate.getTime() <
    startDate.getTime()
  ) {

    throw new Error(
      'O fim não pode ser anterior ao início.'
    );

  }

  var payload = {
    titulo:
      title,

    descricao:
      String(
        input.description ||
        ''
      )
      .trim() ||
      null,

    tipo:
      type,

    inicio_em:
      startDate
      .toISOString(),

    fim_em:
      endDate &&
      !isNaN(
        endDate.getTime()
      )
        ? endDate.toISOString()
        : null,

    dia_inteiro:
      input.allDay ===
      true,

    escopo_tipo:
      scopeType,

    escopo_ids:
      scopeIds,

    lembretes:
      Array.isArray(
        input.reminders
      )
        ? input.reminders
        : [],

    created_by:
      auth.email,

    ativa:
      true,

    updated_at:
      new Date()
      .toISOString()
  };

  var inserted =
    supabaseRequest_(
      '/rest/v1/bacio_calendario_eventos',
      'post',
      payload,
      'return=representation'
    );

  return {
    ok:
      true,

    row:
      inserted &&
      inserted[0]
        ? inserted[0]
        : null
  };
}


function deleteCalendarEvent(
  eventId
) {

  requireAdmin_();

  if (!eventId) {

    throw new Error(
      'Evento não informado.'
    );

  }

  supabaseRequest_(
    '/rest/v1/bacio_calendario_eventos?id=eq.' +
      encodeURIComponent(
        String(
          eventId
        )
      ),
    'patch',
    {
      ativa:
        false,

      updated_at:
        new Date()
        .toISOString()
    },
    'return=minimal'
  );

  return {
    ok:
      true
  };
}


/* ======================================================================
 * CHAT — ESCRITÓRIO / LOJAS
 * ====================================================================== */

function getChatWorkspace() {
  var auth =
    getCurrentAuthContext_();

  return buildChatWorkspaceV2_(
    auth.user,
    false
  );
}


function getStoreChatWorkspace(
  accessToken
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  return buildChatWorkspaceV2_(
    ctx.user,
    true
  );
}


function buildChatWorkspaceV2_(
  user,
  storeMode
) {

  var stores =
    getVisibleStores_(
      user
    );

  var visibleStoreIds =
    stores.map(
      function (s) {

        return String(
          s.id
        );

      }
    );

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_DEMANDAS',
          'bacio_demandas'
        ) +
        '?select=*&ativa=eq.true&order=created_at.desc&limit=1000',
      []
    )
    .filter(
      function (d) {

        if (
          String(
            d.status ||
            'active'
          )
          .toLowerCase() ===
          'draft'
        ) {

          return false;

        }

        return demandaVisivelNoEscopo_(
          d,
          visibleStoreIds
        );

      }
    )
    .filter(
      function (d) {

        return (
          String(
            d.tipo ||
            ''
          )
          .toLowerCase() !==
          'comunicado'
        );

      }
    );

  var threads = [];

  stores.forEach(
    function (store) {

      var storeId =
        String(
          store.id
        );

      var label =
        storeLabelV2_(
          store
        );

      threads.push(
        {
          id:
            'geral:' +
            storeId,

          storeId:
            storeId,

          demandId:
            '',

          title:
            storeMode
              ? 'Escritório'
              : label,

          subtitle:
            storeMode
              ? 'Conversa geral com o escritório'
              : 'Conversa geral'
        }
      );

      demandas.forEach(
        function (d) {

          var targetIds =
            getTargetStoreIds_(
              d,
              visibleStoreIds
            );

          if (
            targetIds.indexOf(
              storeId
            ) < 0
          ) {

            return;

          }

          threads.push(
            {
              id:
                'demanda:' +
                String(
                  d.id
                ) +
                ':' +
                storeId,

              storeId:
                storeId,

              demandId:
                String(
                  d.id
                ),

              title:
                d.titulo ||
                'Demanda',

              subtitle:
                storeMode
                  ? (
                      String(
                        d.tipo ||
                        'demanda'
                      )
                      .toLowerCase() ===
                      'campanha'
                        ? 'Campanha'
                        : 'Demanda'
                    )
                  : label
            }
          );

        }
      );

    }
  );

  return {
    threads:
      threads
  };
}


function getChatMessages(
  input
) {

  input =
    input ||
    {};

  var auth =
    getCurrentAuthContext_();

  var user =
    auth.user;

  validateChatContextV2_(
    user,
    input.storeId,
    input.demandId
  );

  return readChatMessagesV2_(
    String(
      input.storeId ||
      ''
    ),
    String(
      input.demandId ||
      ''
    )
  );
}


function getStoreChatMessages(
  accessToken,
  input
) {

  input =
    input ||
    {};

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  var storeId =
    String(
      ctx.user.loja_id ||
      ''
    );

  var demandId =
    String(
      input.demandId ||
      ''
    );

  validateChatContextV2_(
    ctx.user,
    storeId,
    demandId
  );

  return readChatMessagesV2_(
    storeId,
    demandId
  );
}


function readChatMessagesV2_(
  storeId,
  demandId
) {

  var chatTable =
    table_(
      'TABLE_CHAT',
      'bacio_chat_mensagens'
    );

  var path =
    '/rest/v1/' +
    chatTable +
    '?select=*&conversa_loja_id=eq.' +
    encodeURIComponent(
      storeId
    );

  if (demandId) {

    path +=
      '&demanda_id=eq.' +
      encodeURIComponent(
        demandId
      );

  }
  else {

    path +=
      '&demanda_id=is.null';

  }

  path +=
    '&order=created_at.asc&limit=1000';

  var rows =
    safeSupabaseSelect_(
      path,
      []
    );

  return rows.map(
    function (r) {

      return {
        id:
          String(
            r.id ||
            ''
          ),

        email:
          r.usuario_email ||
          '',

        name:
          r.usuario_nome ||
          '',

        role:
          r.role ||
          '',

        storeId:
          r.conversa_loja_id ||
          r.loja_id ||
          '',

        demandId:
          r.demanda_id ||
          '',

        message:
          r.mensagem ||
          '',

        createdAt:
          r.created_at ||
          ''
      };

    }
  );
}


function sendContextChatMessage(
  input
) {

  input =
    input ||
    {};

  var auth =
    getCurrentAuthContext_();

  var user =
    auth.user;

  validateChatContextV2_(
    user,
    input.storeId,
    input.demandId
  );

  return insertChatMessageV2_(
    auth.email,

    user.nome ||
    v2NiceNameFromEmail_(
      auth.email
    ),

    roleOf_(
      user
    ),

    user.loja_id ||
    null,

    String(
      input.storeId ||
      ''
    ),

    String(
      input.demandId ||
      ''
    ),

    input.message
  );
}


function sendStoreContextChatMessage(
  accessToken,
  input
) {

  input =
    input ||
    {};

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  var storeId =
    String(
      ctx.user.loja_id ||
      ''
    );

  var demandId =
    String(
      input.demandId ||
      ''
    );

  validateChatContextV2_(
    ctx.user,
    storeId,
    demandId
  );

  return insertChatMessageV2_(
    ctx.email,

    ctx.user.nome ||
    v2NiceNameFromEmail_(
      ctx.email
    ),

    'loja',

    storeId,

    storeId,

    demandId,

    input.message
  );
}


function insertChatMessageV2_(
  email,
  name,
  role,
  senderStoreId,
  conversationStoreId,
  demandId,
  message
) {

  message =
    String(
      message ||
      ''
    )
    .trim();

  if (!message) {

    throw new Error(
      'Digite uma mensagem.'
    );

  }

  if (!conversationStoreId) {

    throw new Error(
      'Loja da conversa não informada.'
    );

  }

  var chatTable =
    table_(
      'TABLE_CHAT',
      'bacio_chat_mensagens'
    );

  var payload = {
    usuario_email:
      email,

    usuario_nome:
      name,

    role:
      role,

    loja_id:
      senderStoreId ||
      null,

    conversa_loja_id:
      conversationStoreId,

    demanda_id:
      demandId ||
      null,

    mensagem:
      message,

    created_at:
      new Date()
      .toISOString()
  };

  var inserted =
    supabaseRequest_(
      '/rest/v1/' +
        chatTable,
      'post',
      payload,
      'return=representation'
    );

  return {
    ok:
      true,

    row:
      inserted &&
      inserted[0]
        ? inserted[0]
        : null
  };
}


function validateChatContextV2_(
  user,
  storeId,
  demandId
) {

  storeId =
    String(
      storeId ||
      ''
    )
    .trim();

  demandId =
    String(
      demandId ||
      ''
    )
    .trim();

  if (!storeId) {

    throw new Error(
      'Loja da conversa não informada.'
    );

  }

  var visibleStores =
    getVisibleStores_(
      user
    );

  var visibleIds =
    visibleStores.map(
      function (s) {

        return String(
          s.id
        );

      }
    );

  if (
    visibleIds.indexOf(
      storeId
    ) < 0
  ) {

    throw new Error(
      'Você não tem acesso a esta conversa.'
    );

  }

  if (!demandId) {

    return true;

  }

  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );

  var rows =
    supabaseRequest_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&id=eq.' +
        encodeURIComponent(
          demandId
        ) +
        '&ativa=eq.true&limit=1',
      'get'
    ) || [];

  if (!rows.length) {

    throw new Error(
      'Demanda da conversa não encontrada.'
    );

  }

  var demand =
    rows[0];

  var targets =
    getTargetStoreIds_(
      demand,
      visibleIds
    );

  if (
    targets.indexOf(
      storeId
    ) < 0
  ) {

    throw new Error(
      'Esta loja não faz parte desta demanda.'
    );

  }

  return true;
}


/* ======================================================================
 * USUÁRIOS & ACESSOS DAS LOJAS
 * ====================================================================== */

function getStoreAccessWorkspace() {
  requireAdmin_();

  var usuariosTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  var lojasTable =
    table_(
      'TABLE_LOJAS',
      'bacio_lojas'
    );

  var users =
    safeSupabaseSelect_(
      '/rest/v1/' +
        usuariosTable +
        '?select=*&role=eq.loja&order=created_at.desc&limit=5000',
      []
    );

  var stores =
    safeSupabaseSelect_(
      '/rest/v1/' +
        lojasTable +
        '?select=*&order=nome.asc&limit=5000',
      []
    );

  var storeMap = {};

  stores.forEach(
    function (s) {

      storeMap[
        String(
          s.id
        )
      ] = s;

    }
  );

  return {
    items:
      users.map(
        function (u) {

          var store =
            storeMap[
              String(
                u.loja_id ||
                ''
              )
            ] || {};

          return {
            id:
              String(
                u.id
              ),

            email:
              u.email ||
              '',

            nome:
              u.nome ||
              '',

            role:
              u.role ||
              'loja',

            lojaId:
              u.loja_id ||
              '',

            lojaCodigo:
              store.codigo ||
              '',

            lojaNome:
              store.nome ||
              '',

            ativo:
              u.ativo !==
              false,

            authUserId:
              u.auth_user_id ||
              '',

            authProvider:
              u.auth_provider ||
              '',

            forcePasswordChange:
              u.force_password_change ===
              true,

            createdAt:
              u.created_at ||
              ''
          };

        }
      )
  };
}


function createStoreAccess(
  input
) {

  input =
    input ||
    {};

  requireAdmin_();

  var lojaId =
    String(
      input.lojaId ||
      ''
    )
    .trim();

  var email =
    String(
      input.email ||
      ''
    )
    .trim()
    .toLowerCase();

  var password =
    String(
      input.password ||
      ''
    );

  if (
    !lojaId ||
    !email ||
    password.length <
    8
  ) {

    throw new Error(
      'Informe loja, e-mail e uma senha com pelo menos 8 caracteres.'
    );

  }

  var lojasTable =
    table_(
      'TABLE_LOJAS',
      'bacio_lojas'
    );

  var usuariosTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  var stores =
    supabaseRequest_(
      '/rest/v1/' +
        lojasTable +
        '?select=*&id=eq.' +
        encodeURIComponent(
          lojaId
        ) +
        '&limit=1',
      'get'
    ) || [];

  if (!stores.length) {

    throw new Error(
      'Loja não encontrada.'
    );

  }

  var existing =
    safeSupabaseSelect_(
      '/rest/v1/' +
        usuariosTable +
        '?select=*&email=eq.' +
        encodeURIComponent(
          email
        ) +
        '&limit=1',
      []
    );

  if (
    existing.length &&
    existing[0].auth_user_id
  ) {

    throw new Error(
      'Já existe um acesso Auth cadastrado para este e-mail.'
    );

  }

  var store =
    stores[0];

  var created =
    supabaseAuthRequestV2_(
      '/auth/v1/admin/users',
      'post',
      {
        email:
          email,

        password:
          password,

        email_confirm:
          true,

        user_metadata: {
          nome:
            store.nome ||
            'Loja',

          loja_id:
            lojaId,

          origem:
            'bacio_conecta'
        }
      }
    );

  var createdUser =
    created &&
    created.user
      ? created.user
      : created;

  if (
    !createdUser ||
    !createdUser.id
  ) {

    throw new Error(
      'O usuário de autenticação não foi criado.'
    );

  }

  var now =
    new Date()
    .toISOString();

  var payload = {
    email:
      email,

    nome:
      store.nome ||
      'Loja',

    role:
      'loja',

    loja_id:
      lojaId,

    regional_id:
      store.regional_id ||
      null,

    consultor_id:
      store.consultor_id ||
      null,

    ativo:
      true,

    auth_user_id:
      String(
        createdUser.id
      ),

    auth_provider:
      'password',

    force_password_change:
      true,

    updated_at:
      now
  };

  if (!existing.length) {

    payload.created_at =
      now;

  }

  var saved =
    supabaseRequest_(
      '/rest/v1/' +
        usuariosTable +
        '?on_conflict=email',
      'post',
      payload,
      'resolution=merge-duplicates,return=representation'
    );

  return {
    ok:
      true,

    authUserId:
      String(
        createdUser.id
      ),

    user:
      saved &&
      saved[0]
        ? saved[0]
        : payload
  };
}


function resetStoreAccessPassword(
  input
) {

  input =
    input ||
    {};

  requireAdmin_();

  var authUserId =
    String(
      input.authUserId ||
      ''
    )
    .trim();

  var password =
    String(
      input.password ||
      ''
    );

  if (
    !authUserId ||
    password.length <
    8
  ) {

    throw new Error(
      'Informe o usuário e uma senha com pelo menos 8 caracteres.'
    );

  }

  supabaseAuthRequestV2_(
    '/auth/v1/admin/users/' +
      encodeURIComponent(
        authUserId
      ),
    'put',
    {
      password:
        password
    }
  );

  var usuariosTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  supabaseRequest_(
    '/rest/v1/' +
      usuariosTable +
      '?auth_user_id=eq.' +
      encodeURIComponent(
        authUserId
      ),
    'patch',
    {
      force_password_change:
        true,

      updated_at:
        new Date()
        .toISOString()
    },
    'return=minimal'
  );

  return {
    ok:
      true
  };
}


function setStoreAccessActive(
  input
) {

  input =
    input ||
    {};

  requireAdmin_();

  var userId =
    String(
      input.userId ||
      ''
    )
    .trim();

  var ativo =
    input.ativo ===
    true;

  if (!userId) {

    throw new Error(
      'Acesso não informado.'
    );

  }

  var usuariosTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  supabaseRequest_(
    '/rest/v1/' +
      usuariosTable +
      '?id=eq.' +
      encodeURIComponent(
        userId
      ),
    'patch',
    {
      ativo:
        ativo,

      updated_at:
        new Date()
        .toISOString()
    },
    'return=minimal'
  );

  return {
    ok:
      true,

    ativo:
      ativo
  };
}


/* ======================================================================
 * COMUNICADOS
 * ====================================================================== */

function saveAnnouncement(
  input
) {

  input =
    input ||
    {};

  requireAdmin_();

  var title =
    String(
      input.title ||
      ''
    )
    .trim();

  if (!title) {

    throw new Error(
      'Informe um título.'
    );

  }

  return saveDemand(
    {
      title:
        title,

      description:
        String(
          input.message ||
          ''
        )
        .trim(),

      type:
        'comunicado',

      publishStatus:
        'active',

      responseRequired:
        false,

      lojaIds:
        Array.isArray(
          input.lojaIds
        )
          ? input.lojaIds
          : [],

      modelSource:
        'manual',

      modelFields:
        [],

      importMeta:
        null,

      cronograma: {
        lembretes: []
      },

      startAt:
        null,

      deadline:
        null,

      endAt:
        null
    }
  );
}


/* ======================================================================
 * LOJA MANUAL / IMPORTAÇÃO COMPLETA
 * ====================================================================== */

function saveStoreManual(
  input
) {

  input =
    input ||
    {};

  requireAdmin_();

  var nome =
    String(
      input.nome ||
      ''
    )
    .trim();

  var codigo =
    String(
      input.codigo ||
      ''
    )
    .trim();

  if (
    !nome ||
    !codigo
  ) {

    throw new Error(
      'Informe código e nome da loja.'
    );

  }

  var id =
    criarIdLoja_(
      codigo,
      nome
    );

  if (!id) {

    throw new Error(
      'Não foi possível gerar o ID da loja.'
    );

  }

  var table =
    table_(
      'TABLE_LOJAS',
      'bacio_lojas'
    );

  var now =
    new Date()
    .toISOString();

  var payload = {
    id:
      id,

    codigo:
      codigo,

    nome:
      nome,

    email:
      String(
        input.email ||
        ''
      )
      .trim() ||
      null,

    cidade:
      String(
        input.cidade ||
        ''
      )
      .trim() ||
      null,

    regional_id:
      String(
        input.regionalId ||
        input.regional ||
        ''
      )
      .trim() ||
      null,

    consultor_id:
      String(
        input.consultorId ||
        input.consultor ||
        ''
      )
      .trim() ||
      null,

    ativa:
      true,

    updated_at:
      now,

    dados_extras: {
      regional:
        String(
          input.regional ||
          ''
        )
        .trim(),

      consultor:
        String(
          input.consultor ||
          ''
        )
        .trim(),

      estado:
        String(
          input.estado ||
          ''
        )
        .trim(),

      formato:
        String(
          input.formato ||
          ''
        )
        .trim(),

      delivery:
        String(
          input.delivery ||
          ''
        )
        .trim(),

      endereco:
        String(
          input.endereco ||
          ''
        )
        .trim()
    }
  };

  var inserted =
    supabaseRequest_(
      '/rest/v1/' +
        table +
        '?on_conflict=id',
      'post',
      payload,
      'resolution=merge-duplicates,return=representation'
    );

  return {
    ok:
      true,

    row:
      inserted &&
      inserted[0]
        ? inserted[0]
        : null
  };
}


function importStoreBaseComplete(
  input
) {

  requireAdmin_();

  var result =
    importarBaseLojas(
      input ||
      {}
    );

  syncStoreScopeIdsFromExtrasV2_();

  return result;
}


function syncStoreScopeIdsFromExtrasV2_() {
  var table =
    table_(
      'TABLE_LOJAS',
      'bacio_lojas'
    );

  var rows =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table +
        '?select=id,regional_id,consultor_id,dados_extras&limit=5000',
      []
    );

  var updated =
    0;

  rows.forEach(
    function (row) {

      var extras =
        parseJsonObject_(
          row.dados_extras
        );

      var regional =
        String(
          extras.regional ||
          ''
        )
        .trim();

      var consultor =
        String(
          extras.consultor ||
          ''
        )
        .trim();

      var patch = {};

      if (
        regional &&
        String(
          row.regional_id ||
          ''
        ) !==
        regional
      ) {

        patch.regional_id =
          regional;

      }

      if (
        consultor &&
        String(
          row.consultor_id ||
          ''
        ) !==
        consultor
      ) {

        patch.consultor_id =
          consultor;

      }

      if (
        !Object.keys(
          patch
        ).length
      ) {

        return;

      }

      patch.updated_at =
        new Date()
        .toISOString();

      supabaseRequest_(
        '/rest/v1/' +
          table +
          '?id=eq.' +
          encodeURIComponent(
            String(
              row.id
            )
          ),
        'patch',
        patch,
        'return=minimal'
      );

      updated++;

    }
  );

  return updated;
}


/* ======================================================================
 * NOTIFICAÇÕES
 * ====================================================================== */

function markAllNotificationsRead() {
  var auth =
    getCurrentAuthContext_();

  return markAllNotificationsForEmailV2_(
    auth.email
  );
}


function markStoreNotificationRead(
  accessToken,
  notificationId
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  if (!notificationId) {

    throw new Error(
      'Notificação não informada.'
    );

  }

  var table =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  supabaseRequest_(
    '/rest/v1/' +
      table +
      '?id=eq.' +
      encodeURIComponent(
        String(
          notificationId
        )
      ) +
      '&usuario_email=eq.' +
      encodeURIComponent(
        ctx.email
      ),
    'patch',
    {
      lida:
        true
    },
    'return=minimal'
  );

  return {
    ok:
      true
  };
}


function markAllStoreNotificationsRead(
  accessToken
) {

  var ctx =
    getStoreAuthContext_(
      accessToken
    );

  return markAllNotificationsForEmailV2_(
    ctx.email
  );
}


function markAllNotificationsForEmailV2_(
  email
) {

  var table =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  supabaseRequest_(
    '/rest/v1/' +
      table +
      '?usuario_email=eq.' +
      encodeURIComponent(
        String(
          email
        )
      ) +
      '&lida=eq.false',
    'patch',
    {
      lida:
        true
    },
    'return=minimal'
  );

  return {
    ok:
      true
  };
}


function createTestNotification() {
  var auth =
    requireAdmin_();

  var table =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  var inserted =
    supabaseRequest_(
      '/rest/v1/' +
        table,
      'post',
      {
        usuario_email:
          auth.email,

        titulo:
          'Teste do Bacio Conecta',

        mensagem:
          'O painel de notificações está conectado ao Supabase.',

        lida:
          false,

        created_at:
          new Date()
          .toISOString()
      },
      'return=representation'
    );

  return {
    ok:
      true,

    row:
      inserted &&
      inserted[0]
        ? inserted[0]
        : null
  };
}


function notifyStoreUsersV2_(
  storeId,
  title,
  message
) {

  if (!storeId) {
    return 0;
  }

  var usersTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  var notificationsTable =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  var users =
    safeSupabaseSelect_(
      '/rest/v1/' +
        usersTable +
        '?select=*&ativo=eq.true&role=eq.loja&loja_id=eq.' +
        encodeURIComponent(
          String(
            storeId
          )
        ),
      []
    );

  if (!users.length) {
    return 0;
  }

  var now =
    new Date()
    .toISOString();

  var payload =
    users.map(
      function (u) {

        return {
          usuario_email:
            u.email,

          titulo:
            String(
              title ||
              'Bacio Conecta'
            ),

          mensagem:
            String(
              message ||
              ''
            ),

          lida:
            false,

          created_at:
            now
        };

      }
    );

  supabaseRequest_(
    '/rest/v1/' +
      notificationsTable,
    'post',
    payload,
    'return=minimal'
  );

  return payload.length;
}


function notifyManagementV2_(
  title,
  message,
  storeId
) {

  var usersTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  var notificationsTable =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  var users =
    safeSupabaseSelect_(
      '/rest/v1/' +
        usersTable +
        '?select=*&ativo=eq.true&limit=5000',
      []
    )
    .filter(
      function (u) {

        var role =
          roleOf_(
            u
          );

        if (
          role ===
          'admin'
        ) {

          return true;

        }

        if (!storeId) {

          return (
            role !==
            'loja'
          );

        }

        var stores =
          getVisibleStores_(
            u
          );

        return stores.some(
          function (s) {

            return (
              String(
                s.id
              ) ===
              String(
                storeId
              )
            );

          }
        );

      }
    );

  if (!users.length) {
    return 0;
  }

  var now =
    new Date()
    .toISOString();

  var payload =
    users.map(
      function (u) {

        return {
          usuario_email:
            u.email,

          titulo:
            String(
              title ||
              'Bacio Conecta'
            ),

          mensagem:
            String(
              message ||
              ''
            ),

          lida:
            false,

          created_at:
            now
        };

      }
    );

  supabaseRequest_(
    '/rest/v1/' +
      notificationsTable,
    'post',
    payload,
    'return=minimal'
  );

  return payload.length;
}


/* ======================================================================
 * ROBÔ DE LEMBRETES
 * Execute instalarGatilhoLembretes() UMA VEZ depois da instalação.
 * ====================================================================== */

function instalarGatilhoLembretes() {
  requireAdmin_();

  removeReminderTriggersV2_();

  ScriptApp
    .newTrigger(
      'processAutomaticNotifications'
    )
    .timeBased()
    .everyMinutes(15)
    .create();

  return {
    ok:
      true,

    mensagem:
      'Gatilho instalado para executar a cada 15 minutos.'
  };
}


function removerGatilhoLembretes() {
  requireAdmin_();

  return {
    ok:
      true,

    removidos:
      removeReminderTriggersV2_()
  };
}


function removeReminderTriggersV2_() {
  var removed =
    0;

  ScriptApp
    .getProjectTriggers()
    .forEach(
      function (trigger) {

        if (
          trigger
          .getHandlerFunction() ===
          'processAutomaticNotifications'
        ) {

          ScriptApp.deleteTrigger(
            trigger
          );

          removed++;

        }

      }
    );

  return removed;
}


function processAutomaticNotifications() {
  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );

  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );

  var usersTable =
    table_(
      'TABLE_USUARIOS',
      'bacio_usuarios'
    );

  var lojasTable =
    table_(
      'TABLE_LOJAS',
      'bacio_lojas'
    );

  var notificationsTable =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&ativa=eq.true&order=created_at.desc&limit=3000',
      []
    );

  var respostas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&order=created_at.desc&limit=10000',
      []
    );

  var users =
    safeSupabaseSelect_(
      '/rest/v1/' +
        usersTable +
        '?select=*&ativo=eq.true&role=eq.loja&limit=5000',
      []
    );

  var lojas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        lojasTable +
        '?select=id&ativa=eq.true&limit=5000',
      []
    );

  var allStoreIds =
    lojas.map(
      function (l) {
        return String(l.id);
      }
    );

  var now =
    new Date();

  var created =
    0;

  demandas.forEach(
    function (d) {

      var savedStatus =
        String(
          d.status ||
          'active'
        )
        .toLowerCase();

      if (
        savedStatus ===
          'draft' ||
        savedStatus ===
          'closed'
      ) {

        return;

      }

      var targetIds =
        normalizeArray_(
          d.loja_ids
        );

      if (!targetIds.length) {

        targetIds =
          allStoreIds.slice();

      }

      var targetMap = {};

      targetIds.forEach(
        function (id) {

          targetMap[
            String(id)
          ] = true;

        }
      );

      var latest = {};

      respostas.forEach(
        function (r) {

          if (
            String(
              r.demanda_id ||
              ''
            ) !==
            String(
              d.id
            )
          ) {

            return;

          }

          var sid =
            String(
              r.loja_id ||
              ''
            );

          if (
            sid &&
            !latest[sid]
          ) {

            latest[sid] =
              r;

          }

        }
      );

      var cron =
        normalizeJsonObject_(
          d.cronograma
        );

      var markers =
        normalizeJsonObject_(
          cron.notificacoes_processadas
        );

      var reminders =
        Array.isArray(
          cron.lembretes
        )
          ? cron.lembretes
          : [];

      var publishedAt =
        validDateV2_(
          d.publicada_em
        );

      var deadline =
        validDateV2_(
          d.prazo_sla
        );

      var endAt =
        validDateV2_(
          d.encerramento_em
        );

      var event =
        null;

      var title =
        '';

      var message =
        '';

      var onlyPending =
        true;

      if (
        publishedAt &&
        publishedAt.getTime() <=
        now.getTime() &&
        !markers.publicacao
      ) {

        event =
          'publicacao';

        title =
          String(
            d.tipo ||
            ''
          )
          .toLowerCase() ===
          'campanha'

            ? 'Nova campanha'

            : String(
                d.tipo ||
                ''
              )
              .toLowerCase() ===
              'comunicado'

              ? 'Novo comunicado'

              : 'Nova demanda';

        message =
          d.titulo ||
          'Novo conteúdo disponível no Bacio Conecta.';

        onlyPending =
          false;

      }

      if (
        !event &&
        deadline
      ) {

        var diffMinutes =
          Math.round(
            (
              deadline.getTime() -
              now.getTime()
            ) /
            60000
          );

        if (
          reminderEnabledV2_(
            reminders,
            '24h_antes'
          ) &&
          diffMinutes >
          120 &&
          diffMinutes <=
          1440 &&
          !markers.aviso_24h
        ) {

          event =
            'aviso_24h';

          title =
            'Prazo se aproximando';

          message =
            (
              d.titulo ||
              'Demanda'
            ) +
            ' vence em menos de 24 horas.';

        }

        else if (
          reminderEnabledV2_(
            reminders,
            '2h_antes'
          ) &&
          diffMinutes >
          0 &&
          diffMinutes <=
          120 &&
          !markers.aviso_2h
        ) {

          event =
            'aviso_2h';

          title =
            'Prazo próximo';

          message =
            (
              d.titulo ||
              'Demanda'
            ) +
            ' vence em menos de 2 horas.';

        }

        else if (
          reminderEnabledV2_(
            reminders,
            'vencimento'
          ) &&
          diffMinutes <=
          0 &&
          diffMinutes >=
          -90 &&
          !markers.vencimento
        ) {

          event =
            'vencimento';

          title =
            'Prazo encerrado';

          message =
            'O prazo de ' +
            (
              d.titulo ||
              'uma demanda'
            ) +
            ' chegou ao fim.';

        }

        else if (
          diffMinutes <
          -90 &&
          (
            !endAt ||
            endAt.getTime() >
            now.getTime()
          ) &&
          !markers.atraso
        ) {

          event =
            'atraso';

          title =
            'Pendência em atraso';

          message =
            (
              d.titulo ||
              'Demanda'
            ) +
            ' está em atraso e ainda precisa de resposta.';

        }

      }

      if (!event) {
        return;
      }

      var recipients =
        users.filter(
          function (u) {

            var sid =
              String(
                u.loja_id ||
                ''
              );

            if (
              !targetMap[sid]
            ) {

              return false;

            }

            if (
              !onlyPending
            ) {

              return true;

            }

            return (
              !responseCountsAsCompleteV2_(
                latest[sid]
              )
            );

          }
        );

      if (
        recipients.length
      ) {

        var payload =
          recipients.map(
            function (u) {

              return {
                usuario_email:
                  u.email,

                titulo:
                  title,

                mensagem:
                  message,

                lida:
                  false,

                created_at:
                  now.toISOString()
              };

            }
          );

        supabaseRequest_(
          '/rest/v1/' +
            notificationsTable,
          'post',
          payload,
          'return=minimal'
        );

        created +=
          payload.length;

      }

      markers[event] =
        now.toISOString();

      cron.notificacoes_processadas =
        markers;

      supabaseRequest_(
        '/rest/v1/' +
          demandasTable +
          '?id=eq.' +
          encodeURIComponent(
            String(
              d.id
            )
          ),
        'patch',
        {
          cronograma:
            cron,

          updated_at:
            now.toISOString()
        },
        'return=minimal'
      );

    }
  );

  processCalendarNotificationsV2_(
    now
  );

  return {
    ok:
      true,

    notificacoesCriadas:
      created,

    executadoEm:
      now.toISOString()
  };
}


function processCalendarNotificationsV2_(
  now
) {

  now =
    now ||
    new Date();

  var events =
    safeSupabaseSelect_(
      '/rest/v1/bacio_calendario_eventos?select=*&ativa=eq.true&order=inicio_em.asc&limit=5000',
      []
    );

  var stores =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_LOJAS',
          'bacio_lojas'
        ) +
        '?select=*&ativa=eq.true&limit=5000',
      []
    );

  var users =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_USUARIOS',
          'bacio_usuarios'
        ) +
        '?select=*&ativo=eq.true&role=eq.loja&limit=5000',
      []
    );

  var notificationTable =
    table_(
      'TABLE_NOTIFICACOES',
      'bacio_notificacoes'
    );

  events.forEach(
    function (event) {

      var start =
        validDateV2_(
          event.inicio_em
        );

      if (!start) {
        return;
      }

      var diffMinutes =
        Math.round(
          (
            start.getTime() -
            now.getTime()
          ) /
          60000
        );

      var reminders =
        normalizeObjectArray_(
          event.lembretes
        );

      var changed =
        false;

      var notifyType =
        '';

      var notifyTitle =
        '';

      reminders.forEach(
        function (r) {

          if (
            !r ||
            r.ativo === false ||
            r.enviado_em
          ) {

            return;

          }

          if (
            r.tipo ===
              '24h_antes' &&
            diffMinutes >
              120 &&
            diffMinutes <=
              1440 &&
            !notifyType
          ) {

            notifyType =
              '24h_antes';

            notifyTitle =
              'Evento amanhã';

            r.enviado_em =
              now.toISOString();

            changed =
              true;

          }

          if (
            r.tipo ===
              '2h_antes' &&
            diffMinutes >
              0 &&
            diffMinutes <=
              120 &&
            !notifyType
          ) {

            notifyType =
              '2h_antes';

            notifyTitle =
              'Evento em breve';

            r.enviado_em =
              now.toISOString();

            changed =
              true;

          }

        }
      );

      if (!notifyType) {
        return;
      }

      var eligibleStoreIds =
        stores
        .filter(
          function (store) {

            return calendarEventVisibleV2_(
              event,
              {
                role:
                  'loja',

                loja_id:
                  store.id
              },
              [
                store
              ]
            );

          }
        )
        .map(
          function (store) {

            return String(
              store.id
            );

          }
        );

      var recipients =
        users.filter(
          function (u) {

            return (
              eligibleStoreIds.indexOf(
                String(
                  u.loja_id ||
                  ''
                )
              ) >= 0
            );

          }
        );

      if (
        recipients.length
      ) {

        var payload =
          recipients.map(
            function (u) {

              return {
                usuario_email:
                  u.email,

                titulo:
                  notifyTitle,

                mensagem:
                  event.titulo ||
                  'Evento do calendário',

                lida:
                  false,

                created_at:
                  now.toISOString()
              };

            }
          );

        supabaseRequest_(
          '/rest/v1/' +
            notificationTable,
          'post',
          payload,
          'return=minimal'
        );

      }

      if (
        changed
      ) {

        supabaseRequest_(
          '/rest/v1/bacio_calendario_eventos?id=eq.' +
            encodeURIComponent(
              String(
                event.id
              )
            ),
          'patch',
          {
            lembretes:
              reminders,

            updated_at:
              now.toISOString()
          },
          'return=minimal'
        );

      }

    }
  );
}


function reminderEnabledV2_(
  reminders,
  type
) {

  return (
    reminders ||
    []
  )
  .some(
    function (r) {

      if (
        typeof r ===
        'string'
      ) {

        return (
          r ===
          type
        );

      }

      return (
        String(
          (
            r ||
            {}
          ).tipo ||
          ''
        ) ===
        type &&
        r.ativo !==
        false
      );

    }
  );
}


function responseCountsAsCompleteV2_(
  row
) {

  if (!row) {
    return false;
  }

  var status =
    String(
      row.status ||
      'respondido'
    )
    .toLowerCase();

  return (
    status !==
      'ajuste_necessario' &&
    status !==
      'reprovada'
  );
}


function validDateV2_(
  value
) {

  if (!value) {
    return null;
  }

  var d =
    new Date(
      value
    );

  return isNaN(
    d.getTime()
  )
    ? null
    : d;
}


/* ======================================================================
 * HELPERS
 * ====================================================================== */

function storeLabelV2_(
  store
) {

  store =
    store ||
    {};

  var code =
    String(
      store.codigo ||
      ''
    )
    .trim();

  var name =
    String(
      store.nome ||
      store.id ||
      'Loja'
    )
    .trim();

  return (
    (
      code
        ? code + ' · '
        : ''
    ) +
    name
  );
}


function storeLabelByIdV2_(
  storeId
) {

  var rows =
    safeSupabaseSelect_(
      '/rest/v1/' +
        table_(
          'TABLE_LOJAS',
          'bacio_lojas'
        ) +
        '?select=*&id=eq.' +
        encodeURIComponent(
          String(
            storeId
          )
        ) +
        '&limit=1',
      []
    );

  return rows.length
    ? storeLabelV2_(
        rows[0]
      )
    : String(
        storeId ||
        'Loja'
      );
}
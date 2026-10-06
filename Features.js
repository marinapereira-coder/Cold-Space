/**
 * BACIO CONECTA — FUNCIONALIDADES COMPLEMENTARES
 * Adicione este arquivo ao MESMO projeto do Code.gs e Supabase.gs atuais.
 * Não substitui o Supabase.gs: usa as funções seguras já existentes nele.
 */

/* ================================================================
 * RESPOSTAS / AVALIAÇÃO
 * ================================================================ */

function getResponsesWorkspace() {
  var auth = getCurrentAuthContext_();
  var user = auth.user;
  var role = roleOf_(user);

  if (role === 'loja') {
    throw new Error('Esta área é destinada aos perfis de gestão.');
  }

  var visibleStores = getVisibleStores_(user);

  var visibleIds = {};
  var storeMap = {};

  visibleStores.forEach(function (s) {
    var id = String(s.id);

    visibleIds[id] = true;

    var extras = parseJsonObject_(s.dados_extras);

    storeMap[id] = {
      id: id,
      codigo: s.codigo || '',
      nome: s.nome || '',
      email: s.email || '',
      regional: extras.regional || '',
      consultor: extras.consultor || ''
    };
  });

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

  var respostas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        respostasTable +
        '?select=*&order=created_at.desc&limit=5000',
      []
    )
    .filter(function (r) {

      return Boolean(
        visibleIds[
          String(
            r.loja_id || ''
          )
        ]
      );

    });

  var demandas =
    safeSupabaseSelect_(
      '/rest/v1/' +
        demandasTable +
        '?select=*&order=created_at.desc&limit=2000',
      []
    );

  var demandMap = {};

  demandas.forEach(function (d) {

    demandMap[
      String(d.id)
    ] = d;

  });


  // Mantém somente a resposta mais recente
  // de cada demanda + loja.

  var latest = {};

  respostas.forEach(function (r) {

    var key =
      String(
        r.demanda_id || ''
      ) +
      '|' +
      String(
        r.loja_id || ''
      );

    if (!latest[key]) {

      latest[key] = r;

    }

  });


  var items =
    Object.keys(latest)
    .map(function (key) {

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
        ] || {
          id:
            String(
              r.loja_id
            ),

          nome:
            String(
              r.loja_id
            )
        };


      var responseJson =
        normalizeJsonObject_(
          r.resposta_json
        );


      var evaluation =
        normalizeJsonObject_(
          responseJson._avaliacao
        );


      var answers = {};


      Object.keys(
        responseJson
      )
      .forEach(function (k) {

        if (
          k !==
          '_avaliacao'
        ) {

          answers[k] =
            responseJson[k];

        }

      });


      return {

        responseId:
          String(r.id),

        demandaId:
          String(
            r.demanda_id
          ),

        demandaTitle:
          d.titulo ||
          'Demanda',

        demandaType:
          d.tipo ||
          'demanda',

        storeId:
          String(
            r.loja_id
          ),

        storeName:
          store.nome ||
          '',

        storeLabel:
          (
            store.codigo
              ? store.codigo +
                ' · '
              : ''
          ) +
          (
            store.nome ||
            store.id ||
            'Loja'
          ),

        userEmail:
          r.usuario_email ||
          '',

        status:
          String(
            r.status ||
            'respondido'
          )
          .toLowerCase(),

        answers:
          answers,

        observacao:
          r.observacao ||
          '',

        createdAt:
          r.created_at ||
          '',

        modelFields:
          normalizeObjectArray_(
            d.model_fields
          ),

        evaluation:
          evaluation
      };

    });


  items.sort(function (a, b) {

    return String(
      b.createdAt || ''
    )
    .localeCompare(
      String(
        a.createdAt || ''
      )
    );

  });


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


function evaluateStoreResponse(input) {

  input =
    input || {};


  var auth =
    getCurrentAuthContext_();


  var user =
    auth.user;


  var role =
    roleOf_(user);


  if (
    role ===
    'loja'
  ) {

    throw new Error(
      'Lojas não podem avaliar respostas.'
    );

  }


  var responseId =
    String(
      input.responseId || ''
    )
    .trim();


  if (!responseId) {

    throw new Error(
      'Resposta não informada.'
    );

  }


  var allowed = [
    'aprovada',
    'ajuste_necessario',
    'reprovada'
  ];


  var status =
    String(
      input.status || ''
    )
    .toLowerCase();


  if (
    allowed.indexOf(
      status
    ) < 0
  ) {

    throw new Error(
      'Selecione uma avaliação válida.'
    );

  }


  var respostasTable =
    table_(
      'TABLE_RESPOSTAS',
      'bacio_demanda_respostas'
    );


  var rows =
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


  if (!rows.length) {

    throw new Error(
      'Resposta não encontrada.'
    );

  }


  var row =
    rows[0];


  var visibleIds =
    getVisibleStores_(user)
    .map(function (s) {

      return String(
        s.id
      );

    });


  if (
    visibleIds.indexOf(
      String(
        row.loja_id || ''
      )
    ) < 0
  ) {

    throw new Error(
      'Você não tem acesso a esta loja.'
    );

  }


  var json =
    normalizeJsonObject_(
      row.resposta_json
    );


  var previous =
    normalizeJsonObject_(
      json._avaliacao
    );


  var history =
    Array.isArray(
      previous.historico
    )
      ? previous.historico.slice()
      : [];


  if (
    previous.status
  ) {

    history.push({

      status:
        previous.status,

      comentario:
        previous.comentario ||
        '',

      avaliado_por:
        previous.avaliado_por ||
        '',

      avaliado_por_email:
        previous.avaliado_por_email ||
        '',

      avaliado_em:
        previous.avaliado_em ||
        ''

    });

  }


  var now =
    new Date()
    .toISOString();


  json._avaliacao = {

    status:
      status,

    comentario:
      String(
        input.comentario ||
        ''
      )
      .trim(),

    avaliado_por:
      user.nome ||
      niceNameFromEmail_(
        auth.email
      ),

    avaliado_por_email:
      auth.email,

    avaliado_em:
      now,

    historico:
      history
  };


  var patched =
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
          status,

        resposta_json:
          json
      },

      'return=representation'

    );


  notifyStoreUsers_(

    String(
      row.loja_id ||
      ''
    ),

    evaluationTitle_(
      status
    ),

    evaluationMessage_(
      status,
      input.comentario
    )

  );


  return {

    ok:
      true,

    avaliacao:
      json._avaliacao,

    row:
      patched &&
      patched[0]
        ? patched[0]
        : null
  };

}


function evaluationTitle_(status) {

  if (
    status ===
    'aprovada'
  ) {

    return (
      'Resposta aprovada'
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
    'Resposta reprovada'
  );

}


function evaluationMessage_(
  status,
  comment
) {

  var base =
    status ===
    'aprovada'
      ? 'Sua resposta foi aprovada pelo escritório.'
      : status ===
        'ajuste_necessario'
        ? 'O escritório solicitou um ajuste na sua resposta.'
        : 'Sua resposta foi reprovada e precisa de revisão.';


  var c =
    String(
      comment || ''
    )
    .trim();


  return c
    ? (
        base +
        ' Comentário: ' +
        c
      )
    : base;

}


/* ================================================================
 * COMUNICADOS
 * ================================================================ */

function saveAnnouncement(input) {

  input =
    input || {};


  requireAdmin_();


  var title =
    String(
      input.title || ''
    )
    .trim();


  if (!title) {

    throw new Error(
      'Informe um título.'
    );

  }


  return saveDemand({

    title:
      title,

    description:
      String(
        input.message || ''
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

  });

}


/* ================================================================
 * LOJA MANUAL
 * ================================================================ */

function saveStoreManual(input) {

  input =
    input || {};


  requireAdmin_();


  var nome =
    String(
      input.nome || ''
    )
    .trim();


  var codigo =
    String(
      input.codigo || ''
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
        input.email || ''
      )
      .trim() ||
      null,

    cidade:
      String(
        input.cidade || ''
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
          input.regional || ''
        )
        .trim(),

      consultor:
        String(
          input.consultor || ''
        )
        .trim(),

      estado:
        String(
          input.estado || ''
        )
        .trim(),

      formato:
        String(
          input.formato || ''
        )
        .trim(),

      delivery:
        String(
          input.delivery || ''
        )
        .trim(),

      endereco:
        String(
          input.endereco || ''
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


function importStoreBaseComplete(input) {

  requireAdmin_();


  var result =
    importarBaseLojas(
      input || {}
    );


  syncStoreScopeIdsFromExtras_();


  return result;

}


function syncStoreScopeIdsFromExtras_() {

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
          extras.regional || ''
        )
        .trim();


      var consultor =
        String(
          extras.consultor || ''
        )
        .trim();


      var patch = {};


      if (
        regional &&
        String(
          row.regional_id ||
          ''
        ) !== regional
      ) {

        patch.regional_id =
          regional;

      }


      if (
        consultor &&
        String(
          row.consultor_id ||
          ''
        ) !== consultor
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


/* ================================================================
 * CHAT CONTEXTUAL
 *
 * Mantém a tabela atual.
 * O contexto é salvo como um prefixo interno na mensagem.
 * ================================================================ */

function getChatWorkspace() {

  var auth =
    getCurrentAuthContext_();


  var user =
    auth.user;


  var role =
    roleOf_(user);


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


  var demandasTable =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );


  var demandas =
    safeSupabaseSelect_(

      '/rest/v1/' +
        demandasTable +
        '?select=*&ativa=eq.true&order=created_at.desc&limit=500',

      []

    )
    .filter(
      function (d) {

        if (
          String(
            d.status || ''
          )
          .toLowerCase() ===
            'draft' &&
          role !==
            'admin'
        ) {

          return false;

        }


        return demandaVisivelNoEscopo_(

          d,

          visibleIds

        );

      }
    );


  var threads =
    demandas

      .filter(
        function (d) {

          return (
            String(
              d.tipo || ''
            )
            .toLowerCase() !==
            'comunicado'
          );

        }
      )

      .map(
        function (d) {

          return {

            id:
              String(
                d.id
              ),

            title:
              d.titulo ||
              'Demanda',

            subtitle:
              (
                String(
                  d.tipo ||
                  'demanda'
                )
                .toLowerCase() ===
                'campanha'
                  ? 'Campanha'
                  : 'Demanda'
              ) +

              (
                d.prazo_sla
                  ? (
                      ' · prazo ' +
                      formatShortDate_(
                        d.prazo_sla
                      )
                    )
                  : ''
              )
          };

        }
      );


  if (
    role !==
    'loja'
  ) {

    threads.unshift({

      id:
        'geral',

      title:
        'Operação geral',

      subtitle:
        'Conversa sem vínculo com uma demanda específica'

    });

  }


  return {
    threads:
      threads
  };

}


function getChatMessages(input) {

  input =
    input || {};


  var auth =
    getCurrentAuthContext_();


  var user =
    auth.user;


  var role =
    roleOf_(user);


  var threadId =
    String(
      input.threadId || ''
    )
    .trim();


  if (!threadId) {

    throw new Error(
      'Conversa não informada.'
    );

  }


  if (
    threadId !==
    'geral'
  ) {

    assertDemandAccess_(
      threadId,
      user
    );

  }


  if (
    threadId ===
      'geral' &&
    role ===
      'loja'
  ) {

    throw new Error(
      'Conversa geral indisponível para lojas.'
    );

  }


  var table =
    table_(
      'TABLE_CHAT',
      'bacio_chat_mensagens'
    );


  var rows =
    safeSupabaseSelect_(

      '/rest/v1/' +
        table +
        '?select=*&order=created_at.asc&limit=1000',

      []

    );


  var visibleIds =
    getVisibleStores_(user)
    .map(function (s) {

      return String(
        s.id
      );

    });


  return rows

    .filter(
      function (r) {

        var parsed =
          parseChatMessage_(
            r.mensagem ||
            ''
          );


        if (
          threadId ===
          'geral'
        ) {

          if (
            parsed.contextId
          ) {

            return false;

          }


          if (
            role ===
            'admin'
          ) {

            return true;

          }


          if (
            !r.loja_id
          ) {

            return true;

          }


          return (
            visibleIds.indexOf(
              String(
                r.loja_id
              )
            ) >= 0
          );

        }


        return (
          String(
            parsed.contextId ||
            ''
          ) ===
          threadId
        );

      }
    )

    .map(
      function (r) {

        var parsed =
          parseChatMessage_(
            r.mensagem ||
            ''
          );


        return {

          id:
            String(
              r.id
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
            r.loja_id ||
            null,

          message:
            parsed.message,

          createdAt:
            r.created_at ||
            ''
        };

      }
    );

}


function sendContextChatMessage(input) {

  input =
    input || {};


  var auth =
    getCurrentAuthContext_();


  var user =
    auth.user;


  var role =
    roleOf_(user);


  var threadId =
    String(
      input.threadId || ''
    )
    .trim();


  var message =
    String(
      input.message || ''
    )
    .trim();


  if (!threadId) {

    throw new Error(
      'Conversa não informada.'
    );

  }


  if (!message) {

    throw new Error(
      'Digite uma mensagem.'
    );

  }


  if (
    threadId !==
    'geral'
  ) {

    assertDemandAccess_(
      threadId,
      user
    );

  }


  if (
    threadId ===
      'geral' &&
    role ===
      'loja'
  ) {

    throw new Error(
      'Conversa geral indisponível para lojas.'
    );

  }


  var table =
    table_(
      'TABLE_CHAT',
      'bacio_chat_mensagens'
    );


  var storedMessage =
    threadId ===
    'geral'
      ? message
      : (
          chatContextPrefix_(
            threadId
          ) +
          message
        );


  var payload = {

    usuario_email:
      auth.email,

    usuario_nome:
      user.nome ||
      niceNameFromEmail_(
        auth.email
      ),

    role:
      role,

    loja_id:
      user.loja_id ||
      user.lojaId ||
      null,

    mensagem:
      storedMessage,

    created_at:
      new Date()
      .toISOString()
  };


  var inserted =
    supabaseRequest_(

      '/rest/v1/' +
        table,

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


function chatContextPrefix_(id) {

  return (
    '[[BACIOCTX:' +
    String(id) +
    ']] '
  );

}


function parseChatMessage_(value) {

  var text =
    String(
      value || ''
    );


  var match =
    text.match(
      /^\[\[BACIOCTX:([^\]]+)\]\]\s*/
    );


  if (!match) {

    return {
      contextId: '',
      message: text
    };

  }


  return {

    contextId:
      String(
        match[1]
      ),

    message:
      text.slice(
        match[0].length
      )
  };

}


function assertDemandAccess_(
  demandId,
  user
) {

  var table =
    table_(
      'TABLE_DEMANDAS',
      'bacio_demandas'
    );


  var rows =
    supabaseRequest_(

      '/rest/v1/' +
        table +
        '?select=*&id=eq.' +
        encodeURIComponent(
          String(
            demandId
          )
        ) +
        '&limit=1',

      'get'

    ) || [];


  if (!rows.length) {

    throw new Error(
      'Demanda não encontrada.'
    );

  }


  var visibleIds =
    getVisibleStores_(user)
    .map(function (s) {

      return String(
        s.id
      );

    });


  if (
    !demandaVisivelNoEscopo_(
      rows[0],
      visibleIds
    )
  ) {

    throw new Error(
      'Você não tem acesso a esta conversa.'
    );

  }


  return rows[0];

}


/* ================================================================
 * NOTIFICAÇÕES
 * ================================================================ */

function markAllNotificationsRead() {

  var auth =
    getCurrentAuthContext_();


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
        auth.email
      ) +
      '&lida=eq.false',

    'patch',

    {
      lida: true
    },

    'return=minimal'

  );


  return {
    ok: true
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


function notifyStoreUsers_(
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
        '?select=*&ativo=eq.true&loja_id=eq.' +
        encodeURIComponent(
          storeId
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


/* ================================================================
 * LEMBRETES AUTOMÁTICOS
 *
 * Execute instalarGatilhoLembretes() uma única vez no editor.
 * ================================================================ */

function instalarGatilhoLembretes() {

  requireAdmin_();


  removeReminderTriggers_();


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


  var removed =
    removeReminderTriggers_();


  return {

    ok:
      true,

    removidos:
      removed
  };

}


function removeReminderTriggers_() {

  var removed =
    0;


  ScriptApp
    .getProjectTriggers()
    .forEach(
      function (trigger) {

        if (
          trigger.getHandlerFunction() ===
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
        '?select=*&ativa=eq.true&order=created_at.desc&limit=2000',

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
        '?select=*&ativo=eq.true',

      []

    );


  var lojas =
    safeSupabaseSelect_(

      '/rest/v1/' +
        lojasTable +
        '?select=id&ativa=eq.true',

      []

    );


  var allStoreIds =
    lojas.map(
      function (l) {

        return String(
          l.id
        );

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


      if (
        !targetIds.length
      ) {

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
        validDate_(
          d.publicada_em
        );


      var deadline =
        validDate_(
          d.prazo_sla
        );


      var endAt =
        validDate_(
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
          'Nova ' +
          (
            String(
              d.tipo || ''
            )
            .toLowerCase() ===
            'campanha'
              ? 'campanha'
              : String(
                  d.tipo || ''
                )
                .toLowerCase() ===
                'comunicado'
                ? 'comunicação'
                : 'demanda'
          );


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
          reminderEnabled_(
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
          reminderEnabled_(
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
          reminderEnabled_(
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

            if (
              String(
                u.role ||
                ''
              )
              .toLowerCase() !==
              'loja'
            ) {

              return false;

            }


            var sid =
              String(
                u.loja_id ||
                ''
              );


            if (
              !targetMap[
                sid
              ]
            ) {

              return false;

            }


            if (
              !onlyPending
            ) {

              return true;

            }


            var last =
              latest[
                sid
              ];


            return (
              !responseCountsAsComplete_(
                last
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


  return {

    ok:
      true,

    notificacoesCriadas:
      created,

    executadoEm:
      now.toISOString()
  };

}


function reminderEnabled_(
  reminders,
  type
) {

  return (
    reminders || []
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
          (r || {}).tipo ||
          ''
        ) ===
          type &&

        r.ativo !==
          false
      );

    }
  );

}


function responseCountsAsComplete_(row) {

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


function validDate_(value) {

  if (!value) {

    return null;

  }


  var d =
    new Date(value);


  return isNaN(
    d.getTime()
  )
    ? null
    : d;

}

/**
 * BR-065 — Conecta | Entregas e Pedidos (somente consulta).
 *
 * Mesma estrutura de dados do CalendarioExpedicao.js do Prisma:
 *   CALENDÁRIO: cabeçalho na linha 4, dados a partir da 5;
 *   PRISMA_CE_*: versão normalizada, 8 colunas, cabeçalho na linha 1.
 *
 * O Prisma usa versão ativa em propriedades do próprio Apps Script, que não
 * são compartilhadas com este projeto. Portanto a equipe configura no Conecta
 * tanto o ID da planilha privada como a ABA ATIVA validada no Prisma.
 * A versão NÃO é deduzida pelo nome do arquivo ou pela última aba.
 *
 * Nunca colocar IDs privados, tokens ou credenciais no repositório/cliente.
 * Não escreve na planilha, no Supabase, no Prisma nem no calendário operacional.
 */

var CONECTA_ENTREGA_SHEET_PROPERTY_ = 'CONECTA_PRISMA_EXPEDICAO_SHEET_ID';
var CONECTA_ENTREGA_TAB_PROPERTY_ = 'CONECTA_PRISMA_EXPEDICAO_ABA_ATIVA';
var CONECTA_ENTREGA_TTL_SECONDS_ = 900;

function conectaEntregaMes_(month) {
  var m = /^(20\d{2})-(0[1-9]|1[0-2])$/.exec(String(month || ''));
  if (!m) throw new Error('Selecione um mês válido.');
  return m[0];
}

function conectaEntregaCodigo_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  var m = /^(?:LJ\s*)?0*(\d{1,4})(?:\s*[-–].*)?$/i.exec(s);
  return m ? ('0000' + m[1]).slice(-4) : '';
}

function conectaEntregaData_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return Utilities.formatDate(raw, 'America/Sao_Paulo', 'yyyy-MM-dd');
  }
  if (typeof raw === 'number' && isFinite(raw) && raw > 25000 && raw < 90000) {
    return Utilities.formatDate(
      new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86400000),
      'UTC', 'yyyy-MM-dd'
    );
  }
  var s = String(raw == null ? '' : raw).trim();
  if (/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s)) return s;
  var m = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/.exec(s);
  return m ? m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0') : '';
}

function conectaEntregaLojasVisiveis_(user) {
  var seen = Object.create(null);
  var stores = getVisibleStores_(user) || [];
  return stores.filter(function(s) {
    return s && s.ativa !== false && !isConectaTestStoreId_(s.id);
  }).map(function(s) {
    var codigo = conectaEntregaCodigo_(s.codigo) || conectaEntregaCodigo_(s.nome);
    if (!codigo || seen[codigo]) return null;
    seen[codigo] = true;
    return {codigo:codigo, nome:String(s.nome || ('Loja ' + codigo))};
  }).filter(Boolean).sort(function(a,b) {
    return a.codigo.localeCompare(b.codigo);
  });
}

function conectaEntregaRegistro_(row, normalized) {
  if (normalized) {
    return {
      codigo:conectaEntregaCodigo_(row[2]),
      tipo:String(row[1] || '').trim().toUpperCase(),
      pedido:conectaEntregaData_(row[0]),
      separacao:conectaEntregaData_(row[5]),
      carregamento:conectaEntregaData_(row[6]),
      entrega:conectaEntregaData_(row[7]),
      rota:String(row[4] || '').trim()
    };
  }
  return {
    codigo:conectaEntregaCodigo_(row[3]),
    tipo:String(row[2] || '').trim().toUpperCase(),
    pedido:conectaEntregaData_(row[0]),
    separacao:conectaEntregaData_(row[10]),
    carregamento:conectaEntregaData_(row[12]),
    entrega:conectaEntregaData_(row[14]),
    rota:String(row[7] || '').trim()
  };
}

function conectaEntregaLerPlanilha_(sheet, month, code, tab) {
  var normalized = /^PRISMA_CE_[A-Za-z0-9_]+$/.test(tab);
  var first = normalized ? 2 : 5;
  var width = normalized ? 8 : 15;
  var head = sheet.getRange(normalized ? 1 : 4, 1, 1, normalized ? 8 : 16)
    .getDisplayValues()[0] || [];
  if (normalized) {
    if (String(head[0]).trim() !== 'PEDIDO' || String(head[7]).trim() !== 'ENTREGA') {
      throw new Error('O formato normalizado do calendário foi alterado.');
    }
  } else if (!/tipologia/i.test(String(head[2])) ||
             !/lojas/i.test(String(head[3])) ||
             !/DD\/MM\/AA/i.test(String(head[14]))) {
    throw new Error('O formato do calendário-base foi alterado.');
  }
  var total = Math.max(0,sheet.getLastRow()-first+1);
  if (total > 30000) throw new Error('O calendário ultrapassou o limite de consulta.');
  var rows = total ? sheet.getRange(first,1,total,width).getValues() : [];
  var dedupe = Object.create(null),result=[];
  rows.forEach(function(row) {
    var r = conectaEntregaRegistro_(row,normalized);
    if (r.codigo !== code || r.entrega.slice(0,7) !== month ||
        !/^(SECO|CONGELADO)$/.test(r.tipo)) return;
    var key=[r.codigo,r.pedido,r.entrega,r.tipo,r.rota].join('|');
    if (dedupe[key]) return;
    dedupe[key]=true;
    result.push({
      pedido:r.pedido,separacao:r.separacao,carregamento:r.carregamento,
      entrega:r.entrega,tipo:r.tipo,rota:r.rota
    });
  });
  result.sort(function(a,b) {
    return a.entrega.localeCompare(b.entrega) ||
      a.tipo.localeCompare(b.tipo) || a.pedido.localeCompare(b.pedido);
  });
  return result;
}

function conectaEntregaWorkspace_(user, month, requestedCode) {
  var ref = conectaEntregaMes_(month);
  var stores = conectaEntregaLojasVisiveis_(user);
  var code = conectaEntregaCodigo_(requestedCode);
  var base = {month:ref,codigo:code,stores:stores,records:[],
    source:'Prisma Expedição',readOnly:true};

  if (!stores.length) return Object.assign(base,{status:'no_access'});
  // Uma loja só escolhe a própria unidade; gestão escolhe explicitamente uma loja.
  if (!code && roleOf_(user)==='loja' && stores.length===1) code=stores[0].codigo;
  if (!code) return Object.assign(base,{status:'select_store'});
  var store = stores.filter(function(s){return s.codigo===code;})[0];
  if (!store) throw new Error('Acesso a esta loja não autorizado.');
  base.codigo=code;
  base.nome=store.nome;

  var props = PropertiesService.getScriptProperties();
  var sheetId = String(props.getProperty(CONECTA_ENTREGA_SHEET_PROPERTY_)||'').trim();
  var tab = String(props.getProperty(CONECTA_ENTREGA_TAB_PROPERTY_)||'').trim();
  if (!sheetId || !tab) return Object.assign(base,{status:'unconfigured'});
  // Sem descoberta automática de "última versão": impede exibir um espelho antigo
  // como se tivesse sido sincronizado com o Excel original.
  if (tab !== 'CALENDÁRIO' && !/^PRISMA_CE_[A-Za-z0-9_]+$/.test(tab)) {
    return Object.assign(base,{status:'source_unavailable'});
  }

  var cache = CacheService.getScriptCache();
  var key = 'conecta_entregas_v1_'+sheetId.slice(-10)+'_'+tab+'_'+ref+'_'+code;
  try {
    var cached=cache.get(key);
    if(cached) {
      var records=JSON.parse(cached);
      if(Array.isArray(records))return Object.assign(base,
        {status:'ok',sourceVersion:tab,records:records});
    }
  } catch (ignoreCache) {}
  // Diagnóstico limitado a categorias públicas de falha.
  // Não devolver IDs privados, credenciais nem mensagens internas do Google.
  var sheet;
  try {
    var spreadsheet=SpreadsheetApp.openById(sheetId);
    sheet=spreadsheet.getSheetByName(tab);
  } catch (openError) {
    console.log('Conecta Entregas [BR-067]: falha ao abrir origem configurada.');
    return Object.assign(base,{status:'source_open_failed'});
  }
  if (!sheet) return Object.assign(base,{status:'source_tab_missing'});

  var records;
  try {
    records=conectaEntregaLerPlanilha_(sheet,ref,code,tab);
  } catch (readError) {
    var message=String(readError && readError.message || '');
    var invalidFormat=/^O formato (normalizado|do calendário-base) foi alterado\./.test(message);
    console.log('Conecta Entregas [BR-067]: falha de leitura ('+
      (invalidFormat?'formato':'outra')+').');
    return Object.assign(base,{status:invalidFormat?'source_format_mismatch':'source_read_failed'});
  }
  try {
    var serialized=JSON.stringify(records);
    if (serialized.length<95000)cache.put(key,serialized,CONECTA_ENTREGA_TTL_SECONDS_);
  } catch (ignoreCacheWrite) {}
  return Object.assign(base,{status:'ok',sourceVersion:tab,records:records});
}

function getConectaDeliveryCalendar(month,storeCode) {
  var auth=getCurrentAuthContext_();
  if (!auth || !auth.user) throw new Error('Acesso não autorizado.');
  return conectaEntregaWorkspace_(auth.user,month,storeCode);
}

function getStoreConectaDeliveryCalendar(accessToken,month,storeCode) {
  var auth=getStoreAuthContext_(accessToken);
  if (!auth || !auth.user) throw new Error('Acesso não autorizado.');
  return conectaEntregaWorkspace_(auth.user,month,storeCode);
}


/**
 * BR-067 — Teste manual, somente leitura, executável no editor do Apps Script.
 * Executar como a conta corporativa responsável pelo projeto para conceder
 * as permissões do Google quando solicitadas. A função não retorna IDs nem
 * dados de lojas, e não altera nenhuma propriedade ou documento.
 */
function validarAcessoExpedicaoConecta() {
  var auth=getCurrentAuthContext_();
  if (!auth || !auth.user || roleOf_(auth.user)!=='admin') {
    throw new Error('Este teste está disponível somente para administradores autenticados.');
  }
  var props=PropertiesService.getScriptProperties();
  var id=String(props.getProperty(CONECTA_ENTREGA_SHEET_PROPERTY_)||'').trim();
  var aba=String(props.getProperty(CONECTA_ENTREGA_TAB_PROPERTY_)||'').trim();
  if (!id || !aba) {
    console.log('Conecta Entregas: falta configurar ID ou aba ativa nas propriedades do script.');
    return {status:'unconfigured',ok:false};
  }
  if (aba!=='CALENDÁRIO'&&!/^PRISMA_CE_[A-Za-z0-9_]+$/.test(aba)) {
    console.log('Conecta Entregas: nome da aba ativa inválido.');
    return {status:'source_unavailable',ok:false};
  }
  var planilha;
  try {
    planilha=SpreadsheetApp.openById(id);
  } catch (err) {
    console.log('Conecta Entregas: falha ao abrir a planilha. Confira conta autorizada, ID e consentimento OAuth.');
    return {status:'source_open_failed',ok:false};
  }
  var sheet=planilha.getSheetByName(aba);
  if (!sheet) {
    console.log('Conecta Entregas: aba ativa não encontrada na origem.');
    return {status:'source_tab_missing',ok:false};
  }
  try {
    var normalizada=/^PRISMA_CE_[A-Za-z0-9_]+$/.test(aba);
    var header=sheet.getRange(normalizada?1:4,1,1,normalizada?8:16)
      .getDisplayValues()[0]||[];
    var valido=normalizada
      ? String(header[0]).trim()==='PEDIDO'&&String(header[7]).trim()==='ENTREGA'
      : /tipologia/i.test(String(header[2]))&&/lojas/i.test(String(header[3]))&&
        /DD\/MM\/AA/i.test(String(header[14]));
    if (!valido) {
      console.log('Conecta Entregas: cabeçalhos não correspondem ao calendário esperado.');
      return {status:'source_format_mismatch',ok:false};
    }
  } catch (err) {
    console.log('Conecta Entregas: falha na leitura da aba configurada.');
    return {status:'source_read_failed',ok:false};
  }
  console.log('Conecta Entregas: leitura autorizada e formato da aba validado com sucesso.');
  return {status:'ok',ok:true};
}

/**
 * BR-064 — Calendário Promocional do Conecta (somente leitura).
 *
 * Fonte de verdade: mesma planilha mensal utilizada pelo Growth do Prisma.
 * IMPORTANTE: o ID da planilha é uma propriedade privada do Apps Script,
 * "CONECTA_PRISMA_GROWTH_SHEET_ID" (sem ID/credencial no GitHub).
 *
 * Reproduz a regra de vigência do Growth: linha 6+, colunas C/D/E para
 * tipo/canais/nome, dias a partir de G, cor da célula > 12 unidades mais
 * escura que a cor-base do nome; "x" cancela o dia, linhas ocultas são
 * ignoradas e promoções com o mesmo nome são agrupadas.
 * Não modifica a planilha, o Prisma nem os calendários existentes.
 */

var CONECTA_PROMO_MESES_=['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
var CONECTA_PROMO_PROPERTY_='CONECTA_PRISMA_GROWTH_SHEET_ID';
var CONECTA_PROMO_CACHE_SECONDS_=900; // Mesma janela de 15 minutos do Growth.

function conectaPromoMes_(month){
  var match=/^(20\d{2})-(0[1-9]|1[0-2])$/.exec(String(month||''));
  if(!match)throw new Error('Mês promocional inválido.');
  var year=Number(match[1]),index=Number(match[2])-1;
  if(year<2026||(year===2026&&index<5))return null; // Regra Prisma: junho/2026 em diante.
  return {year:year,index:index,ref:match[0],sheetName:CONECTA_PROMO_MESES_[index]+' '+year};
}
function conectaPromoCorNormalizada_(color){
  var s=String(color||'').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s)?s:'';
}
function conectaPromoBrilho_(hex){
  if(!hex)return null;
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000;
}
function conectaPromoDiaAtivo_(color,baseColor,baseBrightness){
  var day=conectaPromoCorNormalizada_(color);
  if(!day||day==='#ffffff'||!baseColor||day===baseColor||baseBrightness===null)return false;
  var brightness=conectaPromoBrilho_(day);
  return brightness!==null&&baseBrightness-brightness>=12;
}
function conectaPromoValorMarcado_(value){
  if(value===true)return true;
  var s=String(value||'').trim().toUpperCase();
  return ['','-','FALSE','FALSO','0','NÃO','NAO','N'].indexOf(s)<0;
}
function conectaPromoUnirDias_(oldDays,newDays){
  var seen={};return (oldDays||[]).concat(newDays||[]).map(Number)
    .filter(function(d){if(!Number.isInteger(d)||seen[d])return false;seen[d]=true;return true;})
    .sort(function(a,b){return a-b;});
}
function conectaPromoLerLinhas_(sheet,period){
  var firstRow=6,firstCol=3,dayCol=7;
  var lastRow=sheet.getLastRow(),totalDays=new Date(period.year,period.index+1,0).getDate();
  if(lastRow<firstRow)return [];
  // O Prisma identifica "Corriere" no cabeçalho 4–5 e usa AL como fallback.
  var searchCols=Math.min(sheet.getLastColumn(),100),corriereCol=38;
  if(searchCols>0){
    var headers=sheet.getRange(4,1,2,searchCols).getDisplayValues();
    outer:for(var i=0;i<headers.length;i++){
      for(var j=0;j<headers[i].length;j++){
        if(String(headers[i][j]||'').trim().toLowerCase()==='corriere'){
          corriereCol=j+1;break outer;
        }
      }
    }
  }
  var lastNeeded=Math.max(dayCol+totalDays-1,corriereCol);
  var range=sheet.getRange(firstRow,firstCol,lastRow-firstRow+1,lastNeeded-firstCol+1);
  var values=range.getValues(),colors=range.getBackgrounds(),idxName=2,idxDay=dayCol-firstCol,idxCorriere=corriereCol-firstCol;
  var byName={};
  for(var row=0;row<values.length;row++){
    var data=values[row]||[],name=String(data[idxName]||'').trim();
    if(!name)continue;
    if(sheet.isRowHiddenByUser(firstRow+row)||sheet.isRowHiddenByFilter(firstRow+row))continue;
    var base=conectaPromoCorNormalizada_((colors[row]||[])[idxName]);
    var brightness=conectaPromoBrilho_(base);
    var active=[],cancelled=[];
    for(var day=0;day<totalDays;day++){
      var v=String(data[idxDay+day]||'').trim().toLowerCase();
      if(v==='x'){cancelled.push(day+1);continue;}
      if(conectaPromoDiaAtivo_((colors[row]||[])[idxDay+day],base,brightness))active.push(day+1);
    }
    var key=name.toUpperCase();
    var marked=conectaPromoValorMarcado_(data[idxCorriere]);
    if(!byName[key]){
      byName[key]={nome:name,tipo:String(data[0]||''),canais:String(data[1]||''),
        diasAtivos:active,diasCancelados:cancelled,corriere:marked};
    }else{
      byName[key].diasAtivos=conectaPromoUnirDias_(byName[key].diasAtivos,active);
      byName[key].diasCancelados=conectaPromoUnirDias_(byName[key].diasCancelados,cancelled);
      if(marked)byName[key].corriere=true;
    }
  }
  return Object.keys(byName).map(function(k){return byName[k];});
}
function conectaPromoWorkspace_(ref){
  var period=conectaPromoMes_(ref);
  if(!period)return {status:'month_unavailable',month:String(ref||''),promotions:[],source:'Prisma Growth'};
  // Configurar no Apps Script pelo administrador. Nunca publicar o ID no GitHub.
  var config=PropertiesService.getScriptProperties();
  var sheetId=String(config.getProperty(CONECTA_PROMO_PROPERTY_)||'').trim();
  if(!sheetId)return {status:'unconfigured',month:period.ref,promotions:[],source:'Prisma Growth'};
  var cache=CacheService.getScriptCache();
  var key='conecta_growth_v1_'+period.ref+'_'+sheetId.slice(-6);
  try{
    var cached=cache.get(key);
    if(cached){var parsed=JSON.parse(cached);if(parsed&&parsed.status==='ok')return parsed;}
  }catch(ignoreCache){}
  try{
    var spreadsheet=SpreadsheetApp.openById(sheetId);
    var sheet=spreadsheet.getSheetByName(period.sheetName);
    if(!sheet)return {status:'month_unavailable',month:period.ref,promotions:[],source:'Prisma Growth'};
    var promotions=conectaPromoLerLinhas_(sheet,period);
    var out={status:'ok',month:period.ref,promotions:promotions,
      generatedAt:new Date().toISOString(),source:'Prisma Growth'};
    try{
      var serialized=JSON.stringify(out);
      if(serialized.length<95000)cache.put(key,serialized,CONECTA_PROMO_CACHE_SECONDS_);
    }catch(ignoreCacheWrite){}
    return out;
  }catch(e){
    // Não vazar ID, contas, planilha ou erros de autorização ao navegador.
    console.log('Calendário promocional: fonte não acessível à execução do Conecta.');
    return {status:'source_unavailable',month:period.ref,promotions:[],source:'Prisma Growth'};
  }
}
function getPrismaPromotionalCalendar(month){
  var ctx=getCurrentAuthContext_();
  if(!ctx||!ctx.user)throw new Error('Acesso não autorizado.');
  return conectaPromoWorkspace_(month);
}
function getStorePrismaPromotionalCalendar(accessToken,month){
  var ctx=getStoreAuthContext_(accessToken);
  if(!ctx||!ctx.user)throw new Error('Acesso não autorizado.');
  return conectaPromoWorkspace_(month);
}

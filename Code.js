/**
 * BACIO CONECTA V2 — ENTRADA DO WEB APP
 *
 * Duas implantações, mesmo projeto:
 * 1) Escritório: execute como "Usuário que acessa" e use a URL normal.
 * 2) Lojas: execute como "Eu" e compartilhe a URL acrescentando ?view=loja.
 *
 * Toda a lógica de dados continua em Supabase.gs + Features_V2.gs.
 */

const DOMINIO_PERMITIDO = 'bdil.com.br';

function doGet(e) {
  var view = String(
    e && e.parameter && e.parameter.view
      ? e.parameter.view
      : 'escritorio'
  ).trim().toLowerCase();

  var portalMode = view === 'loja' ? 'loja' : 'escritorio';

  var template = HtmlService.createTemplateFromFile('Index');

  template.portalMode = portalMode;

  return template
    .evaluate()
    .setTitle(
      portalMode === 'loja'
        ? 'Bacio Conecta — Lojas'
        : 'Bacio Conecta'
    )
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1.0'
    )
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
}


function include(nomeArquivo) {
  return HtmlService
    .createHtmlOutputFromFile(nomeArquivo)
    .getContent();
}


function validateAllowedDomain_(email) {

  email = String(email || '')
    .trim()
    .toLowerCase();

  if (!email) {

    throw new Error(
      'Não foi possível identificar seu e-mail corporativo. ' +
      'Acesse o Bacio Conecta com sua conta Google da empresa.'
    );

  }

  if (
    !email.endsWith(
      '@' + DOMINIO_PERMITIDO
    )
  ) {

    throw new Error(
      'Acesso permitido somente para contas corporativas @' +
      DOMINIO_PERMITIDO +
      '.'
    );

  }

  return true;
}


function getBootstrapData() {

  var email = String(
    Session
      .getActiveUser()
      .getEmail() || ''
  )
    .trim()
    .toLowerCase();

  validateAllowedDomain_(email);

  var props =
    PropertiesService
      .getScriptProperties();

  var demoMode = String(
    props.getProperty(
      'DEMO_MODE'
    ) || 'false'
  )
    .trim()
    .toLowerCase() === 'true';

  if (
    demoMode &&
    typeof getDemoBootstrap_ ===
      'function'
  ) {

    return getDemoBootstrap_(
      email
    );

  }

  if (
    typeof getRealBootstrap_ !==
    'function'
  ) {

    throw new Error(
      'A função getRealBootstrap_ não foi encontrada. ' +
      'Confira se o arquivo Supabase.gs está no mesmo projeto.'
    );

  }

  return getRealBootstrap_(
    email
  );
}


function testarBootstrap() {

  var dados =
    getBootstrapData();

  console.log(
    JSON.stringify(
      {
        ok: true,

        mode:
          dados &&
          dados.mode,

        user:
          dados &&
          dados.user

            ? {
                nome:
                  dados.user.nome,

                email:
                  dados.user.email,

                role:
                  dados.user.role ||
                  dados.user.perfil
              }

            : null,

        stores:
          dados &&
          Array.isArray(
            dados.stores
          )

            ? dados.stores.length

            : null,

        generatedAt:
          dados &&
          dados.generatedAt
      },
      null,
      2
    )
  );

  return dados;
}
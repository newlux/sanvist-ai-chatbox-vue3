var langs = {
  zh_CN: { title: "抱歉，页面出错了", content: "请刷新页面，访问最新版本", btn: "刷新页面" },
  en_US: {
    title: "Sorry, the page is wrong",
    content: "Please refresh the page and visit the latest version",
    btn: "Refresh page",
  },
  ar_ST: {
    title: "عذرًا، حدث خطأ في الصفحة",
    content: "يرجى تحديث الصفحة للوصول إلى أحدث إصدار",
    btn: "تحديث الصفحة",
  },
  es_ES: {
    title: "Lo sentimos, la página tiene un error",
    content: "Por favor, actualiza la página para acceder a la última versión",
    btn: "Actualizar página",
  },
  fr_FR: {
    title: "Désolé, une erreur est survenue sur la page",
    content: "Veuillez actualiser la page pour accéder à la dernière version",
    btn: "Actualiser la page",
  },
  id_ID: {
    title: "Maaf, halaman mengalami kesalahan",
    content: "Silakan segarkan halaman untuk mengakses versi terbaru",
    btn: "Segarkan halaman",
  },
  pt_PT: {
    title: "Desculpe, ocorreu um erro na página",
    content: "Por favor, atualize a página para acessar a versão mais recente",
    btn: "Atualizar página",
  },
  ru_RU: {
    title: "Извините, произошла ошибка страницы",
    content: "Пожалуйста, обновите страницу, чтобы получить последнюю версию",
    btn: "Обновить страницу",
  },
  th_TH: {
    title: "ขออภัย หน้าเว็บมีข้อผิดพลาด",
    content: "กรุณาโหลดหน้าใหม่เพื่อเข้าถึงเวอร์ชันล่าสุด",
    btn: "โหลดหน้าใหม่",
  },
  de_DE: {
    title: "Entschuldigung, die Seite ist fehlerhaft",
    content: "Bitte laden Sie die Seite neu, um die neueste Version aufzurufen",
    btn: "Seite neu laden",
  },
  it_IT: {
    title: "Spiacente, si è verificato un errore nella pagina",
    content: "Aggiorna la pagina per accedere all'ultima versione",
    btn: "Aggiorna pagina",
  },
  km_KH: {
    title: "កំហុសមួយបានកើតឡើងនៅលើទំព័រ",
    content: "សូមធ្វើការ Refresh ទំព័រដើម្បីប្រើប្រាស់វ៉ឺរ្កូដថ្មីៗបំផុត",
    btn: "ធ្វើការ Refresh ទំព័រ",
  },
  ko_KR: {
    title: "죄송합니다. 페이지에 오류가 발생했습니다.",
    content: "최신 버전을 확인하시려면 페이지를 새로고침 해주세요",
    btn: "페이지 새로고침",
  },
};

var thatLang = "en_US";

function getQueryParams(query) {
  return String(query || "")
    .replace(/^\?/, "")
    .split("&")
    .reduce(function (params, pair) {
      var separator = pair.indexOf("=");
      var key = separator === -1 ? pair : pair.slice(0, separator);
      var value = separator === -1 ? "" : pair.slice(separator + 1);

      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value);
      return params;
    }, {});
}

function setLanguageFromBridge() {
  if (!window.AlipayJSBridge || !window.AlipayJSBridge.startupParams) return;

  var query = getQueryParams(window.AlipayJSBridge.startupParams.query);
  if (langs[query.Lang]) thatLang = query.Lang;
}

if (window.AlipayJSBridge) setLanguageFromBridge();
document.addEventListener("AlipayJSBridgeReady", setLanguageFromBridge, false);

function handleScriptError(resource) {
  console.error("Static resource load error:", resource);

  setTimeout(function () {
    if (document.querySelector(".m-4044")) return;

    var langConfig = langs[thatLang] || langs.en_US;
    var errorDiv = document.createElement("div");
    errorDiv.className = "m-4044";
    errorDiv.innerHTML =
      "<h3>" +
      langConfig.title +
      "</h3>" +
      "<p>" +
      langConfig.content +
      "</p>" +
      "<button type='button' onclick='location.reload()'>" +
      langConfig.btn +
      "</button>";
    document.body.appendChild(errorDiv);
  }, 1000);
}

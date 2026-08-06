import hookFetch from "hook-fetch";
import { createI18n } from "vue-i18n";
import ar from "./lang/ar.json";
import deDE from "./lang/de_DE.json";
import enUS from "./lang/en_US.json";
import esES from "./lang/es_ES.json";
import frFR from "./lang/fr_FR.json";
import idID from "./lang/id_ID.json";
import itIT from "./lang/it_IT.json";
import kmKH from "./lang/km_KH.json";
import koKR from "./lang/ko_KR.json";
import msMY from "./lang/ms_MY.json";
import ptPT from "./lang/pt_PT.json";
import ruRU from "./lang/ru_RU.json";
import thTH from "./lang/th_TH.json";
import viVN from "./lang/vi_VN.json";
import zhCN from "./lang/zh_CN.json";

export const defaultLocale = "zh_CN";
export const fallbackLocale = "en_US";

export const messages = {
  ar_ST: ar,
  de_DE: deDE,
  en_US: enUS,
  es_ES: esES,
  fr_FR: frFR,
  id_ID: idID,
  it_IT: itIT,
  km_KH: kmKH,
  ko_KR: koKR,
  ms_MY: msMY,
  pt_PT: ptPT,
  ru_RU: ruRU,
  th_TH: thTH,
  vi_VN: viVN,
  zh_CN: zhCN,
};

export type SupportedLocale = keyof typeof messages;

const localeAliases: Record<string, SupportedLocale> = {
  ar: "ar_ST",
};

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: defaultLocale,
  fallbackLocale,
  messages,
});

function resolveLocale(locale: string): SupportedLocale {
  return (
    localeAliases[locale] || ((locale in messages ? locale : fallbackLocale) as SupportedLocale)
  );
}

export async function setLocale(locale: string) {
  const resolvedLocale = resolveLocale(locale);
  i18n.global.locale.value = resolvedLocale;
  return resolvedLocale;
}

export async function loadRemoteLocale(
  locale: string,
  staticBaseUrl = import.meta.env.VITE_STATIC_BASE_URL,
) {
  const resolvedLocale = resolveLocale(locale);

  if (!staticBaseUrl) {
    return resolvedLocale;
  }

  try {
    const remoteLocale = resolvedLocale === "ar_ST" ? "ar" : resolvedLocale;
    const url = `${staticBaseUrl.replace(/\/$/, "")}/lang/${remoteLocale}.json`;
    const remoteMessages = (await hookFetch.get(url).json()) as Record<string, unknown>;
    i18n.global.setLocaleMessage(resolvedLocale, {
      ...remoteMessages,
      ...messages[resolvedLocale],
    });
  }
  catch {}

  return resolvedLocale;
}

export async function loadLanguageAsync(locale: string) {
  const resolvedLocale = await loadRemoteLocale(locale);
  await setLocale(resolvedLocale);
  return resolvedLocale;
}

export default i18n;

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { setLocale } from "@/i18n";

/** 外观偏好：system 跟随系统深浅色，light / dark 为手动指定（对应设置弹层 722:2999 三段） */
export type AppearanceMode = "system" | "light" | "dark";

/** 外观是纯本地偏好，重启后要保留；与 Lang 不同，后者每次以宿主注入为准 */
const APPEARANCE_STORAGE_KEY = "appAppearance";

export const useSystemStore = defineStore("system", () => {
  const baseUrl = ref(import.meta.env.VITE_AI_QUESTION_BASE_URL);
  const header = ref<Record<string, unknown>>({});
  const appVersion = ref("");
  const gridCountry = ref("");
  const device = ref<Record<string, unknown>>({});
  const deviceCount = ref(0);
  const pageStartTime = ref(0);
  const screenWidth = ref(0);
  const isIOS = ref(false);
  const pixelRatio = ref(2);
  const statusBarHeight = ref(0);
  const tabbarHeight = ref(0);
  const keyHeight = ref(0);
  /** 启动参数 from：来源标识。sanvist_pc 表示本页被 PC 端以内嵌 iframe 方式打开 */
  const from = ref("");

  const mapLang: Record<string, string> = {
    en_US: "en",
    zh_CN: "zh-CN",
    es_ES: "es",
    fr_FR: "fr",
    pt_PT: "pt-PT",
    ar: "ar",
    ru_RU: "ru",
    th_TH: "th",
    id_ID: "id",
    de_DE: "de",
    it_IT: "it",
    km_KH: "km",
    ko_KR: "ko",
    ms_MY: "ms",
    vi_VN: "vi",
  };

  const finalMapLanguage = computed(() => {
    const language = String(header.value.Lang || "");
    return mapLang[language] || "en";
  });

  const finalMapRegion = computed(() => {
    const region = header.value["CountryCode-Position"] || header.value["CountryCode-User"] || "";
    return typeof region === "string" ? region.toUpperCase() : "";
  });

  /** 外观偏好：设置弹层里选的那一段，落 storage */
  const appearance = ref<AppearanceMode>(readAppearance());
  /** 系统当前是否深色，只在 appearance === "system" 时参与判定 */
  const systemDark = ref(readSystemDark());
  /** 当前是否按深色渲染：手动选深色，或跟随系统且系统是深色 */
  const isDark = computed(
    () => appearance.value === "dark" || (appearance.value === "system" && systemDark.value),
  );

  function readAppearance(): AppearanceMode {
    try {
      const raw = String(uni.getStorageSync(APPEARANCE_STORAGE_KEY) || "");
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    }
    catch {}
    return "system";
  }

  /** 取系统深浅色：H5 用 matchMedia，兜底读 uni 的 theme 字段 */
  function readSystemDark() {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    try {
      return String(uni.getSystemInfoSync().theme || "").toLowerCase() === "dark";
    }
    catch {
      return false;
    }
  }

  try {
    uni.onThemeChange?.((res) => {
      systemDark.value = String(res?.theme || "").toLowerCase() === "dark";
    });
  }
  catch {}

  function setAppVersion(value: string) {
    appVersion.value = value;
  }

  function setDeviceCount(value: number) {
    deviceCount.value = value;
  }

  function setBaseUrl(value: string) {
    baseUrl.value = value;
    uni.setStorageSync("serviceApi", value);
  }

  function setDevice(value: Record<string, unknown>) {
    device.value = value;
  }

  function setHeader(value: Record<string, unknown>) {
    header.value = value;
  }

  /**
   * 统一写入界面语言：i18n 全局 locale 与 header 里的 Lang / language / X-Site-Language 一起改。
   *
   * - 启动时宿主注入的 Lang 走这里（App.vue onLaunch / bridge 晚到补参）；
   * - 设置弹层手动切换也走这里，避免「界面切了英文、header 还是中文」；
   * - 不落 storage：每次进页面都以宿主注入的 Lang 为准，本地缓存只会和宿主打架。
   */
  function setLanguage(lang: string) {
    const nextLang = String(lang || "").trim();
    if (!nextLang) return Promise.resolve("");

    header.value = {
      ...header.value,
      Lang: nextLang,
      "X-Site-Language": nextLang,
      language: nextLang.split("_")[0],
    };
    return setLocale(nextLang);
  }

  function setGridCountry(value: string) {
    gridCountry.value = value;
  }

  /** 设置弹层「外观」分段：选中即生效，同时落 storage 供下次启动读取 */
  function setAppearance(value: AppearanceMode) {
    const next: AppearanceMode = value === "light" || value === "dark" ? value : "system";
    appearance.value = next;
    try {
      uni.setStorageSync(APPEARANCE_STORAGE_KEY, next);
    }
    catch {}
  }

  function setStatusBarHeight(value: number) {
    // 0 视为「没拿到」，不要用它覆盖已有的有效值
    if (Number(value) > 0) statusBarHeight.value = Number(value);
  }

  function setTabbarHeight(value: number) {
    tabbarHeight.value = value;
  }

  function setFrom(value: string) {
    from.value = String(value || "");
  }

  function setPixelRatio(value: number) {
    pixelRatio.value = value;
  }

  function setScreenWidth(value: number) {
    screenWidth.value = value;
  }

  function setIsIOS(value: boolean) {
    isIOS.value = value;
  }

  function setPageStartTime(value: number) {
    pageStartTime.value = value;
  }

  function setKeyHeight(value: number) {
    keyHeight.value = value;
  }

  async function initPhoneSizesInfo() {
    const systemInfo = uni.getSystemInfoSync();
    const screenHeight = Number(systemInfo.screenHeight || systemInfo.windowHeight || 0);
    statusBarHeight.value = Number(systemInfo.statusBarHeight || 0);
    tabbarHeight.value = systemInfo.safeArea
      ? Math.max(0, screenHeight - Number(systemInfo.safeArea.bottom || screenHeight))
      : 0;
  }

  return {
    baseUrl,
    header,
    appVersion,
    gridCountry,
    device,
    deviceCount,
    pageStartTime,
    screenWidth,
    isIOS,
    pixelRatio,
    statusBarHeight,
    tabbarHeight,
    keyHeight,
    from,
    appearance,
    isDark,
    mapLang,
    finalMapLanguage,
    finalMapRegion,
    setAppearance,
    setAppVersion,
    setDeviceCount,
    setBaseUrl,
    setDevice,
    setHeader,
    setLanguage,
    setGridCountry,
    setStatusBarHeight,
    setTabbarHeight,
    setFrom,
    setPixelRatio,
    setScreenWidth,
    setIsIOS,
    setPageStartTime,
    setKeyHeight,
    initPhoneSizesInfo,
  };
});

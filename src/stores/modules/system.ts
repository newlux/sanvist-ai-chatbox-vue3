import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { setLocale } from "@/i18n";
import { getColorScheme } from "@/utils/platform/mpaas";

/** 外观偏好：system 跟随系统深浅色，light / dark 为手动指定（对应设置弹层 722:2999 三段） */
export type AppearanceMode = "system" | "light" | "dark";

/** 实际生效的外观：只可能是 light / dark，不再出现 system */
export type ResolvedAppearance = "light" | "dark";

/**
 * 实际生效的外观（light / dark）落这个 key：来源是宿主 `getColorScheme`，
 * 拿不到或失败一律按 light，所以这个 key 里永远不会出现 system。
 */
const APPEARANCE_STORAGE_KEY = "appAppearance";

/** 外观偏好（system / light / dark）单独存一份，重启后才知道要不要继续「跟随系统」 */
const APPEARANCE_MODE_STORAGE_KEY = "appAppearanceMode";

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

  /** 外观偏好：设置弹层里选的那一段（system / light / dark），决定要不要跟随系统 */
  const appearance = ref<AppearanceMode>(readAppearanceMode());
  /**
   * 实际生效的外观，只存 light / dark：
   * 唯一来源是宿主 `getColorScheme`，没拿到（未注入 bridge / 调用失败 / success 不为 true）
   * 一律按 light，所以初值直接是 light，避免先闪一下深色。
   */
  const appAppearance = ref<ResolvedAppearance>(readAppAppearance());
  /** 当前是否按深色渲染 */
  const isDark = computed(() => appAppearance.value === "dark");

  function readAppearanceMode(): AppearanceMode {
    try {
      const raw = String(uni.getStorageSync(APPEARANCE_MODE_STORAGE_KEY) || "");
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    }
    catch {}
    return "system";
  }

  /** 读上一次生效的具体外观：只认 light / dark，其余（含旧版本存的 system）都按 light */
  function readAppAppearance(): ResolvedAppearance {
    try {
      const raw = String(uni.getStorageSync(APPEARANCE_STORAGE_KEY) || "");
      if (raw === "dark") return "dark";
    }
    catch {}
    return "light";
  }

  /** 写入生效外观：state 与 storage 同时更新，保证 `appAppearance` 里只有 light / dark */
  function setResolvedAppearance(value: ResolvedAppearance) {
    appAppearance.value = value;
    try {
      uni.setStorageSync(APPEARANCE_STORAGE_KEY, value);
    }
    catch {}
  }

  /**
   * 同步一次生效外观。
   *
   * - 偏好是 light / dark：直接用偏好的值，不用问原生；
   * - 偏好是 system：`AlipayJSBridge.call("getColorScheme")` 拿 light / dark，
   *   未注入 bridge、调用失败、超时、success 不为 true → 按默认值 light。
   *
   * 调用时机：App 启动（onLaunch）一次；设置弹层里选中「跟随系统」再拉一次，
   * 这样用户刚从深色切到「跟随系统」时拿到的就是系统当前真实值，而不是上一次的缓存。
   */
  async function syncSystemColorScheme() {
    if (appearance.value !== "system") {
      setResolvedAppearance(appearance.value);
      return appAppearance.value;
    }
    const scheme = await getColorScheme();
    setResolvedAppearance(scheme === "dark" ? "dark" : "light");
    return appAppearance.value;
  }

  // 系统深浅色变化：仅在「跟随系统」时再问一次原生（保持单一数据源），不直接读 matchMedia
  try {
    uni.onThemeChange?.(() => {
      if (appearance.value !== "system") return;
      void syncSystemColorScheme();
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

  /**
   * 设置弹层「外观」分段：选中即生效。
   *
   * 偏好（system / light / dark）单独落一份；生效值始终换算成具体的 light / dark 写进
   * `appAppearance`——选「跟随系统」时问一次原生 getColorScheme，避免沿用上一次的结论。
   */
  function setAppearance(value: AppearanceMode) {
    const next: AppearanceMode = value === "light" || value === "dark" ? value : "system";
    appearance.value = next;
    try {
      uni.setStorageSync(APPEARANCE_MODE_STORAGE_KEY, next);
    }
    catch {}
    if (next === "system") void syncSystemColorScheme();
    else setResolvedAppearance(next);
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
    appAppearance,
    isDark,
    syncSystemColorScheme,
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

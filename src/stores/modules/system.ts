import { defineStore } from "pinia";
import { computed, ref } from "vue";

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

  function setGridCountry(value: string) {
    gridCountry.value = value;
  }

  function setStatusBarHeight(value: number) {
    // 0 视为「没拿到」，不要用它覆盖已有的有效值
    if (Number(value) > 0) statusBarHeight.value = Number(value);
  }

  function setTabbarHeight(value: number) {
    tabbarHeight.value = value;
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
    mapLang,
    finalMapLanguage,
    finalMapRegion,
    setAppVersion,
    setDeviceCount,
    setBaseUrl,
    setDevice,
    setHeader,
    setGridCountry,
    setStatusBarHeight,
    setTabbarHeight,
    setPixelRatio,
    setScreenWidth,
    setIsIOS,
    setPageStartTime,
    setKeyHeight,
    initPhoneSizesInfo,
  };
});

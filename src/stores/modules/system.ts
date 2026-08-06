import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useSystemStore = defineStore("system", () => {
  const baseUrl = ref(import.meta.env.VITE_AI_QUESTION_BASE_URL);
  const header = ref<Record<string, unknown>>({});
  const appVersion = ref("");
  const gridCountry = ref("");
  const isVisitor = ref<boolean | null>(null);
  const userId = ref("");
  const username = ref("");
  const userInfo = ref<Record<string, unknown>>({});
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

  function setIsVisitor(value: boolean | null) {
    isVisitor.value = value;
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

  function setUserId(value: string) {
    userId.value = value;
  }

  function setUsername(value: string) {
    username.value = value;
  }

  function setStatusBarHeight(value: number) {
    statusBarHeight.value = value;
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

  function setUserInfo(value: Record<string, unknown>) {
    userInfo.value = value;
  }

  function setPageStartTime(value: number) {
    pageStartTime.value = value;
  }

  function setKeyHeight(value: number) {
    keyHeight.value = value;
  }

  async function initPhoneSizesInfo() {
    const platform = uni.getSystemInfoSync().platform;
    const alipayJSBridge = globalThis as typeof globalThis & {
      AlipayJSBridge?: {
        call: (
          method: string,
          params: Record<string, never>,
          callback: (result: { statusBarHeight?: number; tabbarHeight?: number }) => void,
        ) => void;
      };
    };

    if (platform !== "ios" || !alipayJSBridge.AlipayJSBridge) {
      statusBarHeight.value = 0;
      tabbarHeight.value = 0;
      return;
    }

    await new Promise<void>((resolve) => {
      alipayJSBridge.AlipayJSBridge?.call("getPhoneSizesInfo", {}, (result) => {
        statusBarHeight.value = result.statusBarHeight || 0;
        tabbarHeight.value = result.tabbarHeight || 0;
        resolve();
      });
    });
  }

  return {
    baseUrl,
    header,
    appVersion,
    gridCountry,
    isVisitor,
    userId,
    username,
    userInfo,
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
    setIsVisitor,
    setDeviceCount,
    setBaseUrl,
    setDevice,
    setHeader,
    setGridCountry,
    setUserId,
    setUsername,
    setStatusBarHeight,
    setTabbarHeight,
    setPixelRatio,
    setScreenWidth,
    setIsIOS,
    setUserInfo,
    setPageStartTime,
    setKeyHeight,
    initPhoneSizesInfo,
  };
});

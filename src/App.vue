<script setup lang="ts">
import { onHide, onLaunch } from "@dcloudio/uni-app";
// import { getUserInfo } from "@/api/user";
import { setLocale } from "@/i18n";
import { useSystemStore, useUserStore } from "@/stores";
import { setRequestAuth } from "@/utils/request";

const browserAuthorization = "bearer 9ae76087-03f6-4db0-878b-ed6e9af37879";

type StartupQuery = Record<string, string | boolean | undefined>;

interface LaunchOptions {
  query?: StartupQuery;
}

const systemStore = useSystemStore();
const userStore = useUserStore();

function isBrowser() {
  return typeof window !== "undefined" && !("AlipayJSBridge" in globalThis);
}

function parseQueryString(raw: string): StartupQuery {
  const query: StartupQuery = {};
  new URLSearchParams(raw).forEach((value, key) => {
    query[key] = value === "false" ? false : value;
  });
  return query;
}

function getLaunchQuery(options?: LaunchOptions): StartupQuery {
  // mPaaS WebView 环境下优先从 AlipayJSBridge.startupParams 中获取启动参数
  interface StartupParams {
    startupParams?: { query?: string };
  }
  const bridge = (globalThis as typeof globalThis & { AlipayJSBridge?: StartupParams }).AlipayJSBridge;
  const rawQuery = bridge?.startupParams?.query;
  if (rawQuery) {
    return parseQueryString(rawQuery);
  }
  return options?.query || {};
}

function initializeSystem(query: StartupQuery) {
  const authorization = isBrowser() ? browserAuthorization : String(query.Authorization || "");
  const lang = String(query.Lang || "zh_CN");
  const country = String(query.country || "");
  const version = String(query.version || "");
  const username = String(query.username || "");
  const timezone = query.Timezone;
  const demoMode = query.DemoMode === true || query.DemoMode === "true";
  const baseUrl = String(query.baseUrl || import.meta.env.VITE_AI_QUESTION_BASE_URL);

  setRequestAuth(authorization);

  userStore.setIsVisitor(true);
  systemStore.setHeader({
    Authorization: authorization,
    Lang: lang,
    Timezone: timezone,
    DemoMode: demoMode,
    language: String(query.lang || lang).split("_")[0],
    "X-Site-Language": lang,
    "CountryCode-User": query["CountryCode-User"],
    "CountryCode-Position": query["CountryCode-Position"],
  });
  systemStore.setBaseUrl(baseUrl);
  systemStore.setGridCountry(country);
  systemStore.setAppVersion(version);
  userStore.setUsername(username);
  uni.setStorageSync("prevPageName", String(query.pageName || ""));

  return { authorization, baseUrl, lang, version };
}

// async function initializeUserInfo(options: ReturnType<typeof initializeSystem>) {
//   try {
//     const { data: userInfo } = await getUserInfo(options);
//     userStore.setUserInfo(userInfo);
//     userStore.setUserId(String(userInfo.userId || ""));
//   } catch (e) {
//     console.log("🚀 ~ e:", e);
//     // 用户信息请求失败不阻断应用启动
//   }
// }

function initializeDeviceInfo() {
  uni.getSystemInfo({
    success(info) {
      systemStore.setDevice({ ...info });
      // H5 下 uni 的 statusBarHeight 恒为 0，不能把 mPaaS getPhoneSizesInfo 拿到的真实值覆盖掉
      const statusBarHeight = Number(info.statusBarHeight) || 0;
      if (statusBarHeight > 0) {
        systemStore.setStatusBarHeight(statusBarHeight);
      }
      systemStore.setPixelRatio(info.pixelRatio || 2);
      systemStore.setIsIOS(info.platform === "ios");
      systemStore.setScreenWidth(info.screenWidth || 0);
    },
  });
}

onLaunch(async (options) => {
  const baseInfo = initializeSystem(getLaunchQuery(options));
  // console.log("🚀 ~ baseInfo:", baseInfo);
  await setLocale(baseInfo.lang);
  // await initializeUserInfo(baseInfo);
  await systemStore.initPhoneSizesInfo();
  initializeDeviceInfo();
});

onHide(() => {
  console.log("App Hide");
});
</script>

<style lang="scss">
html,
body,
#app,
uni-app {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

body {
  margin: 0;
}
</style>

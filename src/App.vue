<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { setLocale } from "@/i18n";
import { useSystemStore, useUserStore } from "@/stores";
import { setAuthFailureHandler, setRequestAuth, setRequestBaseURL } from "@/utils/request";

// 兜底 token 仅用于本地联调；生产包必须由宿主通过启动参数注入，
// 否则一旦这串固定 token 泄漏或过期，线上会静默变成无鉴权请求
const authorizationFallback = import.meta.env.DEV
  ? "bearer 9ae76087-03f6-4db0-878b-ed6e9af37879"
  : "";

type StartupQuery = Record<string, any>;

interface LaunchOptions {
  query?: StartupQuery;
}

const systemStore = useSystemStore();
const userStore = useUserStore();

function getLaunchQuery(options?: LaunchOptions): StartupQuery {
  return options?.query || {};
}

function initializeSystem(query: StartupQuery) {
  const authorization = query?.Authorization || authorizationFallback;
  const lang = String(query.Lang || "zh_CN");
  const country = String(query.country || "");
  const version = String(query.version || "");
  const username = String(query.username || "");
  const timezone = query.Timezone;
  const demoMode = query.DemoMode === true || query.DemoMode === "true";
  const baseUrl = String(query.baseUrl || import.meta.env.VITE_AI_QUESTION_BASE_URL);

  setRequestAuth(authorization);
  setRequestBaseURL(baseUrl);

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

/**
 * token 由宿主通过启动参数注入，前端自己换不了，
 * 只能通知宿主重新下发；拿不到 bridge 时至少让用户知道要重进。
 */
function handleAuthFailure(_statusCode: number, message: string) {
  console.error("[App] auth failed", message);
  const bridge = (globalThis as Record<string, any>).AlipayJSBridge;
  if (bridge?.call) {
    bridge.call("tokenExpiration", {}, () => {});
    return;
  }
  uni.showToast({ title: "登录已失效，请重新进入", icon: "none", duration: 3000 });
}

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
  setAuthFailureHandler(handleAuthFailure);
  const baseInfo = initializeSystem(getLaunchQuery(options));
  await setLocale(baseInfo.lang);
  await systemStore.initPhoneSizesInfo();
  initializeDeviceInfo();
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

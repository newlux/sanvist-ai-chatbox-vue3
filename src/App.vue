<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import { useSystemStore, useUserStore } from "@/stores";
import { setupDebugConsole } from "@/utils/debug-console";
import { isEmbeddedInIframe, isSanvistPcEmbedded, notifyParentReady, resolveFromParam } from "@/utils/iframe";
import { warmPhoneInfo } from "@/utils/landscape-device";
import { resolveLaunchQuery, subscribeStartupParams } from "@/utils/launch-query";
import { createLogger } from "@/utils/logger";
import { isMpaasReady, notifyTokenExpiration } from "@/utils/platform/mpaas";
import { setAuthFailureHandler, setGuestRole, setRequestAuth, setRequestBaseURL } from "@/utils/request";

import { setSceneStartupQuery } from "@/utils/scene-navigation";

const logger = createLogger("app");
// 兜底 token 仅用于本地联调；生产包必须由宿主通过启动参数注入，
// 否则一旦这串固定 token 泄漏或过期，线上会静默变成无鉴权请求
const authorizationFallback = import.meta.env.DEV
  ? "bearer 9ae76087-03f6-4db0-878b-ed6e9af37879"
  : "";

type StartupQuery = Record<string, any>;

interface LaunchOptions {
  query?: StartupQuery;
}

const { t } = useI18n();
const systemStore = useSystemStore();
const userStore = useUserStore();

/**
 * 启动参数由宿主注入，离线包与在线包是同一套（Authorization / Lang / country / baseUrl ...）。
 * onLaunch 的 options.query 在 hash 路由下未必完整，统一走 resolveLaunchQuery 做兜底：
 * location.search → hash query → AlipayJSBridge.startupParams → options.query。
 */
function getLaunchQuery(options?: LaunchOptions): StartupQuery {
  return resolveLaunchQuery(options);
}

function initializeSystem(query: StartupQuery) {
  // 调试面板尽早开：后面初始化里的日志也要能收进去
  setupDebugConsole(query);
  setSceneStartupQuery(query);

  // 宿主大小写两种写法都出现过（Authorization / authorization），这里都认
  const authorization = String(query?.Authorization || query?.authorization || authorizationFallback || "").trim();
  const lang = String(query.Lang || "zh_CN");
  const country = String(query.country || "");
  const version = String(query.version || "");
  const username = String(query.username || "");
  const timezone = query.Timezone;
  const demoMode = query.DemoMode === true || query.DemoMode === "true";
  const baseUrl = String(query.baseUrl || import.meta.env.VITE_AI_QUESTION_BASE_URL);

  setRequestAuth(authorization);
  setRequestBaseURL(baseUrl);
  userStore.restoreVisitorRole();
  if (userStore.visitorRole) setGuestRole(userStore.visitorRole);

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
  // 来源标识：PC 端以内嵌 iframe 打开时传 from=sanvist_pc，用于显性化「最小化」
  // 走 resolveFromParam：hash 路由下 onLaunch 的 query 可能取不到，需要从 location 兜底
  systemStore.setFrom(resolveFromParam(query));
  // 宿主注入的状态栏高度最准，H5 自己是取不到的
  systemStore.setStatusBarHeight(Number(query.statusBarHeight || query.StatusBarHeight) || 0);
  userStore.setUsername(username);
  uni.setStorageSync("prevPageName", String(query.pageName || ""));

  return { authorization, baseUrl, lang, version };
}

/**
 * token 由宿主通过启动参数注入，前端自己换不了，
 * 只能通知宿主重新下发；拿不到 bridge 时至少让用户知道要重进。
 */
function handleAuthFailure(_statusCode: number, message: string) {
  logger.error("auth failed", message);
  if (isMpaasReady()) {
    notifyTokenExpiration();
    return;
  }
  uni.showToast({ title: t("auth-expired-reenter"), icon: "none", duration: 3000 });
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

/**
 * PC 端内嵌 iframe 场景的初始化。
 *
 * 只做一件事：告知主应用页面已就绪，主应用据此撤掉 loading。
 *
 * 注意：这里【不要】预申请麦克风权限。Chrome 对 getUserMedia 的权限弹窗
 * 要求「用户手势」（transient user activation），在跨域 iframe 里尤其严格。
 * onLaunch 阶段没有手势，预申请会被挂起/静默拒绝，反而把权限状态机标成
 * denied，导致用户之后真正点录音时被误拦截（表现为「点了没反应」）。
 * 权限申请必须回到「用户点录音」的手势上下文里触发。
 */
function initializeIframeBridge(query: StartupQuery) {
  if (!isSanvistPcEmbedded(query)) return;
  if (!isEmbeddedInIframe()) {
    logger.debug("from=sanvist_pc 但当前未被嵌套，跳过 iframe 初始化");
    return;
  }

  notifyParentReady();
}

/**
 * 晚到的授权信息：写入请求模块（后续请求头自动带上）并同步 header。
 * header 是整份替换，这里合并后写回，别把 Lang / Timezone 等一起冲掉。
 */
function applyLateAuthorization(params: StartupQuery) {
  const lateAuth = String(params?.Authorization || params?.authorization || "").trim();
  if (!lateAuth) return;
  const currentAuth = String(systemStore.header.Authorization || "").trim();
  if (lateAuth === currentAuth) return;
  logger.info("bridge 晚到，补授权信息");
  setRequestAuth(lateAuth);
  systemStore.setHeader({ ...systemStore.header, Authorization: lateAuth });
}

/**
 * 离线包场景常见「bridge 比页面晚到」：宿主塞在 startupParams 里的 Authorization / Lang
 * 那一刻才读得到。只有真拿到且与当前值不同才补一次，避免重复写 header、重复拉远程语言包。
 */
function watchLateStartupParams() {
  subscribeStartupParams((params) => {
    applyLateAuthorization(params);
    const lateLang = String(params.Lang || "");
    const currentLang = String(systemStore.header.Lang || "");
    if (!lateLang || lateLang === currentLang) return;
    logger.debug("bridge 晚到，补启动语言", lateLang);
    // 与 onLaunch 同一个入口：i18n 与 header 一起改，设置弹层的分段也会跟着变
    void systemStore.setLanguage(lateLang);
  });
}

onLaunch(async (options) => {
  setAuthFailureHandler(handleAuthFailure);
  const query = getLaunchQuery(options);
  const baseInfo = initializeSystem(query);
  initializeIframeBridge(query);
  // 系统深浅色只认宿主 getColorScheme：进应用先问一次（拿不到就按浅色）。
  // 不 await：bridge 未就绪时内部最多等 3s，不能把启动流程卡在这里。
  void systemStore.syncSystemColorScheme();
  // 语言只有一个入口：i18n 全局 locale 与 header 的 Lang 一起写
  await systemStore.setLanguage(baseInfo.lang);
  watchLateStartupParams();
  await systemStore.initPhoneSizesInfo();
  initializeDeviceInfo();
  // 预热设备信息：横屏调度视图（甘特 / 预排 / 重排）要按机型决定是否转屏，
  // 提前取一次，进页面时就不用再等原生回调（智慧屏 / 电视这类机型直接跳过转屏，见 utils/landscape-device）
  void warmPhoneInfo();
});
</script>

<style lang="scss">
html,
body,
#app,
uni-app,
uni-page,
uni-page-wrapper,
uni-page-body {
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

body {
  margin: 0;
  // iOS 聚焦输入框时会把整个布局视口往上推，页面必须彻底「不可滚动」它才推不动；
  // 只有 overflow:hidden 挡不住，position:fixed 才能真正锁死
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
}
</style>

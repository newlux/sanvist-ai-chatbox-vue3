<script setup lang="ts">
import { onLaunch } from "@dcloudio/uni-app";
import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore, useSystemStore, useUserStore } from "@/stores";
import { setupDebugConsole } from "@/utils/debug-console";
import { isEmbeddedInIframe, isSanvistPcEmbedded, notifyParentReady, resolveFromParam } from "@/utils/iframe";
import { isWebEnvironment, warmPhoneInfo } from "@/utils/landscape-device";
import { describeLaunchSources, readBridgeStartupParams, resolveLaunchQuery, subscribeStartupParams } from "@/utils/launch-query";
import { createLogger } from "@/utils/logger";
import { isMpaasReady, notifyTokenExpiration, waitForMpaas } from "@/utils/platform/mpaas";
import { describeRequestAuth, setAuthFailureHandler, setGuestRole, setRequestAuth, setRequestBaseURL } from "@/utils/request";

import { setSceneStartupQuery } from "@/utils/scene-navigation";

const logger = createLogger("app");
/**
 * 本地兜底 token：只在宿主启动参数里没带 Authorization 时使用。
 *
 * 取值优先级：宿主注入（query.Authorization）> 本地兜底（这一串）> 空串。
 * 置空时请求不会带 Authorization 头（见 utils/request 的 getRequestHeaders）。p 
 * 注意：这串会打进产物，正式上线前需要确认是否保留。
 */
const LOCAL_AUTHORIZATION_FALLBACK = "bearer 2e729dca-582b-4fbb-bd5d-550c6b051567";

type StartupQuery = Record<string, any>;

interface LaunchOptions {
  query?: StartupQuery;
}

const { t } = useI18n();
const systemStore = useSystemStore();
const userStore = useUserStore();
const settingsStore = useSettingsStore();

/**
 * 驻场身份 → 请求头 `Guest-Role` 的唯一同步点。
 *
 * 任何写 visitorRole 的地方（身份选择页、启动时 restoreVisitorRole、退出时清空）
 * 都会自动带上 / 清掉这个头，页面不用再各自调 setGuestRole。
 * `flush: "sync"`：身份选择页写完会立刻发请求（预取今日觉醒），必须当场生效，
 * 否则那一次请求还是按旧身份发出去。
 */
watch(
  () => userStore.visitorRole,
  role => setGuestRole(role),
  { immediate: true, flush: "sync" },
);

function getLaunchQuery(options?: LaunchOptions): StartupQuery {
  return resolveLaunchQuery(options);
}

/**
 * 等 bridge 就绪后再读启动参数（对齐 mysany-ms App.vue 的 onLaunch 写法）。
 *
 * mysany-ms 的做法是把启动流程整个包在 `ready(cb)` 里，回调里才读
 * `AlipayJSBridge.startupParams` → `getUrlParams(startupParams.query)` → `query.Authorization`；
 * 原因是 bridge 是异步注入的，onLaunch 当场读大概率还是空值。
 *
 * 这里等价实现：真机最多等 BRIDGE_READY_TIMEOUT_MS；
 * 网页 / PC 内嵌（isWebEnvironment）本来就没有 bridge，直接跳过，不拖慢启动。
 */
const BRIDGE_READY_TIMEOUT_MS = 1000;

async function waitBridgeReady(): Promise<boolean> {
  if (isMpaasReady()) return true;
  if (isWebEnvironment()) return false;

  const bridge = await waitForMpaas(BRIDGE_READY_TIMEOUT_MS);
  if (!bridge) {
    logger.warn("[auth] bridge 未在超时内就绪，先按本地 token 启动，就绪后再补正");
  }
  return Boolean(bridge);
}

/**
 * 宿主 token 的唯一取值口径：bridge 的 `startupParams.query.Authorization`。
 *
 * onLaunch 已先 await waitBridgeReady()（对齐 mysany-ms 的 ready 包裹），
 * 所以这里通常能直接拿到宿主 token；但个别宿主会在 ready 之后才补 startupParams，
 * 仍保留一次晚到补正（见 watchLateStartupParams / watchLateAuthorization）。
 *
 * `startupParams.query` 既可能是对象也可能是查询串（`Authorization=xx&Lang=zh_CN`），
 * readBridgeStartupParams 已统一解析并摊平到顶层，顶层与嵌套两种取法都认。
 */
type HostAuthPath = "query.Authorization" | "query.authorization" | "Authorization" | "authorization" | "none";

/**
 * 宿主 token + 它是从哪一层取到的。
 *
 * 带上命中路径是为了排查「宿主到底把 token 传在哪」：
 * 之前只返回字符串，取不到时日志只能看到空串，分不清是没传、传在顶层没摊平、
 * 还是 key 大小写不一致。
 */
function readHostAuthorization(): { value: string; path: HostAuthPath } {
  const bridge = readBridgeStartupParams();
  // query 是对象时直接看它（摊平后顶层也有，双保险）；字符串形态已由 readBridgeStartupParams 解析并摊平
  const nestedRaw = bridge.query;
  const nested = nestedRaw && typeof nestedRaw === "object" ? (nestedRaw as StartupQuery) : {};
  const candidates: Array<[HostAuthPath, unknown]> = [
    ["query.Authorization", nested.Authorization],
    ["query.authorization", nested.authorization],
    ["Authorization", bridge.Authorization],
    ["authorization", bridge.authorization],
  ];
  for (const [path, raw] of candidates) {
    const value = String(raw || "").trim();
    if (value) return { value, path };
  }
  return { value: "", path: "none" };
}

function initializeSystem(query: StartupQuery, launchOptions?: LaunchOptions) {
  // 调试面板尽早开：后面初始化里的日志也要能收进去
  // 注意 vConsole 是动态 import，面板就绪前打出去的 console 收不进去，
  // 需要被面板看到的启动期日志统一放到 debugReady.then 里打。
  const debugReady = setupDebugConsole(query);
  setSceneStartupQuery(query);

  // token 只认宿主启动参数 query 下那份：bridge → startupParams.query.Authorization；
  // 取不到就用本地配置的 token，两者都没有则置空（请求不带 Authorization 头）。
  const host = readHostAuthorization();
  const hostAuthorization = host.value;
  const authorization = hostAuthorization || LOCAL_AUTHORIZATION_FALLBACK;

  /**
   * token 获取流程日志（同步打，不依赖 vConsole 就绪）。
   *
   * 之前只在 debugReady.then 里打：调试面板没加载出来时（生产包 / 面板加载失败），
   * 日志里完全看不到 token 从哪来、宿主到底传没传，排查只能靠猜。
   * 这里把「bridge 就绪 / 是否网页环境 / 命中哪一层 / 是否用了本地兜底」一次打全。
   */
  logger.warn("[auth] 启动 token 流程", {
    bridgeReady: isMpaasReady(),
    webEnvironment: isWebEnvironment(),
    hostPath: host.path,
    hostHasToken: Boolean(hostAuthorization),
    fallbackTokenLen: hostAuthorization ? 0 : LOCAL_AUTHORIZATION_FALLBACK.length,
    tokenLen: authorization.length,
    tokenPrefix: authorization.slice(0, 16),
    bridgeKeys: Object.keys(readBridgeStartupParams()),
  });

  // 联调：面板就绪后再打，否则真机上根本看不到
  void debugReady.then(() => {
    // 面板加载期间 bridge 可能已经就绪：先补一次 token（幂等），别等 ready 事件
    syncHostAuthorization("debug-console-ready");

    const sources = describeLaunchSources(launchOptions);
    // 宿主跳转地址 + 三条来源（url / bridge startupParams / onLaunch.query）各自的原样快照
    logger.warn("[launch] 宿主参数来源", sources);
    // 合并后真正生效的那份（onLaunch 时刻的，bridge 晚到时会为空，以宿主参数来源为准）
    logger.warn("[launch] 启动参数（合并后）", { ...query });
    // 用 warn 打：生产默认级别是 warn，联调时要能在控制台看到最终生效的 token
    logger.warn("[auth] token", {
      source: hostAuthorization ? "host" : "local",
      hostPath: host.path,
      authorization: authorization || "",
      // 当前实际生效的（补正后应与宿主一致）
      current: String(systemStore.header.Authorization || ""),
      // 请求层真正会发出去的那份（与 systemStore 是两条独立通道，对不上就是这里漏了）
      requestLayer: describeRequestAuth(),
      bridgeAuthorization: sources.bridgeAuthorization,
      bridgeQueryType: sources.bridgeQueryType,
    });
  });
  const lang = String(query.Lang || "zh_CN");
  const country = String(query.country || "");
  const version = String(query.version || "");
  const username = String(query.username || "");
  const timezone = query.Timezone;
  const demoMode = query.DemoMode === true || query.DemoMode === "true";
  // 接口地址固定用 env 配置，忽略宿主启动参数里的 baseUrl：
  // 宿主传的值出现过缺网关前缀（只有域名）的情况，请求会 503 routeNotFound。
  const baseUrl = String(import.meta.env.VITE_AI_QUESTION_BASE_URL || "");

  setRequestAuth(authorization, hostAuthorization ? "host" : authorization ? "local-fallback" : "empty");
  setRequestBaseURL(baseUrl);
  // 联调：确认请求实际打到哪个地址（现在只由 VITE_AI_QUESTION_BASE_URL 决定）
  void debugReady.then(() => {
    logger.warn("[launch] baseUrl", { baseUrl });
  });
  // 恢复上次选的驻场身份；Guest-Role 请求头由 visitorRole 的 watch 统一同步（见文件顶部）
  userStore.restoreVisitorRole();

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
function handleAuthFailure(statusCode: number, message: string) {
  // 带上当前 token 的状态：只有知道请求那一刻带的是谁的 token，才能判断是「宿主没下发」还是「下发的是过期 token」
  logger.error("[auth] 鉴权失败", {
    statusCode,
    message,
    bridgeReady: isMpaasReady(),
    webEnvironment: isWebEnvironment(),
    token: describeRequestAuth(),
  });
  if (isMpaasReady()) {
    logger.warn("[auth] 已通过 tokenExpiration 通知宿主重新下发");
    notifyTokenExpiration();
    return;
  }
  logger.warn("[auth] 无 bridge，无法通知宿主，提示用户重进");
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
 * 宿主 token 补正（幂等）。
 *
 * onLaunch 时 bridge 往往还没注入 startupParams，只能先退回本地配置的 token；
 * bridge 就绪后立刻换成宿主下发的 token（请求头与 systemStore.header 一起更新）。
 */
function syncHostAuthorization(reason: string) {
  const host = readHostAuthorization();
  const currentAuth = String(systemStore.header.Authorization || "");
  // 每条分支都留痕：之前「拿不到宿主 token」直接 return，日志里看不到补正到底跑没跑
  if (!host.value) {
    logger.warn("[auth] 补正跳过：宿主未下发 token", {
      reason,
      currentLen: currentAuth.length,
      requestLayer: describeRequestAuth(),
    });
    return;
  }
  if (host.value === currentAuth) {
    logger.debug("[auth] 补正跳过：与当前一致", { reason, hostPath: host.path });
    return;
  }

  logger.warn("[auth] 改用宿主 token", {
    reason,
    hostPath: host.path,
    hostLen: host.value.length,
    hostPrefix: host.value.slice(0, 16),
    previousLen: currentAuth.length,
    previousPrefix: currentAuth.slice(0, 16),
  });
  setRequestAuth(host.value, `late-${reason}`);
  systemStore.setHeader({ ...systemStore.header, Authorization: host.value });
  logger.warn("[auth] 补正完成", { reason, requestLayer: describeRequestAuth() });
}

/**
 * 订阅 bridge 就绪，仅用于补 token。
 *
 * 必须紧跟 initializeSystem 注册：后面 setLanguage 会 await 远程语言包，
 * 拖到那时才订阅就错过 bridge 就绪事件了（表现为日志里桥参数已有 token、
 * 请求头却还是本地那条）。
 */
function watchLateAuthorization() {
  // bridge 已就绪时 subscribeStartupParams 会立即回调，未就绪则等 AlipayJSBridgeReady
  subscribeStartupParams(() => syncHostAuthorization("bridge-ready"));
}

/**
 * 离线包场景常见「bridge 比页面晚到」：宿主塞在 startupParams 里的 Lang 那一刻才读得到。
 * 只在真拿到且与当前值不同时才补一次。
 */
function watchLateStartupParams() {
  subscribeStartupParams((params) => {
    // 联调：bridge 晚到的那份宿主参数也整体打一次
    logger.warn("[launch] bridge 晚到参数", { ...params });

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
  // 参考 mysany-ms：先等 bridge ready，再读 startupParams.query 里的 Authorization，
  // 避免用本地兜底 token 把首批请求发出去（网页环境没有 bridge，这里会直接返回）
  await waitBridgeReady();
  const query = getLaunchQuery(options);
  const baseInfo = initializeSystem(query, options);
  initializeIframeBridge(query);
  // token 补正订阅要尽早注册，别被下面的 setLanguage 阻塞
  watchLateAuthorization();
  // 系统深浅色只认宿主 getColorScheme：进应用先问一次（拿不到就按浅色）。
  // 不 await：bridge 未就绪时内部最多等 3s，不能把启动流程卡在这里。
  void systemStore.syncSystemColorScheme();
  // 语言只有一个入口：i18n 全局 locale 与 header 的 Lang 一起写
  await systemStore.setLanguage(baseInfo.lang);
  // 系统设置（接口文档 4.5 GET /settings）：进应用拉一次全量，
  // 语言 / 外观 / 记忆 / 纯净模式 / 对话 / 音色 / 语速各落到自己的归属地（见 stores/modules/settings.ts）。
  // 不 await：拉不到就用宿主注入的语言与本地默认值，不能阻塞首屏
  void settingsStore.load();
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

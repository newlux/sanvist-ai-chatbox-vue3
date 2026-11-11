import { closeWebview, isMpaasReady, openWebview } from "@/utils/platform/mpaas";

// 只透传应用初始化需要的字段，不带旧页面的 sessionId 等业务参数。
const startupKeys = [
  "Authorization",
  "Lang",
  "lang",
  "country",
  "version",
  "username",
  "Timezone",
  "DemoMode",
  "baseUrl",
  "statusBarHeight",
  "StatusBarHeight",
  "CountryCode-User",
  "CountryCode-Position",
  "pageName",
  // PC 端内嵌标识：跨页（首页 ↔ 听播）跳转时必须带着，否则新页面认不出自己仍在 iframe 里
  "from",
];
let startupQuery: Record<string, unknown> = {};
let opening = false;

export function setSceneStartupQuery(query: Record<string, unknown>) {
  startupQuery = { ...query };
}

/** 当前 H5 使用 hash 路由，保留离线包入口路径及部署子目录。 */
export function buildSceneWindowUrl(route: string, href: string) {
  const url = new URL(href);
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams();
  for (const key of startupKeys) {
    const value = startupQuery[key];
    if (value != null) params.set(key, String(value));
  }
  new URLSearchParams(query).forEach((value, key) => params.set(key, value));
  params.set("nativeSceneWindow", "1");
  url.search = "";
  url.hash = `${path}?${params}`;
  return url.href;
}

export async function navigateToScene(url: string) {
  if (opening) return;
  opening = true;
  try {
    const fallback = () => uni.navigateTo({ url });
    if (!isMpaasReady() || typeof location === "undefined") {
      fallback();
      return;
    }
    await openWebview(buildSceneWindowUrl(url, location.href), fallback);
  } finally {
    // 防止连续点击在 bridge 等待或原生转场期间重复开窗。
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

export function isSceneWindowRoot() {
  return startupQuery.nativeSceneWindow === "1" && getCurrentPages().length <= 1;
}

/**
 * 必须留在**主 webview** 里打开的对话类场景页：
 * 这两页右上角的「退出」要真的关掉整个小程序（回宿主 App），
 * 一旦被 `openWebview` 开成独立窗口，popWindow / closeMiniPro 只会关掉那一层窗口、露出首页。
 */
const IN_APP_CHAT_ROUTES = ["/pages/guide/index", "/pages/task/index"];

/**
 * 打开对话类场景页：作业指导 / 任务协同走 uni 页面栈（同窗口），
 * 其余页面（播报、维修、配件、甘特等）仍开独立场景窗口。
 *
 * 判定只认路径，忽略 query（guide 会带 deviceModel / experience 等参数）。
 * 同窗口打开后 `backFromScene()` 走 navigateBack 回上一级，
 * 与「退出按钮 = 关闭小程序」互不影响。
 */
export function openChatScene(url: string): Promise<void> {
  const path = String(url || "").split("?")[0];
  if (IN_APP_CHAT_ROUTES.includes(path)) {
    uni.navigateTo({ url });
    return Promise.resolve();
  }
  return navigateToScene(url);
}

/** 从初始页跳出去的一次性标记：首页回来时要停在初始页，而不是被 syncPageStage 拽回对话页 */
const RETURN_TO_WELCOME_KEY = "ai-ask-return-to-welcome";

/**
 * 记录「这次是从初始页（Hey,SANI）跳出去的」。
 *
 * 场景页回来有两条路：navigateBack / 关场景窗口 —— 首页实例还在，本来就停在初始页；
 * 以及 `redirectTo("/pages/index/index")`（听汇报关播报、关窗失败兜底）——
 * 这会新建一个首页实例，`onLoad` 的 syncPageStage 会把会员直接落回对话页。
 * 留一个一次性标记，首页无论怎么回来都停在初始页。
 */
export function markReturnToWelcome() {
  try {
    uni.setStorageSync(RETURN_TO_WELCOME_KEY, true);
  }
  catch {
    // 存储不可用时退化成「回到对话页」，不影响跳转本身
  }
}

/** 已经进对话页 / 标记失效时清掉，避免影响之后的正常返回 */
export function clearReturnToWelcome() {
  try {
    uni.removeStorageSync(RETURN_TO_WELCOME_KEY);
  }
  catch {
    // 忽略
  }
}

/** 取一次即清：true 表示首页要停在初始页 */
export function consumeReturnToWelcome() {
  try {
    if (!uni.getStorageSync(RETURN_TO_WELCOME_KEY)) return false;
    uni.removeStorageSync(RETURN_TO_WELCOME_KEY);
    return true;
  }
  catch {
    return false;
  }
}

/**
 * 返回来源场景。
 *
 * - 本页就是独立场景窗口（nativeSceneWindow=1 且栈里只有本页）：关掉 webview，回到打开它的那个窗口；
 * - 否则优先 navigateBack 回到上一页（发起跳转的那个对话页），保持原来的会话实例；
 * - 两者都不成立（比如直接用 url 打开本页）时退回到 `fallbackUrl`，**默认首页**。
 *
 * @param fallbackUrl 没有上一页、关窗也失败时的兜底路由
 */
export function backFromScene(fallbackUrl = "/pages/index/index") {
  const fallback = () => {
    if (getCurrentPages().length > 1) uni.navigateBack({ delta: 1 });
    else uni.redirectTo({ url: fallbackUrl });
  };
  if (isSceneWindowRoot()) void closeWebview().catch(fallback);
  else fallback();
}

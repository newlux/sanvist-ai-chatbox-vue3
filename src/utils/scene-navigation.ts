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

/**
 * 留在当前 webview 里跳的场景页。
 *
 * 作业指导 / 任务协同 / 听汇报以前都是 pushWindow。新开的窗口在 mPaaS 里左滑会被容器当成
 * 「关掉当前 webview」——当前窗口就是整个 mPaaS，手势直接把小程序关了。
 * 改成站内压栈之后，左滑由 installContainerBackGuard 退回上一页。
 */
const IN_PAGE_SCENE_PATHS = new Set([
  "/pages/guide/index",
  "/pages/task/index",
  "/pages/podcast/index",
]);

function scenePathname(url: string) {
  return String(url || "").split("?")[0].split("#")[0];
}

function staysInCurrentWebview(url: string) {
  return IN_PAGE_SCENE_PATHS.has(scenePathname(url));
}

export async function navigateToScene(url: string) {
  if (opening) return;
  opening = true;
  try {
    const fallback = () => uni.navigateTo({ url });
    if (staysInCurrentWebview(url) || !isMpaasReady() || typeof location === "undefined") {
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

function pageStackDepth() {
  try {
    return getCurrentPages().length;
  }
  catch {
    return 1;
  }
}

/**
 * 拦住 mPaaS 容器的返回（iOS 左滑、安卓返回键、标题栏返回）。
 *
 * 容器默认行为是关掉当前 webview。作业指导 / 任务协同 / 听汇报改成站内跳转后，
 * 这个 webview 就是整个 mPaaS，左滑会把小程序关掉。栈里还有上一页时
 * preventDefault，再 navigateBack 回到上一页；栈里只剩首页时不拦，
 * 左滑仍然退出 mPaaS。
 *
 * 有的容器派发 back 的同时还会自己 history.back。先等一小段：
 * 这段里如果已经收到 popstate，说明 uni 自己会退栈，这里不再退一次。
 */
const CONTAINER_BACK_EVENT = "back";
const CONTAINER_BACK_WAIT_MS = 50;
let containerBackGuardInstalled = false;
let containerBackPending = false;

export function installContainerBackGuard() {
  if (containerBackGuardInstalled || typeof document === "undefined") return;
  containerBackGuardInstalled = true;

  document.addEventListener(CONTAINER_BACK_EVENT, (event) => {
    if (pageStackDepth() <= 1 || containerBackPending) return;
    event.preventDefault?.();
    containerBackPending = true;
    // 没有 window（非 H5）时直接退栈；H5 走下面的 popstate 去重。
    if (typeof window === "undefined") {
      uni.navigateBack({
        delta: 1,
        complete: () => {
          containerBackPending = false;
        },
        fail: () => {
          containerBackPending = false;
        },
      });
      return;
    }

    let settled = false;
    const release = () => {
      containerBackPending = false;
    };
    const finish = (shouldNavigate: boolean) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("popstate", onPopState);
      if (!shouldNavigate || pageStackDepth() <= 1) {
        release();
        return;
      }
      uni.navigateBack({
        delta: 1,
        complete: () => {
          window.setTimeout(release, 300);
        },
        fail: release,
      });
    };
    const onPopState = () => finish(false);
    window.addEventListener("popstate", onPopState);
    window.setTimeout(() => finish(true), CONTAINER_BACK_WAIT_MS);
    // navigateBack 没回调时别把后续返回一直锁死
    window.setTimeout(release, 800);
  }, false);
}

export function isSceneWindowRoot() {
  return startupQuery.nativeSceneWindow === "1" && getCurrentPages().length <= 1;
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

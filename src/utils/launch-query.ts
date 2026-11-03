/**
 * 启动参数（launch query）解析。
 *
 * 宿主（原生 App / mPaaS 离线包）会把 Authorization、Lang、country、baseUrl 等参数
 * 拼在打开 H5 的地址上，离线包与在线包走的是同一套参数，只是入口地址指向包内页面。
 *
 * 前端有四处可能读到，按优先级从低到高合并：
 *   1. location.search —— 普通 query，如 `index.html?Lang=en_US`
 *   2. location.hash 里的 query —— 本项目用 hash 路由，宿主也常拼在
 *      `index.html#/pages/index/index?Lang=en_US` 上
 *   3. AlipayJSBridge.startupParams —— mPaaS 通过 H5AppStartParams 注入，桥上可直接读
 *   4. onLaunch(options.query) —— uni 自己解析出来的那份，最准，放最后覆盖
 *
 * 注意 bridge 是后注入的：onLaunch 那一刻可能还没有 bridge，
 * 需要晚到参数的调用方用 subscribeStartupParams 再补一次。
 */

type LaunchQuery = Record<string, unknown>;

const BRIDGE_READY_EVENT = "AlipayJSBridgeReady";

/** 解析 location.search 与 hash 里的 query（hash 覆盖 search，便于页面内跳转改写参数） */
export function readUrlLaunchQuery(): LaunchQuery {
  if (typeof location === "undefined") return {};

  const result: LaunchQuery = {};
  const search = String(location.search || "").replace(/^\?/, "");
  if (search) {
    new URLSearchParams(search).forEach((value, key) => {
      result[key] = value;
    });
  }

  const hash = String(location.hash || "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (hashQuery) {
    new URLSearchParams(hashQuery).forEach((value, key) => {
      result[key] = value;
    });
  }
  return result;
}

/** 读 mPaaS 注入的启动参数；bridge 未就绪或宿主没注入时返回空对象 */
export function readBridgeStartupParams(): LaunchQuery {
  try {
    if (typeof AlipayJSBridge === "undefined") return {};
    const params = AlipayJSBridge?.startupParams;
    return params && typeof params === "object" ? { ...params } : {};
  }
  catch {
    return {};
  }
}

/**
 * 合并出完整的启动参数，onLaunch 里直接用它。
 * 例：`resolveLaunchQuery(options).Lang` → `zh_CN` / `en_US`
 */
export function resolveLaunchQuery(options?: { query?: LaunchQuery } | null): LaunchQuery {
  return {
    ...readUrlLaunchQuery(),
    ...readBridgeStartupParams(),
    ...(options?.query || {}),
  };
}

/**
 * 订阅启动参数（用于等晚注入的 bridge）。
 *
 * - bridge 已就绪：立刻回调一次，返回空操作；
 * - 未就绪：监听 AlipayJSBridgeReady，就绪后回调一次；
 * - timeoutMs 内都没就绪：静默放弃，不回调。
 *
 * 回调参数是当时的「URL 兜底 + bridge 启动参数」，不含 onLaunch 那份。
 */
export function subscribeStartupParams(
  onParams: (params: LaunchQuery) => void,
  timeoutMs = 5000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof document !== "undefined") document.removeEventListener(BRIDGE_READY_EVENT, onReady);
  }

  function emit() {
    if (stopped) return;
    const params = { ...readUrlLaunchQuery(), ...readBridgeStartupParams() };
    cleanup();
    onParams(params);
  }

  function onReady() {
    emit();
  }

  // 已经拿到 bridge：参数就是当下这份，不用等事件
  if (Object.keys(readBridgeStartupParams()).length) {
    emit();
    return () => {};
  }

  if (typeof document === "undefined") return () => {};

  document.addEventListener(BRIDGE_READY_EVENT, onReady);
  timer = setTimeout(() => {
    if (!stopped) cleanup();
  }, timeoutMs);

  return cleanup;
}

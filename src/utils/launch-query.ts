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

/**
 * query 可能不是对象：mPaaS 有的版本把 `startupParams.query` 存成
 * URL 查询串（`Authorization=xxx&Lang=zh_CN`），甚至是带 `?` 的完整地址。
 * 统一解析成对象，解析不了的键保持原样。
 */
function parseQuerySource(source: string): LaunchQuery {
  const questionMark = source.indexOf("?");
  const text = (questionMark >= 0 ? source.slice(questionMark + 1) : source).replace(/^#\/?/, "");
  const result: LaunchQuery = {};
  if (!text) return result;
  try {
    new URLSearchParams(text).forEach((value, key) => {
      result[key] = value;
    });
  }
  catch {
    return result;
  }
  return result;
}

/**
 * 读 mPaaS 注入的启动参数；bridge 未就绪或宿主没注入时返回空对象。
 *
 * 宿主会把真正的业务参数包一层 `query`（`startupParams.query.Authorization`），
 * 这里把 query 里的键摊平到顶层，同时保留 `query` 原始值（对象或查询串都认），
 * 两种取法都能用；顶层与 query 冲突时以 query 为准（宿主真正传的业务参数）。
 */
export function readBridgeStartupParams(): LaunchQuery {
  try {
    if (typeof AlipayJSBridge === "undefined") return {};
    const params = AlipayJSBridge?.startupParams;
    if (!params || typeof params !== "object") return {};

    const raw = { ...params } as LaunchQuery;
    const nestedRaw = raw.query;
    const nested = typeof nestedRaw === "string"
      ? parseQuerySource(nestedRaw)
      : nestedRaw && typeof nestedRaw === "object"
        ? (nestedRaw as LaunchQuery)
        : null;
    // 宿主有时把参数拼在 startupParams.url 上（离线包地址），同样解析后兜底
    const fromUrlInParams = typeof raw.url === "string" ? parseQuerySource(raw.url) : {};

    return { ...fromUrlInParams, ...raw, ...(nested || {}) };
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
 * 联调用：把启动参数的各个来源分别摊开，便于确认真机上宿主到底传了什么、从哪条通道传的。
 *
 * 与 resolveLaunchQuery 的合并顺序一致：url → bridge → onLaunch.query（后者覆盖前者）。
 */
export function describeLaunchSources(options?: { query?: LaunchQuery } | null) {
  const url = typeof location === "undefined"
    ? { href: "", search: "", hash: "", referrer: "" }
    : {
        // 宿主跳转进来的完整地址（含 hash 上的 query），离线包地址也能从这里看出来
        href: location.href,
        search: location.search,
        hash: location.hash,
        referrer: typeof document === "undefined" ? "" : document.referrer,
      };

  const fromBridge = readBridgeStartupParams();

  return {
    url,
    fromUrl: readUrlLaunchQuery(),
    // 已摊平 query 的桥参数；query 若是查询串，摊平后顶层就有 Authorization
    fromBridge,
    // 摊平后顶层取出来的 token，日志里直接对一下
    bridgeAuthorization: String(fromBridge.Authorization || fromBridge.authorization || "").trim(),
    // query 是对象还是字符串（宿主两种形态都出现过，查不到 token 时先看这个）
    bridgeQueryType: typeof fromBridge.query,
    fromOnLaunch: { ...(options?.query || {}) },
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

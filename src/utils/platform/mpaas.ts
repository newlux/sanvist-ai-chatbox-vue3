/**
 * 阿里 mPaaS 容器（AlipayJSBridge）调用封装。
 *
 * 页面以 H5 形式嵌在宿主 APP 的 mPaaS webview 里，原生能力统一走 AlipayJSBridge：
 *   AlipayJSBridge.call(apiName, params, callback)
 *
 * 两个关键点：
 * - bridge 是异步注入的。页面脚本先执行、bridge 后到位是常态，
 *   必须监听 AlipayJSBridgeReady，不能假设一上来就有。
 * - 宿主不一定实现了某个 API。所有调用都要能优雅降级回 Web 方案，
 *   不能因为拿不到 bridge 就把功能卡死。
 */

type BridgeResult = Record<string, unknown>;

interface AlipayBridge {
  call: (name: string, params?: unknown, callback?: (result: BridgeResult) => void) => void;
}

const BRIDGE_READY_EVENT = "AlipayJSBridgeReady";
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

function readBridge(): AlipayBridge | undefined {
  // 支付宝真机 JSVM 没有 globalThis，只能用 typeof 读宿主注入的全局
  try {
    if (typeof AlipayJSBridge !== "undefined" && typeof AlipayJSBridge?.call === "function") {
      return AlipayJSBridge as unknown as AlipayBridge;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** 当前是否已经拿到 bridge。调用方据此决定走原生还是 Web 兜底 */
export function isMpaasReady() {
  return Boolean(readBridge());
}

/**
 * 等待 bridge 就绪。已就绪则同步兑现，最多等 timeoutMs，超时按「不可用」处理。
 */
export function waitForMpaas(timeoutMs = 3000): Promise<AlipayBridge | null> {
  const bridge = readBridge();
  if (bridge) return Promise.resolve(bridge);
  if (typeof document === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onReady = () => finish(readBridge() || null);

    function finish(value: AlipayBridge | null) {
      if (settled) return;
      settled = true;
      document.removeEventListener(BRIDGE_READY_EVENT, onReady);
      if (timer) clearTimeout(timer);
      resolve(value);
    }

    timer = setTimeout(() => finish(null), timeoutMs);
    document.addEventListener(BRIDGE_READY_EVENT, onReady, false);
  });
}

export class MpaasUnavailableError extends Error {
  constructor(apiName: string) {
    super(`mPaaS 能力不可用：${apiName}`);
    this.name = "MpaasUnavailableError";
  }
}

/**
 * 调用一个原生能力。
 * 宿主未实现或未注入 bridge 时抛 MpaasUnavailableError，由调用方降级。
 */
export async function callNative<T extends BridgeResult = BridgeResult>(
  apiName: string,
  params: Record<string, unknown> = {},
  options: { timeoutMs?: number; waitReadyMs?: number } = {},
): Promise<T> {
  const bridge = await waitForMpaas(options.waitReadyMs ?? 3000);
  if (!bridge) throw new MpaasUnavailableError(apiName);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${apiName} 调用超时`));
    }, options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);

    try {
      bridge.call(apiName, params, (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // mPaaS 的失败约定不统一，error/errorCode 非 0 都按失败处理
        const errorCode = Number(result?.error ?? result?.errorCode ?? 0);
        if (errorCode) {
          const message = String(result?.errorMessage || result?.message || `${apiName} 调用失败`);
          reject(new Error(`${message}（${errorCode}）`));
          return;
        }
        resolve((result || {}) as T);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 发起调用但不关心结果，宿主没实现也不报错（用于纯通知类能力） */
export function callNativeSilently(apiName: string, params: Record<string, unknown> = {}) {
  callNative(apiName, params).catch((error) => {
    console.warn(`[mpaas] ${apiName} 调用失败`, error);
  });
}

/** token 失效：前端换不了，只能通知宿主重新下发 */
export function notifyTokenExpiration() {
  callNativeSilently("tokenExpiration");
}

/** 关闭当前 webview，把返回交回宿主 */
export async function closeWebview() {
  await callNative("popWindow");
}

/** 保存图片到系统相册。dataUrl 为 base64 图片 */
export async function saveImageToAlbum(dataUrl: string) {
  await callNative("saveImage", { url: dataUrl, imageUrl: dataUrl });
}

/** 设置 webview 标题栏文案 */
export function setNativeTitle(title: string) {
  callNativeSilently("setTitle", { title });
}

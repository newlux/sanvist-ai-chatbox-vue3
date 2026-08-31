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

import { createLogger } from "@/utils/logger";

const logger = createLogger("mpaas");

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

/** 原样打印原生回参，但把 base64 这类大字段压成长度，避免刷屏 */
function summarizeResult(result: BridgeResult | undefined) {
  if (!result || typeof result !== "object") return result;
  const out: Record<string, unknown> = {};
  Object.entries(result).forEach(([key, value]) => {
    out[key] = typeof value === "string" && value.length > 120
      ? `<${value.length} chars>`
      : value;
  });
  return out;
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
  options: { timeoutMs?: number; waitReadyMs?: number; silentTimeout?: boolean } = {},
): Promise<T> {
  const bridge = await waitForMpaas(options.waitReadyMs ?? 3000);
  if (!bridge) throw new MpaasUnavailableError(apiName);

  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const startedAt = Date.now();
  logger.debug(`call ${apiName}`, params);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // 有些 JSAPI 在「无事可做」时压根不回调（录音相关的几个都有这毛病），
      // 这类超时是预期内的，调用方会传 silentTimeout 降噪
      const log = options.silentTimeout ? logger.debug : logger.error;
      log(`${apiName} 调用超时`, { timeoutMs, params });
      reject(new Error(`${apiName} 调用超时`));
    }, timeoutMs);

    try {
      bridge.call(apiName, params, (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logger.debug(`${apiName} result`, summarizeResult(result), { costMs: Date.now() - startedAt });
        // mPaaS 的失败约定不统一，error/errorCode 非 0 都按失败处理
        const errorCode = Number(result?.error ?? result?.errorCode ?? 0);
        if (errorCode) {
          const message = String(result?.errorMessage || result?.message || `${apiName} 调用失败`);
          logger.error(`${apiName} 调用失败`, summarizeResult(result));
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

/**
 * 订阅原生主动推送的事件。
 *
 * Nebula 有两条推送通道，宿主用哪条不确定，两条都挂上：
 * - AlipayJSBridge.on(eventName, handler)
 * - document 上派发的同名 DOM 事件（payload 在 event.data 或 event.detail）
 *
 * 返回取消订阅的函数。宿主没推这个事件时，这里就是纯粹的空转，无副作用。
 */
export function onNativeEvent(eventName: string, handler: (payload: BridgeResult) => void) {
  const readPayload = (event: unknown) => {
    const source = event as { data?: BridgeResult; detail?: BridgeResult };
    return (source?.data || source?.detail || (event as BridgeResult) || {}) as BridgeResult;
  };
  const domHandler = (event: Event) => handler(readPayload(event));
  const bridgeHandler = (payload: BridgeResult) => handler(payload || {});
  type EventBridge = AlipayBridge & {
    on?: (name: string, cb: (payload: BridgeResult) => void) => void;
    off?: (name: string, cb: (payload: BridgeResult) => void) => void;
  };

  let disposed = false;
  let subscribedBridge: EventBridge | undefined;

  function bindBridgeEvent() {
    if (disposed) return;
    const bridge = readBridge() as EventBridge | undefined;
    if (!bridge || bridge === subscribedBridge || typeof bridge.on !== "function") {
      logger.debug("[mpaas] 未通过 bridge.on 订阅", { eventName, hasBridge: Boolean(bridge), hasOn: typeof bridge?.on === "function" });
      return;
    }
    if (typeof subscribedBridge?.off === "function") {
      subscribedBridge.off(eventName, bridgeHandler);
    }
    subscribedBridge = bridge;
    bridge.on(eventName, bridgeHandler);
    logger.info(`[mpaas] 已通过 AlipayJSBridge.on 订阅 ${eventName}`);
  }

  bindBridgeEvent();
  if (typeof document !== "undefined") {
    document.addEventListener(eventName, domHandler);
    document.addEventListener(BRIDGE_READY_EVENT, bindBridgeEvent);
  }

  return () => {
    disposed = true;
    if (typeof subscribedBridge?.off === "function") subscribedBridge.off(eventName, bridgeHandler);
    if (typeof document !== "undefined") {
      document.removeEventListener(eventName, domHandler);
      document.removeEventListener(BRIDGE_READY_EVENT, bindBridgeEvent);
    }
    subscribedBridge = undefined;
  };
}

/** 发起调用但不关心结果，宿主没实现也不报错（用于纯通知类能力） */
export function callNativeSilently(apiName: string, params: Record<string, unknown> = {}) {
  callNative(apiName, params).catch((error) => {
    logger.warn(`[mpaas] ${apiName} 调用失败`, error);
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

/**
 * 保存图片到系统相册。
 * 宿主约定：入参 { base64 }（不带 data:image/...;base64, 前缀），
 * 出参 { success: true|false, code }。失败时 success 为 false，抛出去让调用方降级。
 */
export async function saveImageToAlbum(dataUrl: string) {
  const base64 = String(dataUrl || "").replace(/^data:[^;]*;base64,/, "");
  if (!base64) throw new Error("图片数据为空");

  const result = await callNative("saveImageToAlbum", { base64 });
  if (result?.success === false || String(result?.success) === "false") {
    throw new Error(`保存失败（code=${result?.code ?? "unknown"}）`);
  }
}

export interface NativeSelectedFile {
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

export interface ChooseNativeFilesOptions {
  /** 是否展示文件入口。true=图片+文件；false=仅图片 */
  showFile?: boolean;
  /**
   * 允许选择的文件类型：逗号分隔的小写扩展名，如 "pdf,jpg,png"。
   * 与端上 DEFAULT_ALLOWED_EXTENSIONS 白名单保持一致；不传则由宿主按默认放开。
   */
  fileTypes?: string;
  /**
   * 原生是否已代为完成上传：为 true 时 tempFilePaths / apFilePaths 直接作为
   * 已上传的最终 URL 返回，不再下载或交给前端二次传输
   * （对应新版安卓 imageChoose 由原生完成上传的场景）。
   */
  nativeUploaded?: boolean;
}

/** 宿主可能返回远程 URL（apFilePaths 场景），先下载成本地临时文件再上传 */
function downloadRemoteFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.info("[mpaas] downloadRemoteFile start", { url });
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          logger.info("[mpaas] downloadRemoteFile success", { url, tempFilePath: res.tempFilePath });
          resolve(res.tempFilePath);
        } else {
          logger.error("[mpaas] downloadRemoteFile bad status", { url, statusCode: res.statusCode });
          reject(new Error(`downloadFile 失败（statusCode=${res.statusCode ?? "unknown"}）`));
        }
      },
      fail: (error) => {
        logger.error("[mpaas] downloadRemoteFile fail", { url, error });
        reject(error);
      },
    });
  });
}

async function resolvePickPath(raw: unknown, skipDownload = false): Promise<string> {
  const value = String(raw || "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return skipDownload ? value : downloadRemoteFile(value);
  return value;
}

/**
 * 把原生回参归一化成「可直接上传的本地文件」列表。
 * 兼容两种形态：
 * - tempFilePaths：字符串路径数组，或 { url|path, name, size, mimeType } 对象数组
 * - apFilePaths：JSON 字符串或数组（内容多为远程 URL，需要先下载）
 */
async function collectPickFiles(result: BridgeResult, skipDownload = false): Promise<NativeSelectedFile[]> {
  const tempPaths = Array.isArray(result?.tempFilePaths) ? result.tempFilePaths : [];
  let apPaths: unknown[] = [];
  const apPathsRaw = result?.apFilePaths;
  if (typeof apPathsRaw === "string") {
    try {
      apPaths = JSON.parse(apPathsRaw);
    } catch {
      apPaths = [];
    }
  } else if (Array.isArray(apPathsRaw)) {
    apPaths = apPathsRaw;
  }

  logger.info("[mpaas] collectPickFiles start", {
    tempPaths: tempPaths.length,
    apPaths: apPaths.length,
    skipDownload,
  });

  const collected: NativeSelectedFile[] = [];
  for (const item of tempPaths) {
    if (typeof item === "string") {
      const url = await resolvePickPath(item, skipDownload);
      logger.info("[mpaas] pick item(string)", { raw: item, resolved: url });
      if (url) collected.push({ url });
      continue;
    }
    if (item && typeof item === "object") {
      const file = item as Record<string, unknown>;
      const url = await resolvePickPath(file.url || file.path || file.filePath, skipDownload);
      logger.info("[mpaas] pick item(object)", {
        raw: file,
        resolved: url,
        name: file.name,
        size: file.size,
      });
      if (!url) continue;
      collected.push({
        url,
        name: String(file.name || file.fileName || file.title || ""),
        size: Number(file.size) || 0,
        mimeType: String(file.mimeType || file.type || ""),
      });
    }
  }
  for (const raw of apPaths) {
    const url = await resolvePickPath(raw, skipDownload);
    if (url) collected.push({ url });
  }
  return collected;
}

/**
 * 调起宿主原生图片/文件选择器（imageChoose），由原生弹窗完成选择与上传。
 *
 * - showFile=true：原生同时提供图片与文件入口，文件类型受 fileTypes 约束
 * - showFile=false：仅图片
 * - fileTypes：逗号分隔的小写扩展名白名单，如 "pdf,jpg,png"
 * - nativeUploaded=true：原生已代为上传，回参（tempFilePaths / apFilePaths）
 *   直接作为最终 URL 使用，前端不再二次传输
 * - nativeUploaded=false（默认）：兼容旧链路，本地路径直接返回，远程 URL 先下载成临时文件
 */
export async function chooseNativeFiles(
  count: number,
  options: ChooseNativeFilesOptions = {},
): Promise<NativeSelectedFile[]> {
  const { showFile = true, fileTypes = "", nativeUploaded = false } = options;
  const params = {
    count: Math.max(1, count),
    showFile,
    ...(fileTypes ? { fileTypes } : {}),
  };
  logger.info("[mpaas] imageChoose call start", {
    params,
    nativeUploaded,
    bridgeReady: isMpaasReady(),
  });

  const result = await callNative("imageChoose", params);

  // 打印原始回参的字段构成（不展开大数组，只给类型与长度，便于核对宿主返回形态）
  const tempRaw = (result as Record<string, unknown>)?.tempFilePaths;
  const apRaw = (result as Record<string, unknown>)?.apFilePaths;
  logger.info("[mpaas] imageChoose raw result", {
    keys: Object.keys(result || {}),
    success: result?.success,
    error: result?.error ?? result?.errorCode,
    errorMessage: result?.errorMessage ?? result?.message,
    tempFilePathsType: Array.isArray(tempRaw) ? "array" : typeof tempRaw,
    tempFilePathsLength: Array.isArray(tempRaw) ? tempRaw.length : 0,
    apFilePathsType: Array.isArray(apRaw) ? "array" : typeof apRaw,
  });

  if (result?.success === false || String(result?.success) === "false") {
    logger.error("[mpaas] imageChoose failed", { code: result?.code ?? "unknown" });
    throw new Error(`imageChoose 失败（code=${result?.code ?? "unknown"}）`);
  }

  const files = await collectPickFiles(result, nativeUploaded);
  logger.info("[mpaas] imageChoose files resolved", {
    count: files.length,
    files: files.map(f => ({ url: f.url, name: f.name, size: f.size, mimeType: f.mimeType })),
  });
  return files;
}

/** 宿主支持动态申请的系统权限 */
export type NativePermission = "photo" | "camera" | "record_audio";

const PERMISSION_LABELS: Record<NativePermission, string> = {
  photo: "相册",
  camera: "相机",
  record_audio: "麦克风",
};

function isPermissionGranted(result: BridgeResult) {
  // 文档给的出参是 { result: "1|0" }，示例代码里又用了 status: "granted"，两种都认
  const value = String(result?.result ?? result?.status ?? "").toLowerCase();
  return value === "1" || value === "granted" || value === "true";
}

/**
 * 向宿主申请系统权限。
 *
 * 返回 true 表示「可以继续」：拿到授权，或者压根不在容器里（此时交给浏览器自己弹权限框）。
 * 只有宿主明确回了未授权才返回 false。
 */
export async function ensureNativePermission(permission: NativePermission) {
  if (!isMpaasReady()) return true;

  try {
    const result = await callNative("requestPermission", { permissions: permission });
    if (isPermissionGranted(result)) return true;
    logger.warn(`[mpaas] ${permission} 权限未授予`, result);
    return false;
  } catch (error) {
    // JSAPI 没注册、调用超时都不该把功能卡死，继续走 Web 链路
    logger.warn(`[mpaas] requestPermission(${permission}) 调用失败，按未接入处理`, error);
    return true;
  }
}

/** 权限被拒时的统一提示文案 */
export function permissionDeniedMessage(permission: NativePermission) {
  return `请在系统设置中允许使用${PERMISSION_LABELS[permission]}`;
}

/**
 * 原生录音。宿主约定：
 * - microphoneStart 开录（存成 temp.m4a），出参 { success }
 * - microphoneEnd 停录并上传，出参 { success, url }
 * - 取消录音同样走 microphoneEnd（丢弃音频即可），不使用 microphoneCancel
 * - microphonePlay/{url}、microphonePause 播放控制
 */
function assertNativeSuccess(result: BridgeResult, apiName: string) {
  if (result?.success === false || String(result?.success) === "false") {
    throw new Error(`${apiName} 失败（code=${result?.code ?? "unknown"}）`);
  }
  return result;
}

export async function startNativeRecord() {
  assertNativeSuccess(await callNative("microphoneStart"), "microphoneStart");
}

/**
 * 停止录音。宿主约定：出参 { success, data }，data 就是音频的 base64。
 * 早期版本回的是上传后的地址（url），这里一并兼容，谁在就用谁。
 */
export async function stopNativeRecord() {
  // end 在原生侧要停录 + 编码（早期版本还含上传），10 秒不够，给到 30 秒
  const result = assertNativeSuccess(
    await callNative("microphoneEnd", {}, { timeoutMs: 30_000 }),
    "microphoneEnd",
  );
  const audioUrl = String(result?.url || result?.audioUrl || "");
  const audioBase64 = String(
    (typeof result?.data === "string" ? result.data : "")
    || result?.base64
    || result?.audioBase64
    || "",
  );
  if (!audioUrl && !audioBase64) throw new Error("microphoneEnd 未返回音频数据");

  // Data URL 自带类型，纯 base64 才需要补 mimeType（原生录的是 temp.m4a）
  const isDataUrl = /^data:[^;]*;base64,/i.test(audioBase64);
  return {
    audioUrl,
    audioBase64,
    mimeType: isDataUrl ? "" : String(result?.mimeType || (audioBase64 ? "audio/m4a" : "")),
  };
}

/**
 * 取消录音：走 microphoneEnd 正常收尾，只是把音频丢掉、不发识别请求。
 *
 * 不用 microphoneCancel —— 实测它在「本来就没在录」时不回调，
 * 端上只能靠超时兜，要么拖慢开录，要么把正常情况误判成失败。
 * End 是一定会回调的路径，拿到数据直接扔即可。
 */
export async function cancelNativeRecord() {
  try {
    const result = await callNative("microphoneEnd", {}, { timeoutMs: 10_000, silentTimeout: true });
    logger.debug("录音已取消，丢弃音频", { hasData: Boolean(result?.data) });
  } catch (error) {
    logger.debug("microphoneEnd（取消路径）未回调，忽略", error);
  }
}

export async function playNativeAudio(url: string) {
  assertNativeSuccess(await callNative("microphonePlay", { url }), "microphonePlay");
}

export async function pauseNativeAudio() {
  await callNative("microphonePause");
}

/** 设置 webview 标题栏文案 */
export function setNativeTitle(title: string) {
  callNativeSilently("setTitle", { title });
}

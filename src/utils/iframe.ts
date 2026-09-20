/**
 * PC 端内嵌 iframe 场景下，与主应用（父页面）的通信。
 *
 * 主应用把本页塞进悬浮窗 iframe，页面需要：
 * - 加载完成后告知主应用「已就绪」（ai-ask-ready）
 * - 用户点最小化时请求主应用收起悬浮窗（ai-ask-minimize）
 *
 * 通信只走 postMessage，不走 mPaaS bridge：这条链路的父窗口是普通网页，
 * 拿不到 AlipayJSBridge。协议与 ai.html 联调 Demo 保持一致。
 */

import { createLogger } from "@/utils/logger";

const logger = createLogger("iframe");

/** 来源标识：主应用通过启动参数 from 传入，表示当前由 PC 端内嵌 */
export const FROM_SANVIST_PC = "sanvist_pc";

/** 请求父应用收起悬浮窗 */
export const AI_ASK_MINIMIZE_ACTION = "ai-ask-minimize";
/** 告知父应用页面已就绪 */
export const AI_ASK_READY_ACTION = "ai-ask-ready";

/**
 * 允许通信的父页面 origin。
 * 主应用可能来自多个环境/域名（三一、游途），用后缀白名单统一放行；
 * 本地联调时父页面来自 localhost，端口不固定，单独用正则放行。
 */
const ALLOWED_PARENT_ORIGINS = ["https://sanvist-test.sany.com.cn"];
/** 按后缀放行的域名，覆盖 test / prod 等子域 */
const ALLOWED_PARENT_SUFFIXES = [
  ".sany.com.cn",
  ".unifytour.com",
];
const LOCALHOST_ORIGIN_RE = /^https?:\/\/localhost(?::\d+)?$/;

function isAllowedParentOrigin(origin: string): boolean {
  if (ALLOWED_PARENT_ORIGINS.includes(origin)) return true;
  if (LOCALHOST_ORIGIN_RE.test(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    return ALLOWED_PARENT_SUFFIXES.some(suffix => hostname === suffix.slice(1) || hostname.endsWith(suffix));
  }
  catch {
    return false;
  }
}

/**
 * 读取来源标识。
 *
 * 项目用 hash 路由，H5 下 onLaunch 的 options.query 未必能拿到 query 参数，
 * 所以按「启动参数 → search → hash」三级兜底（与 session-scene 的取值方式一致）。
 */
export function resolveFromParam(options?: Record<string, unknown> | null): string {
  const raw = options?.from;
  if (raw != null && String(raw).trim()) return String(raw).trim();

  if (typeof location === "undefined") return "";

  const fromSearch = new URLSearchParams(location.search || "").get("from");
  if (fromSearch) return fromSearch.trim();

  const hash = String(location.hash || "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return query ? String(new URLSearchParams(query).get("from") || "").trim() : "";
}

/** 当前是否由 PC 端主应用以内嵌方式打开 */
export function isSanvistPcEmbedded(options?: Record<string, unknown> | null): boolean {
  return resolveFromParam(options) === FROM_SANVIST_PC;
}

/**
 * 是否真的被嵌套在 iframe 里。
 *
 * 跨域时读取 window.top 不抛错（只是拿不到内容），所以直接比较引用即可；
 * 异常兜底同样返回 true —— 抛出本身往往就是跨域嵌套导致的。
 */
export function isEmbeddedInIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  }
  catch {
    return true;
  }
}

/**
 * 读出父页面的 origin，用于 postMessage 的定向投递。
 *
 * 优先 ancestorOrigins（跨域也能拿到真实来源）；退化时用 referrer 解析；
 * 两条都拿不到才用 "*" 兜底。
 */
function resolveParentOrigin(): string {
  if (typeof window === "undefined") return "*";

  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList })?.ancestorOrigins;
  if (ancestors?.length) return ancestors[ancestors.length - 1];

  if (typeof document !== "undefined" && document.referrer) {
    try {
      return new URL(document.referrer).origin;
    }
    catch {
      // referrer 非法时继续走兜底
    }
  }
  return "*";
}

/**
 * 向父应用发送消息。
 *
 * 只有在解析出的父页面来源可信时才下发；来源识别不出来（"*"）时放行，
 * 因为消息体不含业务数据，且此时无法做更严格的校验。
 *
 * @returns 是否真的投递出去，供调用方决定要不要本地兜底
 */
export function postToParent(payload: Record<string, unknown>): boolean {
  if (typeof window === "undefined" || !window.parent) return false;
  if (!isEmbeddedInIframe()) {
    logger.debug("当前不在 iframe 中，跳过发送", payload);
    return false;
  }

  const origin = resolveParentOrigin();
  if (origin !== "*" && !isAllowedParentOrigin(origin)) {
    logger.warn("父页面来源不在白名单，跳过发送", { origin, payload });
    return false;
  }

  try {
    window.parent.postMessage(payload, origin);
    return true;
  }
  catch (error) {
    logger.warn("向父页面发送消息失败", { payload, error });
    return false;
  }
}

/** 通知父应用收起悬浮窗。本页状态一律不动，收起后再展开要能无缝回来 */
export function notifyParentMinimize(): boolean {
  const ok = postToParent({ type: AI_ASK_MINIMIZE_ACTION });
  if (ok) logger.info("已通知主应用最小化");
  return ok;
}

/** 通知父应用页面已就绪，可以放心展示 */
export function notifyParentReady(): boolean {
  const ok = postToParent({ type: AI_ASK_READY_ACTION });
  if (ok) logger.info("已通知主应用页面就绪");
  return ok;
}

/**
 * 订阅父应用下发的消息。
 *
 * 只接收来源可信的消息，其余整条忽略。
 * 返回取消订阅的函数。
 */
export function onParentMessage(handler: (payload: unknown) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const listener = (event: MessageEvent) => {
    if (!isAllowedParentOrigin(event.origin)) {
      logger.debug("忽略不可信来源的消息", { origin: event.origin });
      return;
    }
    handler(event.data);
  };

  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

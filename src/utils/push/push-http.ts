import type { PushInboxPage } from "./types";
import { PUSH_DEVICE_NO, PUSH_HTTP_BASE_URL, PUSH_HTTP_TIMEOUT_MS, PUSH_INBOX_PAGE_SIZE } from "@/config/push";
import { createLogger } from "@/utils/logger";

/**
 * 推送的 HTTP 通道（协议第 6 节）：离线补漏 + 送达回执。
 *
 * 这里不复用 `utils/request`：那条链路会带上 App 的 Authorization、剥 `{code,message,data}`
 * 外层并触发 401 跳登录，而推送接口用的是车载设备的 `X-Channel / X-Device-No` 身份，
 * 两者语义不同，混用会把「推送接口 401」误判成「用户登录失效」。
 *
 * 全部失败都返回 null / false，不抛异常、不弹窗 —— 协议明确 MQTT 是主通道，
 * HTTP 只是补漏，接口没开通（跨域 / 未启用）时页面照常可用。
 */

const logger = createLogger("push-http");

interface PushHttpResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

function buildHeaders(): Record<string, string> {
  return {
    // 协议 6.1：联调阶段未开启验签，只需前两个头
    "X-Channel": "vehicle",
    "X-Device-No": PUSH_DEVICE_NO,
    "Content-Type": "application/json",
  };
}

async function requestPush<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (typeof fetch !== "function") return null;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), PUSH_HTTP_TIMEOUT_MS) : null;

  try {
    const response = await fetch(`${PUSH_HTTP_BASE_URL}${path}`, {
      ...init,
      headers: { ...buildHeaders(), ...(init?.headers as Record<string, string> | undefined) },
      signal: controller?.signal,
    });
    const text = await response.text();
    let body: PushHttpResponse<T> | null = null;
    try {
      body = text ? (JSON.parse(text) as PushHttpResponse<T>) : null;
    }
    catch {
      body = null;
    }

    // 协议 6.2：HTTP 状态与 code 都为 200 才算成功
    if (response.status !== 200 || !body || Number(body.code) !== 200) {
      logger.warn("推送接口返回异常", path, response.status, body?.code, body?.message);
      return null;
    }
    return body.data;
  }
  catch (error) {
    logger.warn("推送接口请求失败", path, error);
    return null;
  }
  finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 补取离线期间的通知（协议 6.3）。
 * 返回的 payload 与 MQTT 收到的消息逐字段相同，可能包含已收到过的，调用方按 msg_id 判重。
 */
export function fetchPushInbox(sinceId = 0, limit = PUSH_INBOX_PAGE_SIZE) {
  const params = `since_id=${Math.max(0, Math.floor(sinceId))}&limit=${Math.max(1, Math.min(100, Math.floor(limit)))}`;
  return requestPush<PushInboxPage>(`/vehicle/push/inbox?${params}`, { method: "GET" });
}

/**
 * 送达回执（协议 6.4，可选）。
 * 重复上报返回 `recorded: false` 属正常结果，不是错误。
 */
export function ackPushDelivered(msgId: string, at = new Date().toISOString()) {
  return requestPush<{ recorded: boolean }>("/vehicle/push/ack", {
    method: "POST",
    body: JSON.stringify({ msg_id: msgId, state: "delivered", at }),
  });
}

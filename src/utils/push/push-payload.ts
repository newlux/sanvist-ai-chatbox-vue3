import type { TaskDispatchPush } from "./types";
import { PUSH_KIND_TASK_DISPATCH, PUSH_SCHEMA_PREFIX } from "@/config/push";

/**
 * 推送报文的解析与校验。
 *
 * 只做「能安全渲染」这一层校验：schema 前缀、msg_id、notice 正文。
 * 其余字段缺失时不拒收（协议 5.5 要求对未定义/新增字段宽容），
 * 渲染处各自兜底，避免某台服务端少给一个 ref 就整条通知丢掉。
 */

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  }
  catch {
    return null;
  }
}

/**
 * MQTT payload / 补漏接口的 payload → 结构化通知。
 *
 * @param raw UTF-8 JSON 字符串，或已经是对象（补漏接口直接给对象）
 * @returns 不属于本协议 / 关键字段缺失时返回 null
 */
export function parseTaskDispatchPush(raw: unknown): TaskDispatchPush | null {
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!value || typeof value !== "object") return null;

  const payload = value as Partial<TaskDispatchPush>;
  const schema = String(payload.schema || "");
  // 协议 5.2：不以 sanvist.push/1 开头的消息不属于本协议
  if (!schema.startsWith(PUSH_SCHEMA_PREFIX)) return null;

  const msgId = String(payload.msg_id || "").trim();
  if (!msgId) return null;

  const notice = payload.notice as { text?: unknown } | undefined;
  if (!notice || typeof notice !== "object") return null;
  if (!String(notice.text || "").trim()) return null;

  return payload as TaskDispatchPush;
}

/** 一期只处理 task_dispatch；其余 kind 先收下（协议 5.5），由调用方决定是否展示 */
export function isTaskDispatch(payload: TaskDispatchPush | null): payload is TaskDispatchPush {
  return Boolean(payload) && String(payload?.kind || "") === PUSH_KIND_TASK_DISPATCH;
}

/** 业务日期 / 过期时间都已过期的通知：面板仍展示，但不再提示「新消息」 */
export function isPushExpired(payload: TaskDispatchPush | null, now = Date.now()) {
  const expiresAt = Date.parse(String(payload?.expires_at || ""));
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt < now;
}

/** 消息关联的后续动作（协议 5.3）：类型不认识就视为没有可执行动作 */
export function pushActionOf(payload: TaskDispatchPush | null) {
  const action = payload?.action;
  if (!action || action.type !== "open_conversation") return null;
  if (!String(action.prompt || "").trim()) return null;
  return action;
}

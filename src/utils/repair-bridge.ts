/**
 * 维修助理 ↔ 宿主（本 H5）的通知通道。
 *
 * 维修助理是 pushWindow 打开的三方 H5，跑在**另一个 webview** 里，`postMessage` 够不着；
 * 两边只能靠 mPaaS 的 H5 自定义事件（`postNotification` / `addNotifyListener`）由宿主转发。
 *
 * 两个事件名分工明确，不能混用：
 * - `REPAIR_FROM_EVENT`（`NEBULANOTIFY_SANI_REPAIR_TO_HOST`）：三方 → 宿主，本 H5 监听；
 * - `REPAIR_TO_EVENT`（`SANI_HOST_TO_REPAIR`）：宿主 → 三方，本 H5 投递。
 *
 * 每条消息都带 `channelId`：每次进维修助理换一个，拼在三方地址的 `repairChannelId` 上，
 * 三方回传时原样带回。老窗口 / 上一轮的迟到消息因此不会被当成这一轮（见 parseRepairChannelMessage）。
 *
 * 报文（与三方约定，改动时两边同步）：
 * - 收到：`{ channelId, type: "query_question" }` —— 要提问；
 *   `{ channelId, type: "conversation_created", conversationId }` —— 已建会话；
 *   `{ channelId, type: "navigate_back", source: "maix-chat" }` —— 要回上一场景；
 * - 发出：`{ channelId, type: "send_question", question }`。
 *
 * 日志：真机（打包后）排查只看 `[repair-bridge]` 与 `[mpaas]` 两段前缀，
 * 发出 / 收到 / 丢弃三处都打了原文，哪一步断了能直接看出来。
 */
import { createLogger } from "@/utils/logger";
import {
  addNativeNotifyListener,
  postNativeNotification,
  removeNativeNotifyListener,
} from "@/utils/platform/mpaas";

const logger = createLogger("repair-bridge");

/** 三方维修 H5 → 宿主：本 H5 监听这个 name */
export const REPAIR_FROM_EVENT = "NEBULANOTIFY_SANI_REPAIR_TO_HOST";
/** 宿主 → 三方维修 H5：本 H5 往这个 name 投递 */
export const REPAIR_TO_EVENT = "SANI_HOST_TO_REPAIR";
/** 通道 id 的 URL 参数名：三方页从地址上取，回传时带回来 */
export const REPAIR_CHANNEL_PARAM = "repairChannelId";

/** 三方发过来的消息类型（白名单，其余一律丢弃） */
export type RepairInboundType = "query_question" | "conversation_created" | "navigate_back";

export interface RepairInboundMessage {
  channelId: string;
  type: RepairInboundType;
  /** `conversation_created`：三方侧新建出来的维修会话 id */
  conversationId?: string;
  /** `navigate_back`：发起方标识，约定为 `maix-chat` */
  source?: string;
  [key: string]: unknown;
}

/** 一条已建立的通道：channelId 拼在 URL 上，监听由 dispose 收起 */
export interface RepairChannel {
  channelId: string;
  /**
   * 监听注册结果（true = 已挂上）。
   * 三方页一进页面就会来要提问，**pushWindow 之前必须等它**，否则第一条 query_question 会漏。
   */
  ready: Promise<boolean>;
  dispose: () => void;
}

/** 日志里只留一句话的开头：真机上问题可能很长，全量打出来反而看不清链路 */
function previewText(value: unknown, max = 60) {
  const text = String(value ?? "").trim();
  if (!text) return "(空)";
  return text.length > max ? `${text.slice(0, max)}…(${text.length}字)` : text;
}

/** 每次进维修助理都换一个通道 id：老窗口 / 上一轮的迟到回包不会串到这一轮 */
export function createRepairChannelId(): string {
  const cryptoApi = typeof crypto === "undefined" ? undefined : crypto;
  if (cryptoApi && typeof crypto.randomUUID === "function") {
    const id = cryptoApi.randomUUID();
    logger.info("新建通知通道", { channelId: id });
    return id;
  }
  const id = `rc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  logger.info("新建通知通道（无 crypto.randomUUID，已降级）", { channelId: id });
  return id;
}

/** 统一成对象：宿主推过来的可能是对象、JSON 字符串，或再包一层 data */
function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  const text = value.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }
  catch {
    return {};
  }
}

/**
 * 归一化并过滤一条通知。
 *
 * 只认三种类型（见 RepairInboundType），且 `channelId` 必须与本次通道一致 ——
 * 三方页刷新、旧窗口迟到、其它业务复用同名事件，都在这一步被挡掉。
 * 认不出来返回 null，丢弃原因打到 debug（真机排查"收不到"时看这条）。
 */
export function parseRepairChannelMessage(raw: unknown, channelId: string): RepairInboundMessage | null {
  const payload = toRecord(raw);
  // 宿主可能把 data 原样推进来，也可能再包一层 { name, data }
  const record = payload.type ? payload : toRecord(payload.data);
  const id = String(record.channelId || "").trim();
  if (!channelId || id !== channelId) {
    logger.debug("通知丢弃：channelId 不匹配", { expect: channelId || "(空)", received: id || "(空)", raw });
    return null;
  }

  const type = String(record.type || "").trim();
  if (type === "query_question") return { ...record, channelId: id, type };
  if (type === "conversation_created" && String(record.conversationId || "").trim()) {
    return { ...record, channelId: id, type };
  }
  if (type === "navigate_back") {
    // source 缺失时宽容放行（部分宿主版本不透传自定义字段），带了就必须是约定值
    const source = String(record.source || "").trim();
    if (source && source !== "maix-chat") {
      logger.debug("通知丢弃：navigate_back 的 source 不是 maix-chat", { source, raw });
      return null;
    }
    return { ...record, channelId: id, type };
  }

  logger.debug(`通知丢弃：非约定类型「${type || "空"}」`, raw);
  return null;
}

/**
 * 建立通道监听：订阅 `REPAIR_FROM_EVENT`，按 channelId 过滤后回调。
 *
 * 顺序上先 remove 再 add —— 同名监听在宿主侧只保留最新一个，
 * 不摘旧的会出现「上一轮的监听还在、同一句问题被回两遍」。
 * 返回的 `dispose` 负责摘监听，页面卸载 / 再次进入维修助理时调用。
 */
export function onRepairChannelMessage(
  channelId: string,
  handler: (message: RepairInboundMessage) => void,
): RepairChannel {
  let disposed = false;
  logger.info("建立通道监听", { event: REPAIR_FROM_EVENT, channelId });

  const ready = (async () => {
    await removeNativeNotifyListener(REPAIR_FROM_EVENT);
    if (disposed) {
      logger.info("通道已被关闭，不再注册监听", { channelId });
      return false;
    }
    const ok = await addNativeNotifyListener(REPAIR_FROM_EVENT, (payload) => {
      logger.debug("通知原文", payload);
      const message = parseRepairChannelMessage(payload, channelId);
      if (!message) return;
      logger.info("收到维修助理通知", message);
      try {
        handler(message);
      }
      catch (error) {
        logger.error("处理维修助理通知出错", message, error);
      }
    });
    if (ok) logger.info("通道监听已就绪", { event: REPAIR_FROM_EVENT, channelId });
    else logger.error("通道监听注册失败，三方页来取问题时会收不到", { channelId });
    return ok;
  })();

  return {
    channelId,
    ready,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      logger.info("关闭通道监听", { channelId });
      void removeNativeNotifyListener(REPAIR_FROM_EVENT);
    },
  };
}

/**
 * 往三方维修 H5 投递一条消息。
 *
 * 报文统一带上 channelId；返回 false = 没有 mPaaS 容器（浏览器 / PC 内嵌），通知发不出去。
 */
export async function postRepairMessage(
  channelId: string,
  type: string,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  const id = String(channelId || "").trim();
  if (!id) {
    logger.error("没有通道 id，消息发不出去", { type, data });
    return false;
  }
  logger.info("投递维修助理消息", { type, channelId: id, data });
  const sent = await postNativeNotification(REPAIR_TO_EVENT, { channelId: id, type, ...data });
  if (!sent) logger.warn("投递失败：通知没有交给宿主", { type, channelId: id });
  return sent;
}

/** 回答三方页的「取问题」：`{ type: "send_question", question }` */
export async function sendRepairQuestion(
  channelId: string,
  question: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const text = String(question || "").trim();
  if (!text) {
    logger.warn("没有可发给维修助理的问题，跳过 send_question", { channelId });
    return false;
  }
  logger.info("回三方页的提问", { channelId, question: previewText(text) });
  return postRepairMessage(channelId, "send_question", { question: text, ...extra });
}

/**
 * 最近一次三方页回传的维修会话 id（`conversation_created`）。
 *
 * 回流卡点进去要用它拼 `/repair/{id}`：摘要接口没带回会话 id 时拿这个兜底，
 * 保证卡片在结果返回后依然点得进去。
 */
let lastRepairConversationId = "";

export function rememberRepairConversationId(conversationId: unknown) {
  const id = String(conversationId || "").trim();
  if (!id) {
    logger.warn("conversation_created 没带 conversationId，已忽略");
    return;
  }
  lastRepairConversationId = id;
  logger.info("记下维修会话 id", { conversationId: id });
}

export function getRepairConversationId() {
  return lastRepairConversationId;
}

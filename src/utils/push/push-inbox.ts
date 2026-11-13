import type { PushMessageRecord } from "./types";
import {
  PUSH_MAX_NOTICES,
  PUSH_MAX_SEEN_IDS,
  PUSH_STORAGE_KEY_CURSOR,
  PUSH_STORAGE_KEY_INBOX,
  PUSH_STORAGE_KEY_SEEN,
} from "@/config/push";
import { createLogger } from "@/utils/logger";

/**
 * 推送收件箱（本地消息中心）。
 *
 * 协议 4.4 / 0.x 第 4 步：QoS 1 会重复投递，补漏接口也会返回已投递过的消息，
 * 所以必须按 `msg_id` 判重。判重表与消息列表都放本地存储 —— 页面重进 / WebView
 * 重启后仍能认出重复消息，也不会把同一批通知再弹一遍。
 *
 * 只存协议原文与接收时间，不存任务明细、不存图片文件，符合 AGENTS 的存储约束。
 */

const logger = createLogger("push-inbox");

/** 模块级缓存：面板每次重渲染不必反复读存储 */
let inboxCache: PushMessageRecord[] | null = null;
let seenCache: string[] | null = null;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = uni.getStorageSync(key);
    if (!raw) return fallback;
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (value ?? fallback) as T;
  }
  catch (error) {
    logger.warn("读取本地存储失败", key, error);
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    uni.setStorageSync(key, JSON.stringify(value));
  }
  catch (error) {
    // 存储满了 / 隐私模式：只影响下次进页面时的历史展示与跨会话判重，不影响实时接收
    logger.warn("写入本地存储失败", key, error);
  }
}

function sanitizeRecord(value: unknown): PushMessageRecord | null {
  const record = value as Partial<PushMessageRecord> | null;
  if (!record || typeof record !== "object") return null;
  const msgId = String(record.msgId || "").trim();
  if (!msgId) return null;
  if (!record.payload || typeof record.payload !== "object") return null;
  return {
    msgId,
    receivedAt: Number(record.receivedAt) || 0,
    payload: record.payload,
    read: Boolean(record.read),
  };
}

function loadSeen(): string[] {
  if (seenCache) return seenCache;
  const list = readJson<unknown>(PUSH_STORAGE_KEY_SEEN, []);
  seenCache = Array.isArray(list) ? list.map(item => String(item || "")).filter(Boolean) : [];
  return seenCache;
}

function persistSeen(msgId: string) {
  const list = loadSeen();
  list.push(msgId);
  // 环形队列：只留最近 N 条，避免无限增长
  const trimmed = list.slice(Math.max(0, list.length - PUSH_MAX_SEEN_IDS));
  seenCache = trimmed;
  writeJson(PUSH_STORAGE_KEY_SEEN, trimmed);
}

/** 当前收件箱（新 → 旧） */
export function getInbox(): PushMessageRecord[] {
  if (inboxCache) return inboxCache.slice();
  const list = readJson<unknown>(PUSH_STORAGE_KEY_INBOX, []);
  const records = (Array.isArray(list) ? list : [])
    .map(sanitizeRecord)
    .filter((item): item is PushMessageRecord => Boolean(item))
    .slice(0, PUSH_MAX_NOTICES);
  inboxCache = records;
  return records.slice();
}

/** 该 msg_id 是否已经收过（含历史会话里收过的） */
export function hasSeenPush(msgId: string) {
  const value = String(msgId || "").trim();
  if (!value) return false;
  return loadSeen().includes(value);
}

/**
 * 收下一条通知：判重 + 落库。
 *
 * @returns true 表示是首次收到；false 表示重复（调用方直接忽略，不做任何 UI 提示）
 */
export function rememberPush(record: PushMessageRecord): boolean {
  const msgId = String(record?.msgId || "").trim();
  if (!msgId) return false;
  if (hasSeenPush(msgId)) return false;

  const next = [record, ...getInbox()].slice(0, PUSH_MAX_NOTICES);
  inboxCache = next;
  writeJson(PUSH_STORAGE_KEY_INBOX, next);
  persistSeen(msgId);
  return true;
}

/** 用户点开某条通知（去「查看详情」或点卡片）时标记已读 */
export function markPushRead(msgId: string) {
  const value = String(msgId || "").trim();
  if (!value) return;
  const list = getInbox();
  const target = list.find(item => item.msgId === value);
  if (!target || target.read) return;
  target.read = true;
  inboxCache = list;
  writeJson(PUSH_STORAGE_KEY_INBOX, list);
}

/**
 * 清空收件箱。
 * 只清列表，不清判重表：清完再收到同一条重投仍然不该重新弹出来。
 */
export function clearPushInbox() {
  inboxCache = [];
  writeJson(PUSH_STORAGE_KEY_INBOX, []);
}

/** 补漏游标（outbox_id）：服务端单调递增，记录后下次只取更新的 */
export function getOutboxCursor(): number {
  const value = Number(readJson<unknown>(PUSH_STORAGE_KEY_CURSOR, 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function setOutboxCursor(outboxId: number) {
  const value = Number(outboxId);
  if (!Number.isFinite(value) || value <= 0) return;
  if (value <= getOutboxCursor()) return;
  writeJson(PUSH_STORAGE_KEY_CURSOR, value);
}

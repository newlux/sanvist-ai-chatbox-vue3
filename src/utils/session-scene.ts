import type { Identifier } from "@/api/chat/types";

export type ChatScene = "ASK" | "GUIDE" | "TASK" | "PODCAST";

const PENDING_HISTORY_SESSION_KEY = "pending-history-session";

const SCENE_PAGE: Record<ChatScene, string> = {
  ASK: "/pages/home/index",
  GUIDE: "/pages/guide/index",
  TASK: "/pages/task/index",
  // 听汇报页没有消息列表，历史问答仍回首页展示
  PODCAST: "/pages/home/index",
};

const SCENE_LABEL: Record<ChatScene, string> = {
  ASK: "问答",
  GUIDE: "作业指导",
  TASK: "任务协同",
  PODCAST: "听汇报",
};

export function getSessionScene(session?: { inputs?: Record<string, unknown> } | null): ChatScene {
  const scene = String(session?.inputs?.scene || "").toUpperCase();
  if (scene === "GUIDE" || scene === "TASK" || scene === "PODCAST") return scene;
  return "ASK";
}

export function getSessionSceneLabel(session?: { inputs?: Record<string, unknown> } | null) {
  return SCENE_LABEL[getSessionScene(session)];
}

export function getSessionId(session?: { id?: Identifier; sessionId?: Identifier } | null) {
  return session?.sessionId || session?.id || "";
}

export function isPodcastSession(session?: { inputs?: Record<string, unknown> } | null) {
  return getSessionScene(session) === "PODCAST";
}

export function readSessionIdFromOptions(options?: Record<string, unknown> | null) {
  const raw = options?.sessionId ?? options?.session_id;
  if (raw != null && String(raw).trim()) return String(raw).trim();

  if (typeof location === "undefined") return "";
  const search = new URLSearchParams(location.search || "");
  const fromSearch = search.get("sessionId") || search.get("session_id");
  if (fromSearch) return fromSearch.trim();

  const hash = String(location.hash || "");
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  if (!query) return "";
  const fromHash = new URLSearchParams(query).get("sessionId") || new URLSearchParams(query).get("session_id");
  return fromHash?.trim() || "";
}

function readPendingHistorySession() {
  try {
    const pending = uni.getStorageSync(PENDING_HISTORY_SESSION_KEY) as { scene?: ChatScene; id?: string } | "";
    if (!pending || typeof pending !== "object") return null;
    if (!pending.id || !pending.scene) return null;
    return { scene: pending.scene, id: String(pending.id) };
  }
  catch {
    return null;
  }
}

export function peekPendingHistorySession(...expectedScenes: ChatScene[]) {
  const pending = readPendingHistorySession();
  if (!pending || !expectedScenes.includes(pending.scene)) return "";
  return pending.id;
}

export function consumePendingHistorySession(...expectedScenes: ChatScene[]) {
  const id = peekPendingHistorySession(...expectedScenes);
  if (!id) return "";
  try {
    uni.removeStorageSync(PENDING_HISTORY_SESSION_KEY);
  }
  catch {
    // 清不掉也不挡这次打开
  }
  return id;
}

function stashPendingHistorySession(scene: ChatScene, id: Identifier) {
  try {
    uni.setStorageSync(PENDING_HISTORY_SESSION_KEY, { scene, id: String(id) });
  }
  catch {
    // 本地存储不可用时仍靠 URL query 兜底
  }
}

/** 与当前页场景不同则跳到对应页并带上 sessionId；相同则返回 false，由当前页就地加载。 */
export function navigateToSessionScene(
  session: { id?: Identifier; sessionId?: Identifier; inputs?: Record<string, unknown> },
  currentScene: ChatScene,
) {
  const id = getSessionId(session);
  const scene = getSessionScene(session);
  if (!id || scene === currentScene) return false;

  const page = SCENE_PAGE[scene];
  if (page === SCENE_PAGE[currentScene]) return false;

  stashPendingHistorySession(scene, id);
  const url = `${page}?sessionId=${encodeURIComponent(String(id))}`;
  if (page === "/pages/home/index") uni.redirectTo({ url });
  else uni.navigateTo({ url });
  return true;
}

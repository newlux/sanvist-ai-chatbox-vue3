import type {
  ListenBroadcastConfig,
  ListenBroadcastHistoryItem,
  ListenBroadcastLikeParams,
  ListenBroadcastLikeResult,
  ListenBroadcastPeriod,
  ListenBroadcastPreference,
  SaveListenBroadcastPreferenceParams,
  TodayListenBroadcast,
} from "./types";
import { request } from "@/utils/request";

export { consumeListenBroadcastStream } from "./play-stream";
export type { ListenBroadcastStreamHandle } from "./play-stream";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

export function getTodayListenBroadcast() {
  return request.get<TodayListenBroadcast | null>("/listen-broadcast/today").json();
}

/** 按业务日期倒序返回指定周期的历史播报。 */
export function getListenBroadcastHistory(reportPeriod: ListenBroadcastPeriod = "daily") {
  return request.get<ListenBroadcastHistoryItem[]>("/listen-broadcast/history", { reportPeriod }).json();
}

export function getListenBroadcastConfig() {
  return request.get<ListenBroadcastConfig>("/listen-broadcast/config").json();
}

/**
 * 读取当前用户已保存的听播偏好（音色/风格/汇报模块/汇报时间）。
 * 后端未写入时返回 null，由调用方决定是回退到选择页还是给默认值。
 */
export function getListenBroadcastPreference() {
  return request.get<ListenBroadcastPreference | null>("/listen-broadcast/preference").json();
}

export function saveListenBroadcastPreference(params: SaveListenBroadcastPreferenceParams) {
  return request.put<ListenBroadcastPreference>("/listen-broadcast/preference", params, jsonOptions).json();
}

/** 查询指定日期整篇听播的真实点赞状态。 */
export function getListenBroadcastLikeStatus(params: ListenBroadcastLikeParams) {
  return request.get<ListenBroadcastLikeResult>("/listen-broadcast/like/status", params).json();
}

/** 切换指定日期整篇听播的点赞状态，返回切换后的真实状态。 */
export function toggleListenBroadcastLike(params: ListenBroadcastLikeParams) {
  return request.post<ListenBroadcastLikeResult>("/listen-broadcast/like/toggle", params, jsonOptions).json();
}

import type {
  ListenBroadcastConfig,
  ListenBroadcastHistoryItem,
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

export function saveListenBroadcastPreference(params: SaveListenBroadcastPreferenceParams) {
  return request.put<ListenBroadcastPreference>("/listen-broadcast/preference", params, jsonOptions).json();
}

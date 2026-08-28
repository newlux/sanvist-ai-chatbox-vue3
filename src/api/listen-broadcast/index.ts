import type {
  ListenBroadcastConfig,
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

export function getListenBroadcastConfig() {
  return request.get<ListenBroadcastConfig>("/listen-broadcast/config").json();
}

export function saveListenBroadcastPreference(params: SaveListenBroadcastPreferenceParams) {
  return request.put<ListenBroadcastPreference>("/listen-broadcast/preference", params, jsonOptions).json();
}

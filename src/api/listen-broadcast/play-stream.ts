import type { PlayListenBroadcastParams } from "./types";
import { DEFAULT_REPORT_PLAYBACK_RATE } from "@/config/report-playback-rate";
import { createSseSession } from "@/utils/ai-stream";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

export interface ListenBroadcastStreamHandle {
  cancel: () => void;
}

/**
 * 调用方未指定语音倍速时的兜底：与听播页默认倍速同一处口径（1.2×），
 * 避免同一条链路上「页面显示 1.2x、下发给后端 1x」。
 */
const NORMAL_TTS_SPEECH_RATE: number = DEFAULT_REPORT_PLAYBACK_RATE;

export function consumeListenBroadcastStream(
  params: PlayListenBroadcastParams,
  onEvent: (payload: unknown) => void,
  onError: (error: Error) => void,
  onClose: () => void,
): ListenBroadcastStreamHandle {
  const controller = new AbortController();
  const url = `${getRequestBaseURL().replace(/\/$/, "")}/listen-broadcast/play`;
  const body: PlayListenBroadcastParams = {
    ...params,
    ttsSpeechRate: params.ttsSpeechRate ?? NORMAL_TTS_SPEECH_RATE,
  };
  const session = createSseSession({
    onEvent,
    isAborted: () => controller.signal.aborted,
  });

  void (async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: getRequestHeaders({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`听播播报失败（${response.status}）`);

      if (!response.body) {
        session.finalize(await response.text());
        onClose();
        return;
      }

      const reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) session.consumeChunk(value);
      }
      session.finalize();
      onClose();
    } catch (error) {
      if (controller.signal.aborted) {
        onClose();
        return;
      }
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { cancel: () => controller.abort() };
}

import type { RealtimeTtsParams } from "./types";
import { createSseSession } from "@/utils/ai-stream";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

export interface TtsStreamHandle {
  cancel: () => void;
}

/**
 * 分句并发合成的实时 TTS SSE 流（POST /speech/tts/stream）。
 *
 * 用 fetch + ReadableStream 消费，复用项目里的 createSseSession 做帧切分与 data 解析。
 * 返回只做单一职责：把事件逐条丢给 onEvent，结束时回调 onClose，出错回调 onError。
 * 消费方（播放队列）自行按 seq 顺序边收边播，跳过占位帧。
 */
export function consumeTextToSpeechStream(
  params: RealtimeTtsParams,
  onEvent: (payload: unknown) => void,
  onError: (error: Error) => void,
  onClose: () => void,
): TtsStreamHandle {
  const controller = new AbortController();
  const url = `${getRequestBaseURL().replace(/\/$/, "")}/speech/tts/stream`;

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
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`实时语音失败（${response.status}）`);

      // 个别 WebView 不暴露 ReadableStream，退化成一次性读取整包再解析
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

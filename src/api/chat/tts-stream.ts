import type { RealtimeTtsParams } from "./types";
import { createSseSession } from "@/utils/ai-stream";
import { getRequestBaseURL, getRequestHeaders } from "@/utils/request";

export interface TtsStreamHandle {
  cancel: () => void;
}

/** 调用方未指定语速时的固定默认值：1.2×。 */
const DEFAULT_TTS_SPEECH_RATE = 1.2;

/**
 * 「有字可念」的判定：至少要有一个字母 / 数字 / 中日韩文字。
 * 纯标点、纯 markdown 符号（如 "**。"）、纯空白都合成不出内容，直接跳过请求。
 * 这里刻意不用 \p{L} 这类 Unicode 属性转义 —— 老 WebView 不认会导致正则编译报错。
 */
const SPEAKABLE_TEXT_RE = /[0-9A-Za-z\u00C0-\u024F\u0370-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/;

/** text 里有没有值得合成的内容 */
function hasSpeakableText(text: unknown) {
  return SPEAKABLE_TEXT_RE.test(String(text ?? ""));
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
  // 没有可念的字就不发请求（模型有时只吐 "**。" 这种片段）：
  // 延后一拍再回调 onClose，与正常播完走同一条收尾路径，
  // 调用方此时已经拿到句柄，不会在赋句柄前被打断
  if (!hasSpeakableText(params?.text)) {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) onClose();
    }, 0);
    return {
      cancel: () => {
        cancelled = true;
        clearTimeout(timer);
      },
    };
  }

  const controller = new AbortController();
  const url = `${getRequestBaseURL().replace(/\/$/, "")}/speech/tts/stream`;
  // 语速由后端在合成时生效（int）；调用方不传时统一按默认语速下发。
  const body = {
    ...params,
    ttsSpeechRate: params.ttsSpeechRate ?? DEFAULT_TTS_SPEECH_RATE,
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

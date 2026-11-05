import type { RealtimeTtsChunk } from "@/api/chat/types";
import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { createLogger } from "@/utils/logger";

const logger = createLogger("speak-text");

/** 排队等待播放的一句音频（dataUrl / audioBase64 都空 = 该句合成失败的占位帧） */
interface SpeakAudioItem {
  dataUrl: string | null;
  audioBase64: string | null;
}

/** 后端返回的音频格式：wav 的 base64 以 RIFF 头开头（UklGR），其余按 mp3 处理 */
function guessAudioMime(base64: string) {
  return base64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
}

/**
 * 播报**任意一段文本**（不绑定某条消息）。
 *
 * 页面里已有的两套听播引擎都用不了本地提示语：
 * - `useChatTts` 走 `GET /chat/tts/{会话}/{消息}`，需要服务端下发的 messageId；
 * - `useRealtimeTts` 的 `togglePlay` / `feedAnswerDelta` 同样要求 messageId + sessionId，
 *   状态还要按 messageId 回写到那条消息上。
 * 本地提示语（比如「已切换到 xx 机型」）这两样都没有，所以直接用 `/speech/tts/stream`：
 * 后端按句切分合成、前端按到达顺序排队逐句播放（与 pages/podcast 的整段播报同一套链路）。
 */
export function useSpeakText() {
  const { locale } = useI18n();
  /** 是否正在播报（供 UI 需要时展示「朗读中」） */
  const playing = ref(false);

  /** 播报会话序号：换文本 / 停止时自增，旧会话的回调按它短路 */
  let sessionSeq = 0;
  let stream: TtsStreamHandle | null = null;
  let activeAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;
  let queue: SpeakAudioItem[] = [];
  /** 合成流是否已结束（结束后队列排空才算播完） */
  let streamFinished = true;

  function releaseAudio() {
    if (!activeAudio) return;
    try {
      activeAudio.stop();
      activeAudio.destroy?.();
    } catch (error) {
      // 个别容器停止失败，忽略即可
      logger.warn("停止播报失败", error);
    }
    activeAudio = null;
  }

  function playNext(seq: number) {
    if (seq !== sessionSeq) return;
    // 上一句还在播：结束回调里会再进来
    if (activeAudio) return;

    const item = queue.shift();
    if (!item) {
      if (streamFinished) playing.value = false;
      return;
    }

    const dataUrl = String(item.dataUrl || "").trim();
    const base64 = String(item.audioBase64 || "").trim();
    // 占位 / 合成失败的句子：什么都没有就跳过，继续下一句
    if (!dataUrl && !base64) {
      playNext(seq);
      return;
    }

    const audio = uni.createInnerAudioContext();
    activeAudio = audio;
    if (dataUrl) {
      audio.src = dataUrl;
    } else if (base64.startsWith("data:")) {
      audio.src = base64;
    } else {
      audio.src = `data:${guessAudioMime(base64)};base64,${base64}`;
    }

    audio.onEnded(() => {
      if (activeAudio !== audio) return;
      activeAudio = null;
      audio.destroy?.();
      playNext(seq);
    });
    audio.onError((error) => {
      if (activeAudio !== audio) return;
      logger.warn("单句播报失败", error);
      activeAudio = null;
      audio.destroy?.();
      playNext(seq);
    });
    audio.autoplay = true;
  }

  /** 停止播报：作废当前会话、清空队列、掐掉正在播的音频（幂等） */
  function stop() {
    sessionSeq += 1;
    stream?.cancel();
    stream = null;
    queue = [];
    streamFinished = true;
    releaseAudio();
    playing.value = false;
  }

  /** 播报一段文本：会先停掉上一次播报 */
  function speak(text: string) {
    const content = String(text || "").trim();
    if (!content) return;

    stop();
    const seq = ++sessionSeq;
    const rawLanguage = String(locale.value || "zh").toLowerCase();
    const language = rawLanguage.startsWith("en") ? "en" : "zh";

    playing.value = true;
    streamFinished = false;
    try {
      stream = consumeTextToSpeechStream(
        { text: content, language },
        (payload) => {
          if (seq !== sessionSeq) return;
          if (!payload || typeof payload !== "object") return;
          const chunk = payload as RealtimeTtsChunk;
          if (chunk.event === "done") return;
          if (typeof chunk.seq !== "number") return;
          queue.push({ dataUrl: chunk.dataUrl ?? null, audioBase64: chunk.audioBase64 ?? null });
          playNext(seq);
        },
        (error) => {
          if (seq !== sessionSeq) return;
          logger.warn("播报请求失败", error);
          streamFinished = true;
          playNext(seq);
        },
        () => {
          if (seq !== sessionSeq) return;
          streamFinished = true;
          playNext(seq);
        },
      );
    } catch (error) {
      if (seq !== sessionSeq) return;
      logger.warn("启动播报失败", error);
      streamFinished = true;
      playing.value = false;
    }
  }

  onBeforeUnmount(stop);

  return { speak, stop, playing };
}

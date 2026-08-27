import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import type { Identifier, RealtimeTtsChunk } from "@/api/chat/types";

import type { UiChatMessage } from "@/stores/chat-types";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getMessage } from "@/api/chat";
import { consumeTextToSpeechStream } from "@/api/chat/tts-stream";
import { useChatStore } from "@/stores";
import { createLogger } from "@/utils/logger";

const logger = createLogger("rt-tts");

interface AudioItem {
  dataUrl?: string | null;
  audioBase64?: string | null;
  format?: string | null;
}

function guessAudioMime(base64: string) {
  if (base64.startsWith("UklGR")) return "audio/wav";
  return "audio/mpeg";
}

/**
 * 把 /messages 返回的 answer 清洗成自然连贯的中文口播文本。
 * 去掉 markdown 语法（标题/加粗/列表符/代码块/链接等），列表项改顿号连接，
 * 换行直接串起来，凑成一个完整句子，避免 TTS 读出 “n-”“\n” 这类符号。
 */
function cleanAnswerText(raw: string): string {
  let text = String(raw || "");

  // 代码块与行内代码
  text = text.replace(/```[\s\S]*?```/g, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // 图片 / 链接：只保留文本
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // 加粗 / 斜体
  text = text.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1$2");
  text = text.replace(/(^|[^_])_([^_]+)_/g, "$1$2");

  // 标题 / 引用
  text = text.replace(/^#{1,6}\s*/gm, "");
  text = text.replace(/^>\s*/gm, "");

  // 无序 / 有序列表项：连带的空格和换行一起替换成顿号
  text = text.replace(/(?:[ \t]*\n)+[ \t]*[-*+][ \t]+/g, "、");
  text = text.replace(/(?:[ \t]*\n)+[ \t]*\d+[.、)）][ \t]*/g, "、");

  // 表格：去掉表头分隔行，| 转顿号
  text = text.replace(/^[\s|:\-]+$/gm, "");
  text = text.replace(/\|/g, "、");

  // 合并空白，去掉换行，串成一句
  text = text.replace(/[ \t\r]+/g, " ");
  text = text.replace(/\n+/g, "");

  // 修正连续分隔符与「：、」这类错误
  text = text.replace(/([：:])\s*、+/g, "$1");
  text = text.replace(/[、，,]{2,}/g, "、");

  text = text.replace(/^[、，,；;：:。\s]+/g, "");
  text = text.trim();

  // 边界情况：非代码文本里残留的列表符
  text = text.replace(/^\s*[-*+]\s+/gm, "");

  if (text && !/[。！？!?；;]$/.test(text)) text += "。";
  return text;
}

/**
 * 实时 TTS（分句并发合成，SSE 流式）。只在用户点击新对话消息的播音按钮时触发：
 * 先 GET /messages/{messageId} 取权威 answer，再 POST /speech/tts/stream 逐句流式播放。
 * audio_chunk 按到达顺序（即原文句序）排进单一队列，逐条播放；
 * dataUrl/audioBase64 都为空的占位/失败句直接跳过，继续播下一句。
 *
 * 历史对话仍走 useChatTts + GET /chat/tts，本引擎不影响它。
 */
export function useRealtimeTts() {
  const { locale } = useI18n();
  const chatStore = useChatStore();
  const playing = ref(false);
  const playingMessageId = ref<Identifier | null>(null);
  const playingMessageKey = ref<string | null>(null);

  let sessionSeq = 0;
  let streamFinished = false;
  let activeStream: TtsStreamHandle | null = null;
  let audioQueue: AudioItem[] = [];
  let activeAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

  function patchMessage(messageId: Identifier, patch: { ttsLoading?: boolean; ttsPlaying?: boolean }) {
    const key = String(messageId);
    const index = chatStore.messages.findIndex(message => String(message.messageId) === key);
    if (index < 0) return;
    chatStore.replaceMessage(index, { ...chatStore.messages[index], ...patch });
  }

  function releaseAudio() {
    if (!activeAudio) return;
    try {
      activeAudio.stop();
      activeAudio.destroy?.();
    } catch {
      // 个别容器停止失败，忽略
    }
    activeAudio = null;
  }

  function playNext(messageId: Identifier, seq: number) {
    if (seq !== sessionSeq) return;
    if (activeAudio) return;

    const item = audioQueue.shift();
    if (!item) {
      if (streamFinished && playingMessageId.value === messageId) {
        playing.value = false;
        playingMessageId.value = null;
        playingMessageKey.value = null;
        patchMessage(messageId, { ttsLoading: false, ttsPlaying: false });
      }
      return;
    }

    const dataUrl = String(item.dataUrl || "").trim();
    const base64 = String(item.audioBase64 || "").trim();

    // 占位/失败句：什么都没有就跳过去，继续播下一句。
    if (!dataUrl && !base64) {
      playNext(messageId, seq);
      return;
    }

    playing.value = true;
    // 部分 WebView 不会可靠触发 InnerAudioContext.onPlay；拿到首个可播分片即结束 loading，展示停止图标。
    patchMessage(messageId, { ttsLoading: false, ttsPlaying: true });

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
      playNext(messageId, seq);
    });
    audio.onError((error) => {
      if (activeAudio !== audio) return;
      logger.info("跳过无法播放的语音句", { error });
      activeAudio = null;
      audio.destroy?.();
      playNext(messageId, seq);
    });
    audio.onPlay(() => {
      if (activeAudio !== audio) return;
      patchMessage(messageId, { ttsLoading: false, ttsPlaying: true });
    });
    audio.autoplay = true;
  }

  function handleChunk(payload: unknown, messageId: Identifier, seq: number) {
    if (seq !== sessionSeq) return;
    if (!payload || typeof payload !== "object") return;
    const chunk = payload as RealtimeTtsChunk;

    if (chunk.event === "done") return;
    if (typeof chunk.seq === "number") {
      audioQueue.push({
        dataUrl: chunk.dataUrl ?? null,
        audioBase64: chunk.audioBase64 ?? null,
        format: chunk.format ?? null,
      });
      playNext(messageId, seq);
    }
  }

  function finishRequest(messageId: Identifier, seq: number) {
    if (seq !== sessionSeq) return;
    activeStream = null;
    streamFinished = true;
    patchMessage(messageId, { ttsLoading: false });
    playNext(messageId, seq);
  }

  /** 点击播音按钮：同一条消息再点一次则停止；否则拉取 answer 并流式播放。 */
  async function togglePlay(message: UiChatMessage) {
    const messageId = message?.messageId;
    const conversationId = message?.sessionId;
    if (messageId == null || conversationId == null) return;

    if (playingMessageId.value === messageId) {
      stop();
      return;
    }

    stop();
    streamFinished = false;
    const seq = ++sessionSeq;
    const rawLanguage = String(locale.value || "zh").toLowerCase();
    const language = rawLanguage.startsWith("zh") ? "zh" : rawLanguage.startsWith("en") ? "en" : "zh";
    playingMessageId.value = messageId;
    playingMessageKey.value = String(message.id ?? messageId);
    patchMessage(messageId, { ttsLoading: true, ttsPlaying: false });

    try {
      const detail = await getMessage(messageId, { conversationId });
      if (seq !== sessionSeq) return;
      const text = cleanAnswerText(detail?.answer);
      if (!text) {
        finishRequest(messageId, seq);
        playingMessageId.value = null;
        playingMessageKey.value = null;
        return;
      }

      activeStream = consumeTextToSpeechStream(
        { text, language },
        payload => handleChunk(payload, messageId, seq),
        (error) => {
          if (seq !== sessionSeq) return;
          logger.warn("实时语音请求失败", error);
          finishRequest(messageId, seq);
        },
        () => finishRequest(messageId, seq),
      );
    } catch (error) {
      if (seq !== sessionSeq) return;
      logger.warn("获取消息详情失败", error);
      finishRequest(messageId, seq);
      playingMessageId.value = null;
      playingMessageKey.value = null;
    }
  }

  function stop() {
    sessionSeq += 1;
    streamFinished = false;
    activeStream?.cancel();
    activeStream = null;
    audioQueue = [];
    releaseAudio();
    if (playingMessageId.value != null) {
      patchMessage(playingMessageId.value, { ttsLoading: false, ttsPlaying: false });
    }
    playingMessageId.value = null;
    playingMessageKey.value = null;
    playing.value = false;
  }

  onBeforeUnmount(stop);

  return {
    togglePlay,
    stop,
    playing,
    playingMessageId,
    playingMessageKey,
  };
}

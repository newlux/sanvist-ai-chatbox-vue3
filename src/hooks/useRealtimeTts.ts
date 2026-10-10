import type { TtsStreamHandle } from "@/api/chat/tts-stream";
import type { Identifier, RealtimeTtsChunk } from "@/api/chat/types";

import type { UiChatMessage } from "@/stores/chat-types";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
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

function extractAnswerText(message: UiChatMessage): string {
  const fromBlocks = (message.blocks || [])
    .filter(block => block.type === "answer")
    .map(block => String(block.payload?.content || ""))
    .join("");
  return fromBlocks || String(message.content || "");
}

/**
 * 把 /messages 返回的 answer 清洗成自然连贯的中文口播文本。
 * 去掉 markdown 语法（标题/加粗/列表符/代码块/链接等），列表项改顿号连接，
 * 换行直接串起来，凑成一个完整句子，避免 TTS 读出 “n-”“\n” 这类符号。
 */
function cleanAnswerText(raw: string): string {
  let text = String(raw || "");

  // 正文里残留的协议块（如 <COMPONENT>{...}</COMPONENT>）只用于渲染，不参与口播
  text = text.replace(/<(SANVIST|ASK|GUIDE|COMPONENT)>[\s\S]*?<\/\1>/g, "");

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

/** 流式喂数时取「最后一个句末标点之后」的边界：边界之前的文本视为完整句子可送 TTS。 */
function lastSentenceBoundary(text: string) {
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const ch = text[i];
    if ("。！？!?；;\n".includes(ch)) return i + 1;
    // 半角句点要求后面是空白/结尾，避免把 3.14 这类小数从中间切开。
    if (ch === ".") {
      const next = text[i + 1];
      if (next === undefined || next === " " || next === "\t" || next === "\n") return i + 1;
    }
  }
  return 0;
}

/**
 * 实时 TTS（分句并发合成，SSE 流式）。只在用户点击新对话消息的播音按钮时触发：
 * 直接取当前消息对象里已经渲染好的 content 文本，再 POST /speech/tts/stream 逐句流式播放。
 * audio_chunk 按到达顺序（即原文句序）排进单一队列，逐条播放；
 * dataUrl/audioBase64 都为空的占位/失败句直接跳过，继续播下一句。
 *
 * 历史对话仍走 useChatTts + GET /chat/tts，本引擎不影响它。
 */
export function useRealtimeTts(scope?: string) {
  const { locale } = useI18n();
  const chatStore = useChatStore(scope);
  const playing = ref(false);
  const playingMessageId = ref<Identifier | null>(null);
  const playingMessageKey = ref<string | null>(null);

  let sessionSeq = 0;
  let streamFinished = false;
  let activeStream: TtsStreamHandle | null = null;
  let audioQueue: AudioItem[] = [];
  let activeAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

  /** 流式听播会话的内部状态：输入侧（answer 文本）与请求链是否已全部结束。 */
  interface StreamingSession {
    /** 在途/排队的 TTS 请求批次数；> 0 时会话还不能收尾。 */
    pendingFetches: number;
  }
  let activeSession: StreamingSession | null = null;
  /** 输入侧（流式 answer 文本）是否已收尾（message_end / 异常兜底）。 */
  let streamInputDone = true;
  /** 流式会话累计收到的原始 answer 文本。 */
  let streamedRawText = "";
  /** 已送去 TTS 的「原始文本」长度。raw 偏移是追加稳定的，不受清洗规则改写前缀的影响。 */
  let submittedRawLength = 0;
  /** 顺序请求链：上一批 TTS 流结束才发起下一批，保证音频入队顺序 = 原文顺序。 */
  let fetchChain: Promise<void> = Promise.resolve();
  /** 用户手动停止过的消息：后续增量不再自动重启听播。 */
  const manualStopKeys = new Set<string>();

  function currentLanguage() {
    const rawLanguage = String(locale.value || "zh").toLowerCase();
    return rawLanguage.startsWith("zh") ? "zh" : rawLanguage.startsWith("en") ? "en" : "zh";
  }

  function patchMessage(messageId: Identifier, patch: { ttsLoading?: boolean; ttsPlaying?: boolean }) {
    const key = String(messageId);
    const messages = chatStore.messages;
    let index = messages.findIndex(message => String(message.messageId) === key);
    if (index < 0) {
      index = messages.findIndex(message => String(message.id) === key);
    }
    if (index < 0) {
      logger.warn("patch tts state failed: message not found", { messageId: key });
      return;
    }
    chatStore.replaceMessage(index, { ...messages[index], ...patch });
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
      if (playingMessageId.value !== messageId) return;
      // 结束条件二选一：
      //  - 单发会话（togglePlay）：finishRequest 已置 streamFinished；
      //  - 流式会话（feedAnswerDelta）：输入已收尾 + 请求链排空 + 无在途请求。
      //    settleStreamIdle 在音频还在播时会提前返回，最后一口气收尾只能靠这里兜住，
      //    否则会话挂死（停止图标永不消失）。
      const drained = streamFinished
        || (streamInputDone && activeSession && activeSession.pendingFetches <= 0 && !activeStream);
      if (drained) {
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

  /**
   * 流式会话收尾判定：输入侧结束 + 请求链排空 + 音频队列播完 + 无在播音频，
   * 才置 streamFinished 并让 playNext 走正常结束分支。
   */
  function settleStreamIdle(seq: number, messageId: Identifier, session: StreamingSession) {
    if (seq !== sessionSeq || activeSession !== session) return;
    if (!streamInputDone) return;
    if (session.pendingFetches > 0) return;
    if (activeStream) return;
    if (audioQueue.length) return;
    if (activeAudio) return;
    streamFinished = true;
    patchMessage(messageId, { ttsLoading: false });
    playNext(messageId, seq);
  }

  /** 把一批完整句子送 TTS。挂到顺序链上：上一批流结束才发起下一批，保证播报顺序。 */
  function enqueueTtsBatch(text: string, messageId: Identifier, seq: number, session: StreamingSession) {
    if (!text) return;
    session.pendingFetches += 1;
    const language = currentLanguage();
    fetchChain = fetchChain.then(() => new Promise<void>((resolve) => {
      const settle = () => {
        if (activeSession === session) session.pendingFetches -= 1;
        activeStream = null;
        resolve();
        settleStreamIdle(seq, messageId, session);
      };
      // 会话已被替换/停止：直接放行，不再发起请求。
      if (seq !== sessionSeq || activeSession !== session) return settle();
      try {
        activeStream = consumeTextToSpeechStream(
          { text, language },
          payload => handleChunk(payload, messageId, seq),
          () => settle(),
          () => settle(),
        );
      } catch {
        settle();
      }
    }));
  }

  /**
   * 流式听播：answer 文字边渲染边喂数据。第一块文字到达即自动开播（等价于自动点了
   * 播音按钮），之后每攒够一个完整句子就送一批 TTS，音频按原文顺序排队播放；
   * ended = true 时把没等到句末标点的尾巴也送出去并收尾。
   */
  function feedAnswerDelta(message: UiChatMessage, deltaText: string, ended: boolean) {
    const messageId = message?.messageId;
    if (messageId == null || message?.sessionId == null) return;
    const key = String(message.id ?? messageId);
    if (manualStopKeys.has(key)) return;

    if (playingMessageKey.value !== key) {
      // 新答案的第一块文字：自动开启流式听播会话。
      stop();
      streamFinished = false;
      streamInputDone = false;
      streamedRawText = "";
      submittedRawLength = 0;
      sessionSeq += 1;
      activeSession = { pendingFetches: 0 };
      playingMessageId.value = messageId;
      playingMessageKey.value = key;
      patchMessage(messageId, { ttsLoading: true, ttsPlaying: false });
    }

    const seq = sessionSeq;
    const session = activeSession;
    if (!session || playingMessageKey.value !== key) return;

    streamedRawText += String(deltaText || "");

    // 切片必须在「原始文本」上做：raw 偏移量只会单调增长，绝不丢内容。
    // 之前按「全文清洗后差量 + 固定清洗偏移」切片，清洗不是追加稳定的
    // （合成句号被后续真实字符顶掉、markdown 后半截到达让前缀收缩、列表符转顿号改写），
    // 偏移错位会跳过若干真实文字 —— 这就是漏播的根因。
    const boundary = ended ? streamedRawText.length : lastSentenceBoundary(streamedRawText);
    if (boundary > submittedRawLength) {
      submitBatch(streamedRawText.slice(submittedRawLength, boundary), messageId, seq, session);
      submittedRawLength = boundary;
    }

    if (ended) {
      streamInputDone = true;
      // 收尾：没等到句末标点的尾巴直接送出去，保证最后一个分句也能播。
      if (submittedRawLength < streamedRawText.length) {
        submitBatch(streamedRawText.slice(submittedRawLength), messageId, seq, session);
        submittedRawLength = streamedRawText.length;
      }
      settleStreamIdle(seq, messageId, session);
    }
  }

  /** 清洗一批原始文本并送 TTS。每批独立清洗，批与批之间互不影响偏移。 */
  function submitBatch(batchRaw: string, messageId: Identifier, seq: number, session: StreamingSession) {
    // 前置换行让「行首规则」（标题 # / 引用 > / 列表 - 等）在批次开头也能命中。
    const batch = cleanAnswerText(`\n${batchRaw}`);
    if (!batch) return;
    enqueueTtsBatch(batch, messageId, seq, session);
  }

  /** 点击播音按钮：同一条消息再点一次则停止；否则取当前消息 content 并流式播放。 */
  async function togglePlay(message: UiChatMessage) {
    const messageId = message?.messageId;
    if (messageId == null || message?.sessionId == null) return;

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
      const text = cleanAnswerText(extractAnswerText(message));
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
    // 自动听播会话被停止（用户点了停止 / 切到别的消息）：这条消息后续增量不再自动重启。
    if (!streamInputDone && playingMessageKey.value) manualStopKeys.add(playingMessageKey.value);
    sessionSeq += 1;
    streamFinished = false;
    activeStream?.cancel();
    activeStream = null;
    audioQueue = [];
    releaseAudio();
    // 流式增量会话一并作废：排队的链式请求因 seq 不匹配自然短路。
    activeSession = null;
    streamInputDone = true;
    streamedRawText = "";
    submittedRawLength = 0;
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
    feedAnswerDelta,
    stop,
    playing,
    playingMessageId,
    playingMessageKey,
  };
}

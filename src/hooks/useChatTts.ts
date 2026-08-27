import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { getTextToSpeech } from "@/api/chat";
import { useChatStore } from "@/stores";

import { createLogger } from "@/utils/logger";

const logger = createLogger("tts");

function guessAudioMime(base64: string) {
  if (base64.startsWith("UklGR")) return "audio/wav";
  return "audio/mpeg";
}

export function useChatTts() {
  const { t } = useI18n();
  const chatStore = useChatStore();
  const activeMessageId = ref<string | number | null>(null);
  let audioCtx: ReturnType<typeof uni.createInnerAudioContext> | null = null;
  let requestSequence = 0;

  function patchMessageByMessageId(messageId: string | number, patch: { ttsLoading?: boolean; ttsPlaying?: boolean }) {
    const index = chatStore.messages.findIndex(message => message.role === "ai" && message.messageId === messageId);
    if (index < 0) return;
    chatStore.replaceMessage(index, { ...chatStore.messages[index], ...patch });
  }

  function releaseAudio() {
    requestSequence += 1;
    const messageId = activeMessageId.value;
    const audio = audioCtx;
    activeMessageId.value = null;
    audioCtx = null;
    if (messageId !== null) patchMessageByMessageId(messageId, { ttsLoading: false, ttsPlaying: false });
    if (!audio) return;
    try {
      audio.stop();
      audio.destroy?.();
    } catch (error) {
      logger.error("release audio failed", error);
    }
  }

  async function playAudio(audioUrl: string, base64: string, messageId: string | number) {
    const url = String(audioUrl || "").trim();
    const cleaned = String(base64 || "").replace(/^data:.*;base64,/i, "");
    if (!url && !cleaned) throw new Error("TTS response has no audio data");

    releaseAudio();
    const mime = cleaned ? guessAudioMime(cleaned) : "audio/mpeg";
    const audio = uni.createInnerAudioContext();
    audioCtx = audio;
    activeMessageId.value = messageId;

    const finish = () => {
      if (audioCtx !== audio) return;
      audioCtx = null;
      activeMessageId.value = null;
      patchMessageByMessageId(messageId, { ttsPlaying: false });
      audio.destroy?.();
    };
    audio.onPlay(() => patchMessageByMessageId(messageId, { ttsPlaying: true }));
    audio.onEnded(finish);
    audio.onError((error) => {
      logger.error("tts audio error", error);
      finish();
      uni.showToast({ title: t("audio-play-failed"), icon: "none" });
    });

    if (url) {
      audio.src = url;
    } else {
      const fs = typeof uni.getFileSystemManager === "function" ? uni.getFileSystemManager() : null;
      const baseDir = (uni as { env?: { USER_DATA_PATH?: string } }).env?.USER_DATA_PATH || "";

      if (fs?.writeFile && baseDir) {
        const ext = mime === "audio/wav" ? "wav" : "mp3";
        const filePath = `${baseDir}/tts_${Date.now()}.${ext}`;
        await new Promise((resolve, reject) => {
          fs.writeFile({
            filePath,
            data: cleaned,
            encoding: "base64",
            success: resolve,
            fail: reject,
          });
        });
        audio.src = filePath;
      } else {
        audio.src = `data:${mime};base64,${cleaned}`;
      }
    }

    audio.autoplay = true;
  }

  /**
   * 播放 /chat/tts 整段音频。
   * 返回 true 表示已接管播放（含“再点一次停止”）；返回 false 表示整段音频尚未就绪或播放失败。
   */
  async function onTtsClick(messageIndex: number): Promise<boolean> {
    const aiMsg = chatStore.messages[messageIndex];
    if (!aiMsg?.ttsEnabled || aiMsg.ttsLoading || !aiMsg.sessionId || !aiMsg.messageId) return false;

    if (activeMessageId.value === aiMsg.messageId) {
      releaseAudio();
      return true;
    }

    releaseAudio();
    const sequence = requestSequence;
    const messageId = aiMsg.messageId;
    activeMessageId.value = messageId;
    patchMessageByMessageId(messageId, { ttsLoading: true });
    try {
      const resp = await getTextToSpeech(aiMsg.sessionId, messageId);
      if (sequence !== requestSequence) return false;

      // 整段还没合成好（audioUrl/audioBase64 都为空）：不提示，交给调用方走流式兜底
      if (!resp?.audioUrl && !resp?.audioBase64) {
        activeMessageId.value = null;
        return false;
      }

      await playAudio(resp?.audioUrl || "", resp?.audioBase64 || "", messageId);
      return true;
    } catch (error) {
      if (sequence === requestSequence) {
        activeMessageId.value = null;
        logger.error("tts failed", error);
        // uni.showToast({ title: t("tts-play-failed"), icon: "none" });
      }
      return false;
    } finally {
      patchMessageByMessageId(messageId, { ttsLoading: false });
    }
  }

  onBeforeUnmount(releaseAudio);

  return {
    onTtsClick,
    releaseAudio,
    activeMessageId,
  };
}

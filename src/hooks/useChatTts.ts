import { onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { getTextToSpeech } from "@/api/chat";
import { useChatStore } from "@/stores";

function guessAudioMime(base64: string) {
  if (base64.startsWith("UklGR")) return "audio/wav";
  return "audio/mpeg";
}

export function useChatTts() {
  const { t } = useI18n();
  const chatStore = useChatStore();
  let audioCtx: ReturnType<typeof uni.createInnerAudioContext> | null = null;

  function releaseAudio() {
    const audio = audioCtx;
    audioCtx = null;
    if (!audio) return;
    try {
      audio.stop();
      audio.destroy?.();
    } catch (error) {
      console.error("[AiChatPage] release audio failed", error);
    }
  }

  async function playBase64Audio(base64: string) {
    const cleaned = String(base64 || "").replace(/^data:.*;base64,/i, "");
    if (!cleaned) return;

    releaseAudio();
    const mime = guessAudioMime(cleaned);
    const audio = uni.createInnerAudioContext();
    audioCtx = audio;

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

    audio.autoplay = true;
    audio.onError((error) => {
      console.error("[AiChatPage] tts audio error", error);
      uni.showToast({ title: t("audio-play-failed"), icon: "none" });
    });
  }

  async function onTtsClick(messageIndex: number) {
    const aiMsg = chatStore.messages[messageIndex];
    if (!aiMsg?.ttsEnabled || aiMsg.ttsLoading || !aiMsg.sessionId || !aiMsg.messageId) return;

    chatStore.replaceMessage(messageIndex, { ...aiMsg, ttsLoading: true });
    try {
      const resp = await getTextToSpeech(aiMsg.sessionId, aiMsg.messageId);
      await playBase64Audio(resp?.audioBase64 || "");
    } catch (error) {
      console.error("[AiChatPage] tts failed", error);
      uni.showToast({ title: t("tts-play-failed"), icon: "none" });
    } finally {
      const latest = chatStore.messages[messageIndex] || {};
      chatStore.replaceMessage(messageIndex, { ...latest, ttsLoading: false });
    }
  }

  onBeforeUnmount(releaseAudio);

  return {
    onTtsClick,
    releaseAudio,
  };
}

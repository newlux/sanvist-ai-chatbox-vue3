import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import type { AsrStreamSession } from "@/utils/asr/asr-stream-session";
import type { PcmCapture } from "@/utils/asr/pcm-capture";
import { isAsrStreamSupported, openAsrStreamSession } from "@/utils/asr/asr-stream-session";
import { isPcmCaptureSupported, startPcmCapture } from "@/utils/asr/pcm-capture";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission, getMicrophoneVolume, permissionDeniedMessage } from "@/utils/platform/mpaas";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const logger = createLogger("voice-query");

/** 静音收尾：连续这么久没声音就认为说完了 */
const VOICE_SILENCE_MS = 1500;
/** 一直没听到人声的兜底：别让麦克风空转 */
const VOICE_NO_SPEECH_MS = 8000;
/** 判定「有声音」的 RMS 阈值，低于它按静音算 */
const VOICE_LEVEL_THRESHOLD = 0.015;
/** 原生通道整段识别的最长等待：超时就当没识别到，别把录音条一直挂在「识别中」 */
const NATIVE_RECOGNIZE_TIMEOUT_MS = 30_000;
/** 录音条散开落定后再对一次落点（列表可视高这时才稳定） */
const PLACEHOLDER_PIN_DELAY_MS = 360;

interface NativeRecorderAudio {
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  tempFilePath?: string;
}

/**
 * VoiceRecorder 在 utils 下是 .js（构造时按环境返回原生 / 浏览器实现），
 * 声明文件里看不到实例方法，这里补一份本地结构，免得整页用 any。
 */
interface VoiceRecorderInstance {
  start: (options?: { sampleRate?: number; timeSlice?: number }) => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  stop: () => Promise<{ success?: boolean; error?: string; data?: NativeRecorderAudio } | undefined>;
  cancel?: () => void;
  release?: () => void;
}

export interface UseVoiceQueryOptions {
  /** 开一轮：页面创建「识别中」占位气泡并返回它的 id（创建不了就返回空串） */
  beginPlaceholder: () => string;
  /** partial 是「完整文本的当前版本」：整体替换占位气泡内容 */
  patchPlaceholder: (id: string, text: string) => void;
  /** 把占位气泡钉在对话区顶部（重复调用要幂等） */
  pinPlaceholder: (id: string) => void;
  /** 撤掉占位气泡（取消 / 没识别到内容） */
  discardPlaceholder: () => void;
  /** 发送：页面用自己的发送入口（sendQuickPrompt / sendMessage） */
  submit: (text: string, placeholderId: string) => void;
  /** 开口前：停掉正在播的语音，避免外放被麦克风收进去 */
  onStart?: () => void;
}

/**
 * 「点击说话」这条语音链路：录音条 + 实时字幕（ASR 流式 partial 直接回填到占位气泡）。
 *
 * 两条通道：
 * - stream：WebAudio 采集 + WebSocket 流式 ASR，能逐字出文字（iOS / 普通浏览器）；
 * - native：mPaaS 原生录音（microphoneStart/End）+ 整段识别，不出 partial，
 *   但在 Android WebView 这种拿不到可用音频的容器里是唯一能用的那条线。
 *
 * 优先 stream，采集起不来（getUserMedia 失败 / 采到静音）自动降级 native，每轮只降一次。
 * 与页面的耦合都收敛在 options 里：占位气泡怎么建、怎么钉、怎么发，页面自己决定。
 */
export function useVoiceQuery(options: UseVoiceQueryOptions) {
  const { t } = useI18n();

  const voiceQueryActive = ref(false);
  const voicePlaceholderId = ref("");
  const voiceLevel = ref(0);
  const voiceSeconds = ref(0);
  const voiceFinishing = ref(false);

  let voiceSession: AsrStreamSession | null = null;
  let voiceCapture: PcmCapture | null = null;
  /** 每轮一个序号：重置 / 重开时让旧回调自行作废 */
  let voiceSeq = 0;
  let voiceTickTimer: ReturnType<typeof setInterval> | null = null;
  let voiceNoSpeechTimer: ReturnType<typeof setTimeout> | null = null;
  let voicePinTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceSilenceSince = 0;
  let voiceHeard = false;
  let voiceBackend: "stream" | "native" = "stream";
  let nativeVoiceRecorder: VoiceRecorderInstance | null = null;
  let nativeLevelTimer: ReturnType<typeof setInterval> | null = null;
  let voiceDegraded = false;

  function stopNativeLevelPolling() {
    if (nativeLevelTimer) {
      clearInterval(nativeLevelTimer);
      nativeLevelTimer = null;
    }
  }

  /**
   * keepPlaceholder：final 已经回来、准备发问时置 true —— 占位气泡要留给发送入口
   * 原地替换成正式提问，这里不能删，否则会先撤掉再 push 一条新的，顶部位置会闪一下。
   */
  function resetVoiceQuery(resetOptions?: { keepPlaceholder?: boolean }) {
    // 序号自增：正在 await 权限 / 采集的启动流程据此自行作废
    voiceSeq += 1;
    if (voicePinTimer) {
      clearTimeout(voicePinTimer);
      voicePinTimer = null;
    }
    voiceQueryActive.value = false;
    voicePlaceholderId.value = "";
    voiceFinishing.value = false;
    voiceLevel.value = 0;
    voiceSeconds.value = 0;
    voiceSilenceSince = 0;
    voiceHeard = false;
    if (voiceNoSpeechTimer) {
      clearTimeout(voiceNoSpeechTimer);
      voiceNoSpeechTimer = null;
    }
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = null;
    }
    voiceCapture?.stop();
    voiceCapture = null;
    voiceSession?.close();
    voiceSession = null;
    // 降级到原生录音的那一轮：停轮询、放掉录音器（正常收尾时 finishNativeVoiceQuery 已经置空）
    stopNativeLevelPolling();
    if (nativeVoiceRecorder) {
      try {
        (nativeVoiceRecorder.release ?? nativeVoiceRecorder.cancel)?.call(nativeVoiceRecorder);
      }
      catch (error) {
        logger.warn("native recorder release failed", error);
      }
      nativeVoiceRecorder = null;
    }
    voiceBackend = "stream";
    voiceDegraded = false;
    // 没走到 final（取消 / 通道失败 / 权限被拒）：占位气泡已经没有内容可回填，撤掉
    if (!resetOptions?.keepPlaceholder) options.discardPlaceholder();
  }

  function failVoiceQuery(title: string) {
    resetVoiceQuery();
    uni.showToast({ title, icon: "none" });
  }

  /** 静音检测：说过话之后连续 1.5s 没声音就自动收尾，用户不用再点一次 */
  function onVoiceLevel(level: number) {
    // 声纹用的音量：RMS 0.15 已经算大声，再乘一次平滑，跳动才跟得上 100ms 的采样
    const normalized = Math.min(1, Math.max(0, level / 0.15));
    voiceLevel.value += (normalized - voiceLevel.value) * 0.35;

    if (level >= VOICE_LEVEL_THRESHOLD) {
      voiceHeard = true;
      voiceSilenceSince = 0;
      return;
    }
    if (!voiceHeard) return;
    if (!voiceSilenceSince) {
      voiceSilenceSince = performance.now();
      return;
    }
    if (performance.now() - voiceSilenceSince < VOICE_SILENCE_MS) return;
    stopVoiceQuery();
  }

  /** 带超时的整段识别：接口挂了也要把录音条收掉，不能一直挂在「识别中」 */
  function requestNativeRecognition(audio: NativeRecorderAudio) {
    const request = audio.audioUrl
      ? recognizeSpeechByUrl({ audioUrl: audio.audioUrl })
      : audio.audioBase64
        ? recognizeSpeechByBase64({ audioBase64: audio.audioBase64, mimeType: audio.mimeType })
        : audio.tempFilePath
          ? recognizeSpeechByUpload({ filePath: audio.tempFilePath, timeout: NATIVE_RECOGNIZE_TIMEOUT_MS })
          : Promise.reject(new Error("no audio"));

    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("recognize timeout")), NATIVE_RECOGNIZE_TIMEOUT_MS);
    });
    return Promise.race([request, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  /** 原生通道收尾：停录音 → 整段识别 → 文本交给页面发问 */
  async function finishNativeVoiceQuery() {
    const seq = voiceSeq;
    const recorder = nativeVoiceRecorder;
    nativeVoiceRecorder = null;
    stopNativeLevelPolling();
    if (!recorder) {
      resetVoiceQuery();
      return;
    }

    let audio: NativeRecorderAudio = {};
    try {
      const stopped = await recorder.stop();
      if (seq !== voiceSeq) return;
      if (!stopped?.success) {
        logger.warn("native recorder stop failed", stopped?.error);
        failVoiceQuery(t("no-audio-recorded"));
        return;
      }
      audio = stopped.data || {};
    }
    catch (error) {
      logger.warn("native recorder stop threw", error);
      if (seq === voiceSeq) failVoiceQuery(t("no-audio-recorded"));
      return;
    }

    const placeholderId = voicePlaceholderId.value;
    try {
      const result = await requestNativeRecognition(audio);
      if (seq !== voiceSeq) return;
      const query = String(result?.text || "").trim();
      // 和流式那条线保持一致：占位气泡先留着，发送入口按 asrPending 原地替换成正式提问
      resetVoiceQuery({ keepPlaceholder: true });
      if (!query) {
        options.discardPlaceholder();
        uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
        return;
      }
      options.submit(query, placeholderId);
      if (placeholderId) options.pinPlaceholder(placeholderId);
    }
    catch (error) {
      logger.warn("native recognition failed", error);
      if (seq === voiceSeq) failVoiceQuery(t("asr-no-content-retry"));
    }
  }

  /** 原生录音通道：mPaaS microphoneStart/End + 整段识别（没有 partial，只有声纹和计时） */
  async function startNativeVoiceQuery(seq: number) {
    voiceBackend = "native";
    voiceSilenceSince = 0;
    voiceHeard = false;
    try {
      const granted = await ensureNativePermission("record_audio");
      if (seq !== voiceSeq) return;
      if (!granted) {
        failVoiceQuery(permissionDeniedMessage("record_audio"));
        return;
      }

      const recorder = new VoiceRecorder() as unknown as VoiceRecorderInstance;
      const started = await recorder.start();
      if (seq !== voiceSeq) {
        (recorder.release ?? recorder.cancel)?.call(recorder);
        return;
      }
      if (!started?.success) {
        logger.warn("native recorder start failed", started?.error);
        failVoiceQuery(t("record-start-failed"));
        return;
      }

      nativeVoiceRecorder = recorder;
      // 原生录音拿不到 partial，只能轮询电平：声纹照跳，静音 1.5s 仍然自动收尾
      stopNativeLevelPolling();
      let polling = false;
      nativeLevelTimer = setInterval(() => {
        if (seq !== voiceSeq || polling) return;
        polling = true;
        void getMicrophoneVolume()
          .then((level) => {
            if (seq !== voiceSeq || typeof level !== "number") return;
            onVoiceLevel(level);
          })
          .catch(() => {})
          .finally(() => {
            polling = false;
          });
      }, 120);

      if (voiceNoSpeechTimer) clearTimeout(voiceNoSpeechTimer);
      voiceNoSpeechTimer = setTimeout(() => {
        voiceNoSpeechTimer = null;
        if (!voiceHeard) stopVoiceQuery();
      }, VOICE_NO_SPEECH_MS);
    }
    catch (error) {
      logger.warn("native voice query start failed", error);
      if (seq === voiceSeq) failVoiceQuery(t("record-start-failed"));
    }
  }

  /**
   * 流式这条路走不通时，把这一轮原地换成原生录音。
   * 占位气泡已经钉在顶部了，这里只换采集通道：不撤气泡、不重置序号，
   * 用户看到的就是「识别中…」继续在那儿，声纹继续跳，说完照样出文本。
   */
  function degradeToNativeVoice(reason: string) {
    if (voiceDegraded || !voiceQueryActive.value) return;
    voiceDegraded = true;
    const seq = voiceSeq;
    logger.warn("流式采集不可用，降级到原生录音", { reason });
    // 流式那一路彻底扔掉：采集停掉、WebSocket 关掉，否则两边一起抢麦克风
    voiceCapture?.stop();
    voiceCapture = null;
    voiceSession?.close();
    voiceSession = null;
    // 重新计时：原生录音是从现在才开始收的
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = null;
    }
    voiceSeconds.value = 0;
    voiceLevel.value = 0;
    voiceSilenceSince = 0;
    voiceHeard = false;
    voiceTickTimer = setInterval(() => {
      voiceSeconds.value += 1;
    }, 1000);
    void startNativeVoiceQuery(seq);
  }

  /** 说完了：先停采集再发 finish，等 final 回来才落成气泡 */
  function stopVoiceQuery() {
    if (!voiceQueryActive.value || voiceFinishing.value) return;
    voiceFinishing.value = true;
    // 计时停在这里：底部条要显示「最终录了几秒」，不要再涨
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = null;
    }
    // 原生通道：停录音 → 整段识别 → 回填文本（没有 finish/final 那套）
    if (voiceBackend === "native") {
      void finishNativeVoiceQuery();
      return;
    }
    voiceCapture?.stop();
    voiceCapture = null;
    voiceSession?.finish();
  }

  /** 取消这一轮：直接断流，不发 finish、不落气泡 */
  function cancelVoiceQuery() {
    if (!voiceQueryActive.value) return;
    resetVoiceQuery();
  }

  async function startVoiceQuery() {
    // 开口前先把正在播的语音掐掉：一是会盖住用户说话，二是外放声音会被麦克风收进 ASR
    options.onStart?.();

    const seq = ++voiceSeq;
    voiceFinishing.value = false;
    voiceLevel.value = 0;
    voiceSeconds.value = 0;
    voiceSilenceSince = 0;
    voiceHeard = false;
    voiceQueryActive.value = true;

    // 本轮提问一开始就落成占位气泡并顶到头部下沿：partial 回填只改内容、不换位置
    const placeholderId = options.beginPlaceholder();
    voicePlaceholderId.value = placeholderId;
    if (placeholderId) options.pinPlaceholder(placeholderId);

    /**
     * 点下去到录音条散开落定（约 300ms）之间，列表可视高还会变一次，
     * 那之后可滚量变小、之前的落点可能被 clamp 掉。等它落定再对一次落点。
     */
    if (voicePinTimer) clearTimeout(voicePinTimer);
    voicePinTimer = setTimeout(() => {
      voicePinTimer = null;
      if (voicePlaceholderId.value) options.pinPlaceholder(voicePlaceholderId.value);
    }, PLACEHOLDER_PIN_DELAY_MS);

    // 底部录音条的计时：从进入语音态就开始走，和真实录音时长对齐
    if (voiceTickTimer) clearInterval(voiceTickTimer);
    voiceTickTimer = setInterval(() => {
      voiceSeconds.value += 1;
    }, 1000);

    /**
     * 没有流式通道（无 WebSocket）或没有 WebAudio 采集能力（file:// / 老容器）：
     * 不提示「环境不支持」，直接走原生录音那条线 —— 这类环境里它是能用的。
     */
    if (!isAsrStreamSupported() || !isPcmCaptureSupported()) {
      void startNativeVoiceQuery(seq);
      return;
    }

    try {
      // 容器里要先向原生申请麦克风权限，否则浏览器那层会被静默拒绝
      const granted = await ensureNativePermission("record_audio");
      if (seq !== voiceSeq) return;
      if (!granted) {
        failVoiceQuery(permissionDeniedMessage("record_audio"));
        return;
      }

      const session = openAsrStreamSession({
        onPartial(text) {
          if (seq !== voiceSeq || !voicePlaceholderId.value) return;
          // partial 是「完整文本的当前版本」：整体替换气泡内容，不要自己拼接
          options.patchPlaceholder(voicePlaceholderId.value, text);
        },
        onFinal(text) {
          if (seq !== voiceSeq) return;
          const query = String(text).trim();
          // 占位气泡的 id 要在 reset 清空之前留住：final 之后它要接着停在顶部
          const placeholderIdAfterFinal = voicePlaceholderId.value;
          // 占位气泡先留着：发送入口按 asrPending 找到它，原地改成正式提问，顶部位置不动
          resetVoiceQuery({ keepPlaceholder: true });
          // 静音 / 误触时服务端回空串：撤掉占位，提示重说，别拿空问题去提问
          if (!query) {
            options.discardPlaceholder();
            uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
            return;
          }
          options.submit(query, placeholderIdAfterFinal);
          // 停止问答后立刻再问：布局变化可能把落点挤掉，按 id 再钉一次（幂等）
          if (placeholderIdAfterFinal) options.pinPlaceholder(placeholderIdAfterFinal);
        },
        onError() {
          // 通道层失败（握手被网关拦、服务未部署）和「没听清」要分开提示
          if (seq === voiceSeq) failVoiceQuery(t("welcome-voice-unavailable"));
        },
      });
      voiceSession = session;

      const capture = await startPcmCapture({
        onFrame: frame => session.pushFrame(frame),
        onLevel: onVoiceLevel,
        // 采集起来了但拿不到可用音频（没回调 / 采到静音）：这一轮降到原生录音
        onUnavailable: reason => degradeToNativeVoice(reason),
      });
      if (seq !== voiceSeq) {
        capture.stop();
        return;
      }
      voiceCapture = capture;

      // 采集就绪开始计时：一直没人说话就自己收尾，别让麦克风空转
      voiceNoSpeechTimer = setTimeout(() => {
        voiceNoSpeechTimer = null;
        if (!voiceHeard) stopVoiceQuery();
      }, VOICE_NO_SPEECH_MS);
    }
    catch (error) {
      // getUserMedia 三档全挂（Android WebView 常见）：不掉到「录音启动失败」，先换原生录音
      logger.warn("voice query start failed, fallback to native recorder", error);
      if (seq === voiceSeq) degradeToNativeVoice("capture-failed");
    }
  }

  onBeforeUnmount(() => {
    if (voiceTickTimer) clearInterval(voiceTickTimer);
    if (voiceNoSpeechTimer) clearTimeout(voiceNoSpeechTimer);
    if (voicePinTimer) clearTimeout(voicePinTimer);
    voiceTickTimer = null;
    voiceNoSpeechTimer = null;
    voicePinTimer = null;
    // 卸载时不能再回调页面（页面已销毁），只做资源回收
    voiceSeq += 1;
    voiceCapture?.stop();
    voiceCapture = null;
    voiceSession?.close();
    voiceSession = null;
    stopNativeLevelPolling();
    try {
      (nativeVoiceRecorder?.release ?? nativeVoiceRecorder?.cancel)?.call(nativeVoiceRecorder);
    }
    catch {
      // 释放失败无需处理
    }
    nativeVoiceRecorder = null;
  });

  return {
    voiceQueryActive,
    voicePlaceholderId,
    voiceLevel,
    voiceSeconds,
    voiceFinishing,
    startVoiceQuery,
    stopVoiceQuery,
    cancelVoiceQuery,
    resetVoiceQuery,
  };
}

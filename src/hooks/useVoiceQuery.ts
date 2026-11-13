import { createSpeechEndDetector } from "@/utils/asr/speech-end-detector";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import type { AsrStreamSession } from "@/utils/asr/asr-stream-session";
import type { PcmCapture } from "@/utils/asr/pcm-capture";
import { isAsrStreamSupported, openAsrStreamSession } from "@/utils/asr/asr-stream-session";
import { isNativePcmStreamSupported, startNativePcmCapture } from "@/utils/asr/native-pcm-stream";
import { isPcmCaptureSupported, startPcmCapture } from "@/utils/asr/pcm-capture";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission, getMicrophoneVolume, permissionDeniedMessage } from "@/utils/platform/mpaas";
import { describeRequestAuth } from "@/utils/request";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const logger = createLogger("voice-query");

/** 一直没听到人声的兜底：别让麦克风空转 */
const VOICE_NO_SPEECH_MS = 8000;
/** 原生通道整段识别的最长等待：超时就当没识别到，别把录音条一直挂在「识别中」 */
const NATIVE_RECOGNIZE_TIMEOUT_MS = 30_000;
/** 原生录音的硬上限：只做兜底，正常收尾靠用户点发送（↑） */
const NATIVE_MAX_RECORD_MS = 60_000;
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
  /** 长按期间由松手决定发送/取消，暂停静音自动发送。 */
  isHolding?: () => boolean;
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
  /** 识别成功、收起字幕前，供页面记录文字原位置以播放发送动画。 */
  onBeforeSubmit?: () => void;
  /** 开口前：停掉正在播的语音，避免外放被麦克风收进去 */
  onStart?: () => void | Promise<unknown>;
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
  let voiceHeard = false;
  const speechEndDetector = createSpeechEndDetector({
    onSilence: stopVoiceQuery,
    isPaused: () => options.isHolding?.() ?? false,
  });
  let voiceBackend: "stream" | "native" = "stream";
  let nativeVoiceStartup: Promise<void> | null = null;
  let nativeVoiceRecorder: VoiceRecorderInstance | null = null;
  let nativeLevelTimer: ReturnType<typeof setInterval> | null = null;
  /** 原生通道这一轮听到的最大音量：排查「有没有真的收到声音」时打日志用 */
  let nativePeakLevel = 0;
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
    voiceHeard = false;
    speechEndDetector.reset();
    if (voiceNoSpeechTimer) {
      clearTimeout(voiceNoSpeechTimer);
      voiceNoSpeechTimer = null;
    }
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = null;
    }
    const captureReleased = voiceCapture?.stop();
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
    nativePeakLevel = 0;
    // 没走到 final（取消 / 通道失败 / 权限被拒）：占位气泡已经没有内容可回填，撤掉
    if (!resetOptions?.keepPlaceholder) options.discardPlaceholder();
    return captureReleased;
  }

  function failVoiceQuery(title: string) {
    resetVoiceQuery();
    uni.showToast({ title, icon: "none" });
  }

  /** 静音检测：说过话之后连续 1.5s 没声音就自动收尾，用户不用再点一次 */
  function onVoiceLevel(level: number) {
    const normalized = Math.min(1, Math.max(0, level / 0.15));
    voiceLevel.value += (normalized - voiceLevel.value) * 0.35;
    if (voiceQueryActive.value && !voiceFinishing.value) {
      voiceHeard = speechEndDetector.observeLevel(level);
    }
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
      logger.info("native recorder stop", {
        seconds: voiceSeconds.value,
        peakLevel: Number(nativePeakLevel.toFixed(3)),
        hasUrl: Boolean(audio.audioUrl),
      });
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
      if (query) options.onBeforeSubmit?.();
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

    voiceHeard = false;
    speechEndDetector.reset();
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
      nativePeakLevel = 0;
      /**
       * 原生录音拿不到 partial，电平只用来驱动声纹。
       * 注意这里不能喂给 onVoiceLevel：那里面带了「静音 1.5s 自动收尾」，
       * 而 microphoneVolume 在部分容器里恒为 0 / 拿不到，一喂就等于用户话没说完就被掐掉。
       * 收尾统一交给用户点发送（↑ → stopVoiceQuery）。
       */
      stopNativeLevelPolling();
      voiceLevel.value = 0;
      let polling = false;
      nativeLevelTimer = setInterval(() => {
        if (seq !== voiceSeq || polling) return;
        polling = true;
        void getMicrophoneVolume()
          .then((level) => {
            if (seq !== voiceSeq || typeof level !== "number") return;
            if (level > nativePeakLevel) nativePeakLevel = level;
            const normalized = Math.min(1, Math.max(0, level / 0.15));
            voiceLevel.value += (normalized - voiceLevel.value) * 0.35;
          })
          .catch(() => {})
          .finally(() => {
            polling = false;
          });
      }, 120);

      // 只留一个硬上限兜底：用户忘了点发送时别让麦克风一直开着
      if (voiceNoSpeechTimer) clearTimeout(voiceNoSpeechTimer);
      voiceNoSpeechTimer = setTimeout(() => {
        voiceNoSpeechTimer = null;
        stopVoiceQuery();
      }, NATIVE_MAX_RECORD_MS);
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
    voiceHeard = false;
    speechEndDetector.reset();
    voiceTickTimer = setInterval(() => {
      voiceSeconds.value += 1;
    }, 1000);
    nativeVoiceStartup = startNativeVoiceQuery(seq);
  }

  /** 说完了：先停采集再发 finish，等 final 回来才落成气泡 */
  function stopVoiceQuery() {
    if (!voiceQueryActive.value || voiceFinishing.value) return;
    voiceFinishing.value = true;
    logger.info("[voice-query] 停止录音（等 final）", {
      seconds: voiceSeconds.value,
      backend: voiceBackend,
      heard: voiceHeard,
      level: Number(voiceLevel.value.toFixed(3)),
    });
    speechEndDetector.reset();
    // 计时停在这里：底部条要显示「最终录了几秒」，不要再涨
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = null;
    }
    // 原生通道：停录音 → 整段识别 → 回填文本（没有 finish/final 那套）
    if (voiceBackend === "native") {
      const seq = voiceSeq;
      // 降级或授权还在启动时也记住发送，不能在 recorder 尚未赋值时丢掉本轮。
      void Promise.resolve(nativeVoiceStartup).then(() => {
        if (seq === voiceSeq && voiceQueryActive.value) void finishNativeVoiceQuery();
      });
      return;
    }
    voiceCapture?.stop();
    voiceCapture = null;
    voiceSession?.finish();
  }

  /** 取消这一轮：直接断流，不发 finish、不落气泡 */
  function cancelVoiceQuery() {
    if (!voiceQueryActive.value) return;
    logger.info("[voice-query] 取消录音", {
      seconds: voiceSeconds.value,
      backend: voiceBackend,
      finishing: voiceFinishing.value,
    });
    resetVoiceQuery();
  }

  async function startVoiceQuery() {
    // 开口前先把正在播的语音掐掉：一是会盖住用户说话，二是外放声音会被麦克风收进 ASR
    const seq = ++voiceSeq;
    await options.onStart?.();
    if (seq !== voiceSeq) return;
    voiceFinishing.value = false;
    voiceLevel.value = 0;
    voiceSeconds.value = 0;
    voiceHeard = false;
    speechEndDetector.reset();
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
     * 音频从哪来（Android 与 iOS 同一口径，与首页一致）：
     * - 容器里有 `pcmStreamStart`（mPaaS bridge 已注入）：用宿主原生推流，
     *   16k 裸 PCM 由原生抛过来，后面的 WebSocket 流式 ASR 一点不变 —— 实时文字照常；
     * - 没有 bridge（浏览器 / 宿主未注入）才用 WebAudio 自己采；
     * - 两条都不行（没有 WebSocket / 没有 WebAudio 且没有原生推流）才退到整段识别。
     *
     * 之前这里只看 WebAudio：Android WebView 拿不到可用音频时会整轮降到「原生整段识别」，
     * 期间没有实时字幕，声纹也依赖 microphoneVolume（部分容器恒为 0 / 拿不到），
     * 表现就是「语音输入异常 + 没有声纹」。
     */
    const useNativePcm = isNativePcmStreamSupported();
    // 语音链路排查入口：这一轮走哪条采集通道、ASR 流式可不可用、带的是哪条 token
    logger.warn("[voice-query] 开始一轮录音", {
      seq,
      backend: useNativePcm ? "native-pcm-stream" : "web-audio",
      asrStream: isAsrStreamSupported(),
      pcmSupported: isPcmCaptureSupported(),
      token: describeRequestAuth(),
    });
    if (!isAsrStreamSupported() || (!useNativePcm && !isPcmCaptureSupported())) {
      await (nativeVoiceStartup = startNativeVoiceQuery(seq));
      return;
    }

    try {
      // 容器里要先向原生申请麦克风权限，否则浏览器那层会被静默拒绝
      const granted = await ensureNativePermission("record_audio");
      if (seq !== voiceSeq) return;
      if (!granted) {
        logger.warn("[voice-query] 录音权限被拒", { seq });
        failVoiceQuery(permissionDeniedMessage("record_audio"));
        return;
      }
      logger.info("[voice-query] 录音权限已授予，开始建 ASR 会话", { seq });

      const session = openAsrStreamSession({
        onPartial(text) {
          if (seq !== voiceSeq || !voicePlaceholderId.value) return;
          if (!voiceFinishing.value) {
            speechEndDetector.observeTranscript(text);
            if (text.trim()) voiceHeard = true;
          }
          // partial 是「完整文本的当前版本」：整体替换气泡内容，不要自己拼接
          options.patchPlaceholder(voicePlaceholderId.value, text);
        },
        onFinal(text) {
          if (seq !== voiceSeq) return;
          const query = String(text).trim();
          logger.info("[voice-query] 拿到定稿文本", {
            seconds: voiceSeconds.value,
            chars: query.length,
            text: query,
          });
          // 占位气泡的 id 要在 reset 清空之前留住：final 之后它要接着停在顶部
          const placeholderIdAfterFinal = voicePlaceholderId.value;
          if (query) options.onBeforeSubmit?.();
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

      const capture = useNativePcm
        ? await startNativePcmCapture({
          onFrame: frame => session.pushFrame(frame),
          onLevel: onVoiceLevel,
          // 原生推流中途报错：换整段识别那条线，别让这一轮白说
          onError: message => degradeToNativeVoice(`pcm-stream:${message}`),
        })
        : await startPcmCapture({
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
      logger.info("[voice-query] 采集通道已就绪，等待实时字幕", {
        seq,
        backend: useNativePcm ? "native-pcm-stream" : "web-audio",
      });

      /**
       * 8s 没人说话就自己收尾，别让麦克风空转。
       * 原生 PCM 推流这条不启用：宿主给的是哪一档音量不确定（可能偏小），
       * 一旦电平没过阈值就会被判成「没人说话」、在你还在说的时候把录音掐掉。
       * 这条通道的收尾交给「说过话后静音 1.5s」和用户点 ↑。
       */
      if (!useNativePcm) {
        voiceNoSpeechTimer = setTimeout(() => {
          voiceNoSpeechTimer = null;
          if (!voiceHeard && !options.isHolding?.()) stopVoiceQuery();
        }, VOICE_NO_SPEECH_MS);
      }
    }
    catch (error) {
      // getUserMedia 三档全挂（Android WebView 常见）：不掉到「录音启动失败」，先换原生录音
      logger.warn("voice query start failed, fallback to native recorder", error);
      if (seq === voiceSeq) degradeToNativeVoice("capture-failed");
    }
  }

  onBeforeUnmount(() => {
    speechEndDetector.reset();
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

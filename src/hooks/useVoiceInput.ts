import { computed, nextTick, onBeforeUnmount, reactive, ref, toRefs } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission, permissionDeniedMessage } from "@/utils/platform/mpaas";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const logger = createLogger("voice");

/** 短于这个时长按误触处理，不触发识别 */
const LONG_PRESS_MS = 300;
/** 上划超过这个距离即为取消 */
const CANCEL_SWIPE_PX = 60;
const ASR_TIMEOUT_MS = 30_000;
/** 识别态是入口的硬拦截条件，用看门狗兜底，避免任何异常路径把语音入口永久锁死 */
const RECOGNIZE_WATCHDOG_MS = 45_000;

type VoicePhase = "idle" | "recording" | "recognizing" | "finished" | "editing";
type InputMode = "voice" | "text";

interface RecorderResult {
  success?: boolean;
  cancelled?: boolean;
  error?: string;
  data?: {
    tempFilePath?: string;
    audioUrl?: string;
    audioBase64?: string;
    mimeType?: string;
  };
}

interface VoiceInputOptions {
  /** 生成回答期间禁止录音 */
  isLoading: () => boolean;
  /** 识别结果确认后的出口 */
  submit: (text: string) => void;
  /** 录音相关动作发生时收起快捷入口 */
  toggleQuickList: () => void;
  /** 发送前先收键盘 */
  dismissKeyboard: () => void;
  /** 透传给外部的语音事件（voice-start / voice-cancel / voice-send / voice-restart） */
  emitVoiceEvent?: (event: string, payload?: unknown) => void;
}

/**
 * 语音输入状态机：录音手势、权限、识别、确认面板。
 *
 * 三个入口共用同一套流程 —— 底部「按住说话」、确认面板的大圆环、面板上的「再次识别」，
 * 差别只在 restart 标记（保留上一轮文本、且录音期间不卸载确认面板）。
 *
 * 并发保护靠 jobSeq：每开一次录音自增，所有异步回调回来先比对序号，
 * 对不上就整个丢弃 —— 快速连按、中途取消都不会串台。
 */
export function useVoiceInput(options: VoiceInputOptions) {
  const { t } = useI18n();

  const state = reactive({
    inputMode: "voice" as InputMode,
    voicePhase: "idle" as VoicePhase,
    recognizedText: "",
    draftText: "",
    isRecognizing: false,
    /** 「再次识别」进行中：确认面板不卸载，靠这个标记切按钮样式 */
    restartRecording: false,
    /** 上划取消手势的实时状态，面板文案跟着它变 */
    cancelling: false,
    micPermissionReady: false,
    micPermissionRequesting: false,
    jobSeq: 0,
    pressStartedAt: 0,
    keepOldRecognizedText: false,
    gesture: { active: false, startY: 0, isRestart: false },
  });

  const { inputMode, voicePhase } = toRefs(state);
  const voiceTextareaRef = ref<{ focus?: () => void } | null>(null);

  let recorder: InstanceType<typeof VoiceRecorder> | null = null;
  let recognizeWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** 当前录音会话上下文：本次的 jobSeq 与 start promise */
  let currentJob: { seq: number; start: Promise<RecorderResult> } | null = null;

  const voiceTextValue = computed(() => {
    // 重录期间草稿被清空了，先显示上一轮的识别结果，别让文本框突然空掉
    if (state.restartRecording) return state.recognizedText;
    if (state.voicePhase === "finished") return state.draftText;
    return state.recognizedText;
  });

  const isVoiceConfirmationOpen = computed(() =>
    state.voicePhase === "finished" || state.voicePhase === "recognizing",
  );

  function ensureRecorder() {
    if (!recorder) recorder = new VoiceRecorder();
    return recorder;
  }

  /**
   * 识别态开关的唯一入口。开启时挂看门狗，保证即使某条异常路径漏了关闭，
   * 入口锁也会在有限时间内自动解除。
   */
  function setRecognizing(on: boolean) {
    if (recognizeWatchdog) {
      clearTimeout(recognizeWatchdog);
      recognizeWatchdog = null;
    }
    state.isRecognizing = on;
    if (!on) return;
    recognizeWatchdog = setTimeout(() => {
      logger.warn("recognizing watchdog fired, force reset");
      recognizeWatchdog = null;
      state.isRecognizing = false;
      if (state.voicePhase === "recognizing") {
        resetVoiceInput();
        uni.showToast({ title: t("speech-recognize-timeout"), icon: "none" });
      }
    }, RECOGNIZE_WATCHDOG_MS);
  }

  function resetVoiceText() {
    state.restartRecording = false;
    state.recognizedText = "";
    state.draftText = "";
    state.keepOldRecognizedText = false;
    setRecognizing(false);
  }

  /** 作废当前录音会话：迟到的异步结果一律按 jobSeq 丢弃 */
  function invalidateJob() {
    state.jobSeq += 1;
    currentJob = null;
    setRecognizing(false);
  }

  function resetVoiceInput() {
    resetVoiceText();
    invalidateJob();
    state.voicePhase = "idle";
    state.inputMode = "voice";
    options.toggleQuickList();
  }

  function cancelRecorder() {
    try {
      (recorder?.release ?? recorder?.cancel)?.call(recorder);
    } catch (error) {
      logger.warn("cancel recorder failed", error);
    }
  }

  function resetGestureState() {
    state.gesture.startY = 0;
    state.gesture.isRestart = false;
    state.cancelling = false;
  }

  /**
   * 麦克风权限只在本次会话里问一次：拿到授权后缓存，之后连续按住说话不再重复弹窗。
   * 被拒时不缓存，用户去系统设置里开了还能再试。
   */
  async function ensureMicPermission() {
    if (state.micPermissionReady) return true;
    if (state.micPermissionRequesting) return false;

    state.micPermissionRequesting = true;
    try {
      const granted = await ensureNativePermission("record_audio");
      state.micPermissionReady = granted;
      return granted;
    } finally {
      state.micPermissionRequesting = false;
    }
  }

  function onVoiceClose() {
    cancelRecorder();
    resetVoiceInput();
    resetGestureState();
    state.gesture.active = false;
  }

  // 生成回答期间也允许切换输入方式：左侧按钮常驻，用户可以先把下一条消息打好
  function switchToText() {
    state.inputMode = "text";
    state.voicePhase = "idle";
  }

  function switchToDefaultVoice() {
    state.inputMode = "voice";
    state.voicePhase = "idle";
    options.toggleQuickList();
  }

  /** 左侧「语音 / 键盘」切换。录音或识别途中不切，避免把进行中的会话丢掉 */
  function onToggleInputMode() {
    if (state.gesture.active || state.isRecognizing) return;
    if (state.inputMode === "voice") switchToText();
    else switchToDefaultVoice();
  }

  function focusVoiceTextarea() {
    nextTick(() => {
      voiceTextareaRef.value?.focus?.();
    });
  }

  function onVoiceTextareaInput(e: { detail: { value: string } }) {
    if (state.voicePhase !== "finished") return;
    state.draftText = e.detail.value;
  }

  function readGestureClientY(e: any) {
    return Number(e?.touches?.[0]?.clientY ?? e?.changedTouches?.[0]?.clientY ?? e?.clientY ?? 0);
  }

  function preventDefaultSafely(e: any) {
    try {
      if (e && e.cancelable) e.preventDefault();
    } catch {
      // 部分环境的合成事件不支持 preventDefault，忽略
    }
  }

  function beginGesture(e: unknown, isRestart = false) {
    state.gesture.startY = readGestureClientY(e);
    state.gesture.isRestart = isRestart;
    state.cancelling = false;
  }

  function updateVoiceGesture(e: unknown) {
    if (!state.gesture.active) return;
    const currentY = readGestureClientY(e);
    if (!currentY || !state.gesture.startY) return;
    state.cancelling = state.gesture.startY - currentY >= CANCEL_SWIPE_PX;
    preventDefaultSafely(e);
  }

  /**
   * 取消一次录音（上划取消 / 短按 / 面板关闭）。
   * 不等待录音器：cancel 会同步作废会话，原生释放动作在后台队列里完成，
   * 因此这里不存在任何可能把 UI 锁住的 await。
   */
  function cancelVoiceRecording({ keepText = false } = {}) {
    removeRestartWindowListeners();
    const existingText = state.recognizedText || state.draftText;
    state.restartRecording = false;
    invalidateJob();

    if (keepText && existingText) {
      state.recognizedText = existingText;
      state.draftText = existingText;
      state.voicePhase = "finished";
      state.inputMode = "voice";
    } else {
      resetVoiceInput();
    }
    resetGestureState();
    state.gesture.active = false;
    cancelRecorder();
    options.emitVoiceEvent?.("voice-cancel");
  }

  async function startRecorder(jobSeq: number): Promise<RecorderResult> {
    const instance = ensureRecorder();
    if (!state.keepOldRecognizedText) state.recognizedText = "";
    // 录音期间编辑草稿无意义，清空 draft
    state.draftText = "";
    const keepText = state.keepOldRecognizedText;
    state.keepOldRecognizedText = false;

    // 容器里要先向原生申请麦克风权限，拿到授权浏览器那层才不会被静默拒绝
    const result: RecorderResult = await ensureMicPermission()
      ? await instance.start({ sampleRate: 16000, timeSlice: 1000 })
      : { success: false, error: permissionDeniedMessage("record_audio") };

    if (jobSeq !== state.jobSeq) return { success: false, error: "任务已失效" };
    if (result?.success) return result;

    if (!result?.cancelled) {
      uni.showToast({
        title: result?.error || t("record-start-failed"),
        icon: "none",
        duration: 4000,
      });
    }
    // 启动失败时必须把手势与识别态一起回收，否则下一次按压会被残留状态拦住
    cancelVoiceRecording({ keepText });
    return result || { success: false, error: t("record-start-failed") };
  }

  /**
   * 统一开始一次录音会话（底部按住说话 / 确认页大圆环 / 再次识别小按钮 三入口复用）。
   * restart=true 表示从识别成功面板再次识别，保留旧文本。
   */
  function beginVoiceRecording({ restart = false } = {}) {
    // 幂等：已有进行中的录音则忽略
    if (state.gesture.active) return;

    const existingText = state.draftText || state.recognizedText;
    state.recognizedText = existingText;
    state.draftText = existingText;
    state.keepOldRecognizedText = Boolean(existingText);
    state.inputMode = "voice";
    // 重录同样进入全屏监听态（设计稿统一为「正在听」），由窗口级松手兜底结束录音。
    state.restartRecording = restart;
    state.voicePhase = "recording";
    state.gesture.active = true;
    state.gesture.isRestart = restart;
    state.pressStartedAt = Date.now();
    options.toggleQuickList();
    options.emitVoiceEvent?.(restart ? "voice-restart" : "voice-start");

    const jobSeq = ++state.jobSeq;
    currentJob = { seq: jobSeq, start: startRecorder(jobSeq) };
  }

  /** 按拿到的音频形态选识别接口 */
  function requestRecognition(audio: {
    filePath?: string;
    audioUrl?: string;
    audioBase64?: string;
    mimeType?: string;
  }) {
    if (audio.audioUrl) return recognizeSpeechByUrl({ audioUrl: audio.audioUrl });
    if (audio.audioBase64) {
      return recognizeSpeechByBase64({ audioBase64: audio.audioBase64, mimeType: audio.mimeType });
    }
    return recognizeSpeechByUpload({ filePath: audio.filePath || "", timeout: ASR_TIMEOUT_MS });
  }

  /**
   * 兜底超时：上传接口的 timeout 在部分环境不生效，
   * 这里再包一层，保证识别态不会一直挂着。
   */
  function withTimeout<T>(promise: Promise<T>) {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(t("speech-recognize-timeout"))), ASR_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function toastVoiceError(error: unknown, fallback: string) {
    const raw = error instanceof Error
      ? error.message
      : (error && typeof error === "object"
        && ((error as any).message || (error as any).errMsg || (error as any).errorMessage))
      || String(error || fallback);
    const title = String(raw || fallback).replace(/^Error:\s*/, "").slice(0, 28) || fallback;
    uni.showToast({ title, icon: "none" });
  }

  /**
   * 送去识别。三条来源，按拿到什么就走什么：
   * - audioUrl：原生录音（mPaaS）已经把文件上传好了，只给回地址 → 按地址识别；
   * - audioBase64：宿主直接回传音频内容 → 按 base64 识别；
   * - filePath：浏览器录到的本地文件 → 直传 multipart，
   *   这条不转 base64，整段音频转出来要多占约 1/3 体积，还得先整个读进内存。
   */
  async function recognizeFromRecording(audio: RecorderResult["data"], jobId: number) {
    if (jobId !== state.jobSeq) return;
    const { tempFilePath: filePath, audioUrl, audioBase64, mimeType } = audio || {};
    if (!filePath && !audioUrl && !audioBase64) {
      resetVoiceInput();
      uni.showToast({ title: t("no-audio-recorded"), icon: "none" });
      return;
    }

    const prevText = String(state.recognizedText || "");
    setRecognizing(true);
    try {
      if (jobId !== state.jobSeq) return;
      logger.info("ASR start", {
        via: audioUrl ? "url" : audioBase64 ? "base64" : "upload",
        filePath,
        audioUrl,
        base64Length: audioBase64?.length || 0,
        mimeType,
      });
      const result = await withTimeout(requestRecognition({ filePath, audioUrl, audioBase64, mimeType }));
      logger.info("ASR done", { textLength: String(result?.text || "").length });
      if (jobId !== state.jobSeq) return;

      const text = String(result?.text || "").trim();
      if (!text) {
        state.recognizedText = prevText;
        state.draftText = prevText;
        if (prevText) {
          state.voicePhase = "finished";
        } else {
          resetVoiceInput();
          uni.showToast({ title: t("no-speech-recognized"), icon: "none" });
        }
        return;
      }

      // 识别完成：在已有旧文字基础上拼接新识别结果
      state.recognizedText = prevText ? `${prevText}${text}` : text;
      state.draftText = state.recognizedText;
      state.voicePhase = "finished";
      state.inputMode = "voice";
    } catch (error) {
      // 这条要自带上下文：线上默认只打 warn/error，前面那些 debug 是看不到的
      logger.error("ASR failed", {
        via: audioUrl ? "url" : audioBase64 ? "base64" : "upload",
        base64Length: audioBase64?.length || 0,
        mimeType,
        message: (error as Error)?.message,
        error,
      });
      // 识别失败也要把录音器归位，否则原生可能还留着上一轮的会话，下次 end 一直不回调
      cancelRecorder();
      if (jobId !== state.jobSeq) return;
      state.recognizedText = prevText;
      state.draftText = prevText;
      if (prevText) {
        state.voicePhase = "finished";
      } else {
        resetVoiceInput();
        toastVoiceError(error, t("record-failed"));
      }
    } finally {
      setRecognizing(false);
    }
  }

  async function stopRecorderAndRecognize(jobSeq: number) {
    const instance = ensureRecorder();
    let result: RecorderResult;
    try {
      result = await instance.stop();
    } catch (error) {
      logger.error("stop recorder failed", error);
      result = { success: false, error: (error as Error)?.message || t("record-failed") };
    }
    if (jobSeq !== state.jobSeq) return;

    if (!result?.success) {
      invalidateJob();
      cancelRecorder();
      resetVoiceInput();
      if (!result?.cancelled) {
        uni.showToast({ title: result?.error || t("record-failed"), icon: "none" });
      }
      return;
    }

    logger.debug("ready to recognize", {
      filePath: result.data?.tempFilePath,
      audioUrl: result.data?.audioUrl,
      base64Length: result.data?.audioBase64?.length || 0,
    });
    await recognizeFromRecording(result.data, jobSeq);
  }

  async function finishGesture({ keepTextOnCancel = false } = {}) {
    const pressDuration = Date.now() - state.pressStartedAt;
    const job = currentJob;
    // 短按或录音未真正启动：按取消处理，不触发识别
    if (pressDuration < LONG_PRESS_MS || !job?.start) {
      cancelVoiceRecording({ keepText: keepTextOnCancel });
      return;
    }

    const jobSeq = job.seq;
    state.voicePhase = "recognizing";
    state.inputMode = "voice";
    setRecognizing(true);

    const startResult = await job.start;
    if (jobSeq !== state.jobSeq) return;
    currentJob = null;
    if (!startResult || startResult.success === false) {
      // startRecorder 内部失败已自行回收；这里兜底未进入录音器的失败（如权限被拒）
      if (state.voicePhase === "recognizing") cancelVoiceRecording({ keepText: keepTextOnCancel });
      return;
    }
    if (state.voicePhase !== "recognizing") return;
    await stopRecorderAndRecognize(jobSeq);
  }

  /** 统一结束一次录音会话（正常松手 / 上划取消 / 短按） */
  /** 重录按钮在 touchstart 后随面板卸载，元素 touchend 会丢；用窗口级兜底收尾一次 */
  function removeRestartWindowListeners() {
    if (typeof window === "undefined") return;
    window.removeEventListener("touchend", onRestartWindowEnd);
    window.removeEventListener("touchcancel", onRestartWindowCancel);
  }

  async function onRestartWindowEnd() {
    removeRestartWindowListeners();
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: state.cancelling });
  }

  async function onRestartWindowCancel() {
    removeRestartWindowListeners();
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: true });
  }

  async function endVoiceRecording({ cancel = false } = {}) {
    removeRestartWindowListeners();
    if (!state.gesture.active) return;
    const isRestart = state.gesture.isRestart;
    if (cancel) {
      // 再次识别入口取消时保留已有文本，回到确认面板
      cancelVoiceRecording({ keepText: isRestart });
      return;
    }
    resetGestureState();
    state.gesture.active = false;
    state.restartRecording = false;
    await finishGesture({ keepTextOnCancel: isRestart });
  }

  function canStartRecording() {
    return !options.isLoading()
      && !state.isRecognizing
      && !state.gesture.active
      && !state.micPermissionRequesting;
  }

  function onVoicePillTouchStart(e: unknown) {
    if (!canStartRecording()) return;
    preventDefaultSafely(e);
    beginGesture(e, false);
    beginVoiceRecording({ restart: false });
  }

  async function onVoicePillTouchEnd(e: unknown) {
    preventDefaultSafely(e);
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: state.cancelling });
  }

  async function onVoicePillTouchCancel() {
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: true });
  }

  function onVoiceTouchStart(e: unknown) {
    if (!canStartRecording() || state.voicePhase === "editing") return;
    beginGesture(e, false);
    preventDefaultSafely(e);
    beginVoiceRecording({ restart: false });
  }

  async function onVoiceTouchEnd() {
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: state.cancelling });
  }

  async function onVoiceTouchCancel() {
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: true });
  }

  function onVoiceRestartStart(e: unknown) {
    if (!canStartRecording()) return;
    preventDefaultSafely(e);
    beginGesture(e, true);
    beginVoiceRecording({ restart: true });
    if (typeof window !== "undefined") {
      window.addEventListener("touchend", onRestartWindowEnd, { passive: false });
      window.addEventListener("touchcancel", onRestartWindowCancel, { passive: false });
    }
  }

  async function onVoiceRestartEnd(e: unknown) {
    preventDefaultSafely(e);
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: state.cancelling });
  }

  async function onVoiceRestartCancel() {
    if (!state.gesture.active) return;
    await endVoiceRecording({ cancel: true });
  }

  /** 确认面板点发送：识别文本直接进发送出口，并停在语音态 */
  function onVoiceSend() {
    const payload = state.voicePhase === "finished" ? state.draftText : state.recognizedText;
    const finalPayload = String(payload || "").trim();
    if (!finalPayload) return;

    state.voicePhase = "idle";
    // 语音发完仍停在语音态：用户下一句大概率还是说，不该被切回键盘
    state.inputMode = "voice";
    options.dismissKeyboard();
    options.emitVoiceEvent?.("voice-send", finalPayload);
    options.submit(finalPayload);
    resetVoiceText();
  }

  onBeforeUnmount(() => {
    removeRestartWindowListeners();
    invalidateJob();
    resetGestureState();
    state.gesture.active = false;
    state.micPermissionRequesting = false;
    cancelRecorder();
    if (recognizeWatchdog) clearTimeout(recognizeWatchdog);
  });

  return {
    // 状态
    inputMode,
    voicePhase,
    voiceTextValue,
    isVoiceConfirmationOpen,
    voiceTextareaRef,
    state,
    // 模式切换
    onToggleInputMode,
    switchToText,
    switchToDefaultVoice,
    // 面板
    onVoiceClose,
    onVoiceSend,
    onVoiceTextareaInput,
    focusVoiceTextarea,
    // 手势
    updateVoiceGesture,
    onVoicePillTouchStart,
    onVoicePillTouchEnd,
    onVoicePillTouchCancel,
    onVoiceTouchStart,
    onVoiceTouchEnd,
    onVoiceTouchCancel,
    onVoiceRestartStart,
    onVoiceRestartEnd,
    onVoiceRestartCancel,
  };
}

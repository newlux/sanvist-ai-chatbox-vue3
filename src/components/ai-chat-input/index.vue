<script setup>
import { recognizeSpeechByBase64, recognizeSpeechByUrl } from "@/api/chat";
import { useKeyboardViewport } from "@/hooks/useKeyboardViewport";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSystemStore } from "@/stores/modules/system";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
});

const emit = defineEmits([
  "send",
  "stop",
  "update:modelValue",
  "voice-start",
  "voice-cancel",
  "voice-send",
  "voice-restart",
  "toggle-quick-list",
  "keyboard-height-change",
  "input-focus",
]);

const VOICE_LONG_PRESS_MS = 300;
const VOICE_CANCEL_SWIPE_PX = 60;
const VOICE_STOP_TIMEOUT_MS = 5000;
const VOICE_ASR_TIMEOUT_MS = 30000;
const MIC_GRANTED_STORAGE_KEY = "wvpn_sany_ai_mic_ok";

function writeMicGrantedPersisted() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MIC_GRANTED_STORAGE_KEY, "1");
    }
  } catch {
    /* 无痕模式等 */
  }
}

function clearMicGrantedPersisted() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(MIC_GRANTED_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

function canUseMediaDevicesMic() {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

const systemStore = useSystemStore();
const state = reactive({
  inputMode: "voice", // text | voice（组件内部维护）
  voicePhase: "idle", // idle | recording | recognizing | finished | editing
  // text 键盘态下输入栏抽离为 absolute，用该高度在原位置留占位，避免内容区跳动
  textInputBarHeightPx: 0,
  _pressTimer: null,
  _typingTimer: null,
  _typingIndex: 0,
  recorder: null,
  _jobSeq: 0, // 递增任务序号：每开始一次录音自增，作废迟到的异步回调
  _voicePressStartedAt: 0,
  recognizedTextFull: "",
  recognizedText: "",
  draftText: "",
  _isRecognizing: false,
  _keepOldRecognizedText: false,
  _micPermissionReady: false,
  _micPermissionRequesting: false,
  _voiceCancelling: false,
  // 上划取消手势：模板依赖 _voiceGestureCancelling，保留；其余手势状态收敛进 _gesture
  _voiceGestureCancelling: false,
  _gesture: { active: false, startY: 0, isRestart: false },
});
const { inputMode, voicePhase } = toRefs(state);
// 当前录音会话上下文：存放本次录音的 jobSeq 与 start promise，
// 避免模块级单变量被多入口并发覆盖。
let currentJob = null;
const {
  keyboardHeightPx,
  initialWindowHeightPx,
  viewportBottomOffsetPx,
  voiceInputFocused,
  textInputFocused,
  onVoiceFocus,
  onVoiceBlur,
  onTextFocus,
  onTextBlur,
  resetKeyboardState,
} = useKeyboardViewport();

const voiceTextareaRef = ref(null);

const isIOS = computed(() => Boolean(systemStore.isIOS));
const { safeAreaStyle } = useSafeArea();

const rootStyle = computed(() => {
  // 语音浮窗高度基准：用组件加载时记录的窗口高度（稳定、不随键盘弹出/收起变化），
  // 减去顶部留白 412rpx（换算成 px：rpx 基准宽 750，1rpx = screenWidth/750 px；
  // 在 375 设计稿上 1px = 2rpx，等价 412rpx = 206px），
  // 避免 100dvh 在键盘收起回弹期间抖动导致浮窗塌陷。
  const screenW = Number(systemStore.screenWidth) || 375;
  const topReservePx = Math.round((412 * screenW) / 750);
  const voiceSheetHeightPx = Math.max(0, Number(initialWindowHeightPx.value || 0) - topReservePx);
  return {
    "--kbd-height": `${keyboardHeightPx.value || 0}px`,
    "--kbd-extra": `${isIOS.value ? 8 : 0}px`,
    "--window-height": `${initialWindowHeightPx.value || 0}px`,
    "--voice-sheet-h": `${voiceSheetHeightPx}px`,
    "--vv-bottom-offset": `${viewportBottomOffsetPx.value || 0}px`,
    ...safeAreaStyle.value,
  };
});
const voiceTextValue = computed(() => {
  if (state.voicePhase === "finished") {
    return state.draftText;
  }
  return state.recognizedText;
});
const isVoiceConfirmationOpen = computed(() =>
  state.voicePhase === "finished" || state.voicePhase === "recognizing",
);
const voiceKeyboardOpen = computed(() =>
  Boolean(state.inputMode === "voice" && (voiceInputFocused.value || keyboardHeightPx.value > 0)),
);
const textKeyboardOpen = computed(() =>
  Boolean(
    state.inputMode === "text"
    && (textInputFocused.value || keyboardHeightPx.value > 0),
  ),
);
const keyboardInteractionMasked = computed(() =>
  Boolean(keyboardHeightPx.value > 0 && (textInputFocused.value || voiceInputFocused.value)),
);

const textTextareaHeight = computed(() => {
  const maxCharsPerLine = 15;
  const lineCount = String(props.modelValue || "")
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
  return `${Math.min(Math.max(lineCount, 1), 4) * 40}rpx`;
});

function onVoiceTextareaFocus() {
  onVoiceFocus();
  emit("input-focus");
}

function onTextTextareaFocus() {
  // 聚焦时记录输入栏实际高度，键盘态抽离 absolute 后在原位置留等高占位
  try {
    const el = document.querySelector(".chat-input");
    if (el) state.textInputBarHeightPx = Math.round(el.getBoundingClientRect().height) || 0;
  } catch {
    // 忽略
  }
  onTextFocus();
  emit("input-focus");
}

function onVoiceTextareaBlur() {
  onVoiceBlur();
}

function onTextTextareaBlur() {
  onTextBlur();
}

function focusVoiceTextarea() {
  // 真机上必须在用户手势回调里调用 focus 才能生效
  nextTick(() => {
    try {
      const el = voiceTextareaRef.value;
      if (el && typeof el.focus === "function") {
        el.focus();
      }
      else if (typeof document !== "undefined") {
        const dom = document.querySelector(".voice-recording__textarea");
        dom?.focus();
      }
    }
    catch (e) {
      console.warn("[AiChatInput] focusVoiceTextarea failed", e);
    }
  });
}

function onTrySend() {
  const text = String(props.modelValue || "").trim();
  if (!text) return;
  emit("send");
}

function _ensureRecorder() {
  if (!state.recorder) {
    state.recorder = new VoiceRecorder();
  }
  return state.recorder;
}
function getVoiceDebugContext() {
  return {
    href: typeof location !== "undefined" ? location.href : "",
    isSecureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    hasMediaDevices: typeof navigator !== "undefined" && Boolean(navigator.mediaDevices),
    hasGetUserMedia: canUseMediaDevicesMic(),
    hasAlipayBridge: typeof window !== "undefined" && Boolean(window.AlipayJSBridge?.call),
    permissionReady: state._micPermissionReady,
    permissionRequesting: state._micPermissionRequesting,
    voicePhase: state.voicePhase,
  };
}
async function _requestMicrophonePermission() {
  console.info("[voice-debug] permission check", getVoiceDebugContext());
  if (state._micPermissionReady) return true;

  const hasAlipayBridge = typeof window !== "undefined" && window.AlipayJSBridge?.call;
  if (hasAlipayBridge) {
    console.info("[voice] native permission request", { permissions: "record_audio" });
    const granted = await new Promise((resolve) => {
      window.AlipayJSBridge.call("requestPermission", { permissions: "record_audio" }, (result) => {
        console.info("[voice] native permission result", result);
        resolve(String(result?.result) === "1" || result?.status === "granted");
      });
    });
    if (!granted) {
      uni.showToast({ title: "请允许使用麦克风", icon: "none", duration: 3000 });
      return false;
    }
    state._micPermissionReady = true;
    return true;
  }

  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      const status = await navigator.permissions.query({
        name: "microphone",
      });
      if (status.state === "granted") {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
    }
  } catch {
    /* 部分 WebView 不支持 Permissions API */
  }

  if (canUseMediaDevicesMic()) {
    try {
      const recorder = _ensureRecorder();
      const res = await recorder.requestPermission?.();
      console.log("requestPermission res", res);
      if (res && res.success) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
      if (res) {
        clearMicGrantedPersisted();
        uni.showToast({
          title: res.notAllowed ? "请在弹窗中允许使用麦克风" : "当前浏览器不支持语音输入",
          icon: "none",
          duration: 3000,
        });
      }
    } catch (e) {
      clearMicGrantedPersisted();
      const message =
        e?.name === "NotAllowedError" || e?.name === "SecurityError"
          ? "请在弹窗中允许使用麦克风"
          : "当前浏览器不支持语音输入";
      uni.showToast({ title: message, icon: "none", duration: 3000 });
    }
    return false;
  }

  try {
    if (typeof uni !== "undefined" && uni && typeof uni.authorize === "function") {
      const getSettingOnce = () =>
        new Promise((resolve) => {
          if (typeof uni.getSetting !== "function") {
            resolve(null);
            return;
          }
          uni.getSetting({
            success: resolve,
            fail: () => resolve(null),
          });
        });

      const settingRes = await getSettingOnce();
      const authed = Boolean(settingRes?.authSetting?.["scope.record"]);
      if (authed) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }

      const ok = await new Promise((resolve) => {
        uni.authorize({
          scope: "scope.record",
          success: () => resolve(true),
          fail: () => resolve(false),
        });
      });
      if (ok) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }

      await new Promise(r => setTimeout(r, 80));
      const afterAuthSetting = await getSettingOnce();
      if (afterAuthSetting?.authSetting?.["scope.record"]) {
        state._micPermissionReady = true;
        writeMicGrantedPersisted();
        return true;
      }
    }
  } catch (e) {
    console.warn("[voice-debug] uni permission fallback failed", e);
  }

  const isInsecureBrowser =
    typeof window !== "undefined"
    && !window.isSecureContext
    && typeof location !== "undefined"
    && location.hostname !== "localhost";
  const title = isInsecureBrowser
    ? "浏览器录音需要 HTTPS 或 localhost"
    : "当前环境无法使用麦克风";
  console.error("[voice-debug] no microphone permission channel", getVoiceDebugContext());
  uni.showToast({ title, icon: "none", duration: 4000 });
  return false;
}
function _resetVoiceText() {
  state.recognizedTextFull = "";
  state.recognizedText = "";
  state.draftText = "";
  state._keepOldRecognizedText = false;
  state._isRecognizing = false;
  state._typingIndex = 0;
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}
function _invalidateJob() {
  state._jobSeq += 1;
  currentJob = null;
}
function resetVoiceInput() {
  _resetVoiceText();
  _invalidateJob();
  state.voicePhase = "idle";
  state.inputMode = "voice";
  emit("toggle-quick-list", true);
}
function onVoiceClose() {
  _stopVoiceRecorder(true);
  resetVoiceInput();
  // 关闭面板时同步清理手势与权限状态，保证再次进入录音可用
  state._voiceGestureCancelling = false;
  state._voiceCancelling = false;
  state._micPermissionRequesting = false;
  state._isRecognizing = false;
  state._gesture.active = false;
  state._gesture.startY = 0;
  state._gesture.isRestart = false;
}
async function ensureVoicePermission() {
  if (state._micPermissionReady) return true;
  if (state._micPermissionRequesting) return false;

  state._micPermissionRequesting = true;
  console.info("[voice-debug] permission request start", getVoiceDebugContext());
  try {
    const result = await _requestMicrophonePermission();
    console.info("[voice-debug] permission request end", { result, ...getVoiceDebugContext() });
    return result;
  } finally {
    state._micPermissionRequesting = false;
  }
}
function switchToText() {
  if (props.isLoading) return;
  state.inputMode = "text";
  state.voicePhase = "idle";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}

function switchToDefaultVoice() {
  if (props.isLoading) return;
  state.inputMode = "voice";
  state.voicePhase = "idle";
  emit("toggle-quick-list", true);
}

function onToggleQuickList() {
  if (props.isLoading) return;
  emit("toggle-quick-list", true);
}
function onVoiceTextareaInput(e) {
  if (state.voicePhase !== "finished") return;
  state.draftText = e.detail.value;
}
function getVoiceGestureClientY(e) {
  return Number(e?.touches?.[0]?.clientY ?? e?.changedTouches?.[0]?.clientY ?? e?.clientY ?? 0);
}
function beginVoiceGesture(e, isRestart = false) {
  state._gesture.startY = getVoiceGestureClientY(e);
  state._gesture.isRestart = isRestart;
  state._voiceGestureCancelling = false;
}
function updateVoiceGesture(e) {
  if (!state._gesture.active) return;
  const currentY = getVoiceGestureClientY(e);
  if (!currentY || !state._gesture.startY) return;
  state._voiceGestureCancelling = state._gesture.startY - currentY >= VOICE_CANCEL_SWIPE_PX;
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }
}
function resetVoiceGestureState() {
  state._gesture.startY = 0;
  state._gesture.isRestart = false;
  state._voiceGestureCancelling = false;
}
async function cancelVoiceSwipeGesture() {
  const isRestart = state._gesture.isRestart;
  const existingText = state.recognizedText;
  const job = currentJob;
  _invalidateJob();
  state._isRecognizing = false;

  if (isRestart && existingText) {
    state.recognizedText = existingText;
    state.draftText = existingText;
    state.voicePhase = "finished";
    state.inputMode = "voice";
  } else {
    resetVoiceInput();
  }
  resetVoiceGestureState();
  state._gesture.active = false;
  emit("voice-cancel");

  try {
    await job?.start;
  } catch {
    // ignore
  }
  await _stopVoiceRecorder(true);
}

/**
 * 统一开始一次录音会话（底部按住说话 / 确认页大圆环 / 再次识别小按钮 三入口复用）。
 * - restart=true 表示从识别成功面板再次识别，保留旧文本；否则为全新录音。
 */
function beginVoiceRecording({ restart = false } = {}) {
  // 幂等：已有进行中的录音则忽略
  if (state._gesture.active) return;

  const existingText = state.draftText || state.recognizedText;
  state.recognizedText = existingText;
  state.draftText = existingText;
  state._keepOldRecognizedText = Boolean(existingText);
  state.inputMode = "voice";
  state.voicePhase = "recording";
  state._gesture.active = true;
  state._gesture.isRestart = restart;
  state._voicePressStartedAt = Date.now();
  emit("toggle-quick-list", true);
  emit(restart ? "voice-restart" : "voice-start");

  const jobSeq = state._jobSeq;
  // start 立即为一个可 await 的 promise：
  // 先申请权限，成功后真正启动录音。这样松手时无论权限是否返回，finishVoiceGesture
  // 都能 await 到 job.start，不会因权限异步而把正常长按误判为短按取消。
  currentJob = {
    seq: jobSeq,
    start: (async () => {
      const ok = await ensureVoicePermission();
      if (state._jobSeq !== jobSeq) return { success: false, error: "任务已失效" };
      if (!ok) return { success: false, error: "请允许使用麦克风" };
      return _startVoiceRecorder(jobSeq);
    })(),
    end: null,
  };
}

/**
 * 统一结束一次录音会话（正常松手 / 上划取消 / 短按）。
 * cancel=true 表示取消（上划或短按），不触发识别。
 */
async function endVoiceRecording({ cancel = false } = {}) {
  if (!state._gesture.active) return;
  if (cancel) {
    await cancelVoiceSwipeGesture();
    return;
  }
  const isRestart = state._gesture.isRestart;
  resetVoiceGestureState();
  state._gesture.active = false;
  if (isRestart) {
    await finishVoiceRestartGesture();
  } else {
    await finishVoiceGesture();
  }
}
async function finishVoiceGesture() {
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  state._typingIndex = 0;

  const pressDuration = Date.now() - state._voicePressStartedAt;
  const job = currentJob;
  console.info("[voice-debug] gesture end", {
    pressDuration,
    hasJob: Boolean(job),
    ...getVoiceDebugContext(),
  });
  // 短按（<300ms）或录音未真正启动：按取消处理，不触发识别
  if (pressDuration < VOICE_LONG_PRESS_MS || !job?.start) {
    currentJob = null;
    await _cancelShortVoiceRecording();
    return;
  }

  state.voicePhase = "recognizing";
  state.inputMode = "voice";
  state._isRecognizing = true;

  await job.start;
  currentJob = null;
  if (state.voicePhase !== "recognizing") return;
  await _stopVoiceRecorderAndRecognize();
}
async function onVoicePillTouchStart(e) {
  const blockedReason = props.isLoading
    ? "loading"
    : state._isRecognizing
      ? "recognizing"
      : state._gesture.active
        ? "gesture-active"
        : state._voiceCancelling
          ? "cancelling"
          : state._micPermissionRequesting
            ? "permission-requesting"
            : "";
  console.info("[voice-debug] gesture start", {
    eventType: e?.type,
    blockedReason,
    ...getVoiceDebugContext(),
  });
  if (blockedReason) return;

  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }

  beginVoiceGesture(e, false);
  beginVoiceRecording({ restart: false });
}
async function onVoicePillTouchEnd(e) {
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }
  if (!state._gesture.active) return;
  const shouldCancel = state._voiceGestureCancelling;
  await endVoiceRecording({ cancel: shouldCancel });
}
function removeVoiceMouseUpListener() {
  if (typeof window === "undefined") return;
  window.removeEventListener("mousemove", updateVoiceGesture);
  window.removeEventListener("mouseup", onVoicePillMouseUp);
}
function onVoicePillMouseDown(e) {
  console.info("[voice-debug] mouse down", { button: e?.button, eventType: e?.type });
  if (typeof e?.button === "number" && e.button !== 0) return;
  removeVoiceMouseUpListener();
  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", updateVoiceGesture);
    window.addEventListener("mouseup", onVoicePillMouseUp, { once: true });
  }
  onVoicePillTouchStart(e);
}
function onVoicePillMouseUp(e) {
  removeVoiceMouseUpListener();
  onVoicePillTouchEnd(e);
}
async function onVoicePillTouchCancel() {
  if (!state._gesture.active) return;
  await endVoiceRecording({ cancel: true });
}
function onVoiceTouchStart(e) {
  console.info("[voice] press start", { phase: state.voicePhase, isLoading: props.isLoading });
  if (props.isLoading || state.voicePhase === "editing" || state._voiceCancelling || state._gesture.active) {
    return;
  }
  beginVoiceGesture(e, false);
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }
  beginVoiceRecording({ restart: false });
}
async function onVoiceTouchEnd() {
  console.info("[voice] press end", { phase: state.voicePhase });
  if (!state._gesture.active) return;
  const shouldCancel = state._voiceGestureCancelling;
  await endVoiceRecording({ cancel: shouldCancel });
}
async function onVoiceTouchCancel() {
  if (!state._gesture.active) return;
  await endVoiceRecording({ cancel: true });
}
function onVoiceSend() {
  // 立即重置键盘状态，避免后续再进入语音模式时高度异常
  resetKeyboardState();
  const payload = state.voicePhase === "finished" ? state.draftText : state.recognizedText;
  const finalPayload = String(payload || "").trim();
  if (!finalPayload) return;
  state.voicePhase = "idle";
  state.inputMode = "text";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;

  // 对齐父组件：更新 v-model，待父组件同步后只触发一次 send
  emit("update:modelValue", finalPayload);
  nextTick(onTrySend);
  emit("voice-send", finalPayload);
  _resetVoiceText();
}
async function finishVoiceRestartGesture() {
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  state._typingIndex = 0;

  const job = currentJob;
  // restart 短按同样视为取消：保留旧文本（cancelVoiceSwipeGesture 逻辑），不触发识别
  if (!job?.start) {
    currentJob = null;
    await _cancelShortVoiceRecording({ keepText: true });
    return;
  }

  state.voicePhase = "recognizing";
  state.inputMode = "voice";
  state._isRecognizing = true;

  await job.start;
  currentJob = null;
  if (state.voicePhase !== "recognizing") return;
  await _stopVoiceRecorderAndRecognize();
}
async function onVoiceRestartStart(e) {
  if (
    props.isLoading ||
    state._isRecognizing ||
    state._gesture.active ||
    state._voiceCancelling ||
    state._micPermissionRequesting
  ) {
    return;
  }
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }

  beginVoiceGesture(e, true);
  beginVoiceRecording({ restart: true });
}
async function onVoiceRestartEnd(e) {
  try {
    if (e && e.cancelable) e.preventDefault();
  } catch {
    // ignore
  }
  if (!state._gesture.active) return;
  const shouldCancel = state._voiceGestureCancelling;
  await endVoiceRecording({ cancel: shouldCancel });
}
function removeVoiceRestartMouseUpListener() {
  if (typeof window === "undefined") return;
  window.removeEventListener("mousemove", updateVoiceGesture);
  window.removeEventListener("mouseup", onVoiceRestartMouseUp);
}
function onVoiceRestartMouseDown(e) {
  if (typeof e?.button === "number" && e.button !== 0) return;
  removeVoiceRestartMouseUpListener();
  if (typeof window !== "undefined") {
    window.addEventListener("mousemove", updateVoiceGesture);
    window.addEventListener("mouseup", onVoiceRestartMouseUp, { once: true });
  }
  onVoiceRestartStart(e);
}
function onVoiceRestartMouseUp(e) {
  removeVoiceRestartMouseUpListener();
  onVoiceRestartEnd(e);
}
async function onVoiceRestartCancel() {
  if (!state._gesture.active) return;
  await endVoiceRecording({ cancel: true });
}

async function _startVoiceRecorder(jobSeq) {
  const recorder = _ensureRecorder();
  // 录音中不再展示“模拟识别文本”，避免出现前置占位文案
  state._typingIndex = 0;
  if (!state._keepOldRecognizedText) {
    state.recognizedText = "";
  }
  // 录音期间编辑草稿无意义，清空 draft
  state.draftText = "";
  state._typingTimer = null;
  state._keepOldRecognizedText = false;

  // 开始录音并在 stop 后触发识别
  const jobId = jobSeq;
  const result = await recorder.start(
    { sampleRate: 16000, timeSlice: 1000 },
    null,
    async (blob) => {
      // 忽略旧任务的回调
      if (jobId !== state._jobSeq) return;
      await _recognizeFromBlob(blob, jobId);
    },
  );
  console.info("[voice-debug] recorder start result", { result, ...getVoiceDebugContext() });
  if (!result || result.success === false) {
    if (result?.notAllowed) {
      clearMicGrantedPersisted();
      state._micPermissionReady = false;
    }
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
    uni.showToast({
      title: result?.error || "录音启动失败",
      icon: "none",
      duration: 4000,
    });
    // 关键：录音启动失败时，必须彻底重置手势状态，否则下一次按压会被残留值锁住，调不起原生。
    _cancelShortVoiceRecording({ keepText: state._keepOldRecognizedText });
  }
}
async function _cancelShortVoiceRecording({ keepText = false } = {}) {
  if (state._voiceCancelling) return;
  state._voiceCancelling = true;
  _invalidateJob();
  if (keepText && (state.recognizedText || state.draftText)) {
    state.voicePhase = "finished";
    state.inputMode = "voice";
    state._isRecognizing = false;
  } else {
    resetVoiceInput();
  }
  state._gesture.active = false;
  try {
    console.info("[voice] short press: waiting recorder cancellation");
    await _stopVoiceRecorder(true);
  } finally {
    state._voiceCancelling = false;
    console.info("[voice] short press: recorder cancellation completed");
  }
}

async function _stopVoiceRecorder(forceCancel = false) {
  try {
    const recorder = _ensureRecorder();
    if (!recorder) return;
    if (forceCancel) {
      // 作废当前识别任务（避免 onStop 异步回调覆盖 UI）
      _invalidateJob();
      await recorder.cancel?.();
      return;
    }
    await recorder.stop?.();
  } catch {
    // ignore
  }
}
async function _stopVoiceRecorderAndRecognize() {
  const recorder = _ensureRecorder();
  let stopTimer;
  try {
    // stop 会触发 recorder onStop(blob) -> _recognizeFromBlob
    const stopPromise = recorder.stop?.();
    const result = await Promise.race([
      stopPromise,
      new Promise((resolve) => {
        stopTimer = setTimeout(() => resolve({ success: false, error: "停止录音超时" }), VOICE_STOP_TIMEOUT_MS);
      }),
    ]);
    if (!result || result.success === false) {
      _invalidateJob();
      await recorder.cancel?.();
      state._isRecognizing = false;
      resetVoiceInput();
      uni.showToast({ title: result.error || "语音识别失败", icon: "none" });
    }
  } catch {
    _invalidateJob();
    await recorder.cancel?.();
    state._isRecognizing = false;
    resetVoiceInput();
    uni.showToast({ title: "语音识别失败", icon: "none" });
  } finally {
    if (stopTimer) clearTimeout(stopTimer);
  }
}
async function _recognizeFromBlob(blob, jobId) {
  if (jobId !== state._jobSeq) return;
  if (!blob) {
    state._isRecognizing = false;
    resetVoiceInput();
    return;
  }
  if (jobId !== state._jobSeq) return;

  const prevText = String(state.recognizedText || "");

  state._isRecognizing = true;
  try {
    if (jobId !== state._jobSeq) return;
    const isNativeAudioUrl = typeof blob === "string";
    const text = isNativeAudioUrl
      ? await _recognizeSpeechWithUrl(blob)
      : await (async () => {
          const audioBase64 = await _blobToAudioBase64(blob);
          console.info("[voice] audio converted to Base64", {
            audioSize: audioBase64.length,
          });
          if (!audioBase64) return "";
          return _recognizeSpeechWithBase64(audioBase64);
        })();
    if (!text) {
      state.recognizedText = prevText;
      state.draftText = prevText;
      if (prevText) {
        state.voicePhase = "finished";
      } else {
        resetVoiceInput();
        uni.showToast({ title: "未识别到语音内容", icon: "none" });
      }
      return;
    }
    if (jobId !== state._jobSeq) return;

    console.info("[voice] ASR response", { text });
    // 识别完成：在已有旧文字基础上拼接新识别结果
    const nextText = prevText ? `${prevText}${text}` : text;
    state.recognizedText = nextText;
    state.draftText = nextText;
    state.voicePhase = "finished";
    state.inputMode = "voice";
  } catch {
    if (jobId !== state._jobSeq) return;
    state.recognizedText = prevText;
    state.draftText = prevText;
    if (prevText) {
      state.voicePhase = "finished";
    } else {
      resetVoiceInput();
      uni.showToast({ title: "语音识别失败", icon: "none" });
    }
  } finally {
    state._isRecognizing = false;
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
  }
}

async function _blobToAudioBase64(blob) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : "";
        if (!base64) return resolve("");
        // 按你提供示例：data:audioBase64;base64,xxxx
        resolve(`data:audioBase64;base64,${base64}`);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e);
    }
  });
}

function _extractAsrText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  // 常见：{ success: true, text: '...' }
  if (data.text && typeof data.text === "string") return data.text;
  // 后端可能包了一层 data/result
  if (data.data && typeof data.data.text === "string") return data.data.text;
  if (data.result && typeof data.result.text === "string") return data.result.text;
  if (data.data && typeof data.data.Result === "string") return data.data.Result;
  if (data.Result && typeof data.Result === "string") return data.Result;
  return "";
}

function withVoiceTimeout(promise, message = "语音识别超时") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), VOICE_ASR_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
async function _recognizeSpeechWithBase64(audioBase64) {
  console.info("[voice] ASR Base64 request", {
    audioSize: audioBase64.length,
  });
  const resp = await withVoiceTimeout(recognizeSpeechByBase64({ audioBase64 }));
  console.info("[voice] ASR Base64 response", resp);
  const payload = resp?.data ? resp.data : resp;
  const text = _extractAsrText(payload);
  return text || state.recognizedTextFull;
}

async function _recognizeSpeechWithUrl(audioUrl) {
  console.info("[voice] ASR URL request", { audioUrl });
  const resp = await withVoiceTimeout(recognizeSpeechByUrl({ audioUrl }));
  console.info("[voice] ASR URL response", resp);
  const payload = resp?.data ? resp.data : resp;
  const text = _extractAsrText(payload);
  return text || state.recognizedTextFull;
}
// 输入与语音模式共用键盘高度状态：父页面据此隐藏底部快捷导航。
watch(keyboardHeightPx, (height) => {
  emit("keyboard-height-change", height || 0);
});

onBeforeUnmount(() => {
  removeVoiceMouseUpListener();
  removeVoiceRestartMouseUpListener();
  _invalidateJob();
  state._voiceGestureCancelling = false;
  state._gesture.active = false;
  state._gesture.startY = 0;
  state._gesture.isRestart = false;
  state._voiceCancelling = false;
  state._micPermissionRequesting = false;
  state._isRecognizing = false;
  void _stopVoiceRecorder(true);
  if (state._pressTimer) clearTimeout(state._pressTimer);
  if (state._typingTimer) clearInterval(state._typingTimer);
});
</script>

<template>
  <view
    v-if="keyboardInteractionMasked"
    class="keyboard-interaction-mask"
    :style="rootStyle"
  />
  <!-- text 键盘态：输入栏抽离为 absolute 贴键盘顶，这里在原位置留等高占位，避免内容区跳动 -->
  <view
    v-if="textKeyboardOpen && textInputBarHeightPx > 0"
    :style="{ height: `${textInputBarHeightPx}px` }"
  />
  <view
    class="chat-input"
    :class="{
      'chat-input--keyboard-open': voiceKeyboardOpen,
      'chat-input--text-keyboard-open': textKeyboardOpen,
    }"
    :style="rootStyle"
  >
    <!-- 语音模式：悬浮在当前对话内容上的面板 -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle'"
      class="voice-sheet"
      :class="{ 'voice-sheet--keyboard-open': voiceKeyboardOpen }"
    >
      <view
        v-if="!isVoiceConfirmationOpen"
        class="voice-sheet__close"
        aria-label="关闭语音面板"
        @tap="onVoiceClose"
      >
        <text>×</text>
      </view>
      <!-- 41167:414 正在说话：波纹动画 -->
      <view
        class="voice-recording"
        :class="{ 'voice-recording--finished': isVoiceConfirmationOpen }"
      >
        <view
          v-if="!isVoiceConfirmationOpen"
          class="voice-recording__live"
        >
          <view
            class="voice-recording__header"
            :class="{ 'voice-recording__header--cancelling': state._voiceGestureCancelling }"
          >
            <text class="voice-recording__listening">
              {{ state._voiceGestureCancelling ? '松开取消语音' : 'Noyi正在听，请说话' }}
            </text>
            <text class="voice-recording__hint">
              {{ state._voiceGestureCancelling ? '松开手指取消识别' : '说完松手  可编辑文字' }}
            </text>
          </view>
          <view v-if="voicePhase === 'recording'" class="voice-recording__wave" aria-hidden="true">
            <view v-for="bar in 25" :key="bar" class="voice-recording__wave-bar" />
          </view>
        </view>
        <view
          v-else
          class="voice-recording__stream"
          :class="{
            'voice-recording__stream--editing': voiceKeyboardOpen,
            'voice-recording__stream--recognizing': state._isRecognizing,
          }"
        >
          <textarea
            ref="voiceTextareaRef"
            class="voice-recording__textarea"
            :value="voiceTextValue"
            :maxlength="500"
            :disabled="state._isRecognizing"
            placeholder=""
            :adjust-position="false"
            confirm-type="send"
            @input="onVoiceTextareaInput"
            @focus="onVoiceTextareaFocus"
            @blur="onVoiceTextareaBlur"
            @tap="focusVoiceTextarea"
          />
          <view v-if="state._isRecognizing" class="voice-recognizing" aria-label="语音识别中">
            <view class="voice-recognizing__spinner" />
            <text class="voice-recognizing__text">
              语音识别中...
            </text>
          </view>
        </view>
        <view
          class="voice-recording__body"
          :class="{ 'voice-recording__body--finished': isVoiceConfirmationOpen }"
        >
          <view class="voice-recording__content">
            <view
              v-if="isVoiceConfirmationOpen"
              id="voice-actions-anchor"
              class="voice-finished-actions"
              :class="{ 'voice-finished-actions--recognizing': state._isRecognizing }"
            >
              <view
                class="voice-actions__btn voice-actions__btn--gray"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @touchstart.stop.prevent="onVoiceClose"
                @tap="onVoiceClose"
              >
                <image
                  src="@/assets/img/icon-close-lg.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
              <view
                class="voice-actions__btn-send voice-actions__btn--red"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @touchstart.stop.prevent="onVoiceSend"
                @tap="onVoiceSend"
              >
                <image
                  src="@/assets/img/icon-send-2.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon voice-finished-actions__icon--send"
                />
              </view>

              <view
                class="voice-actions__btn voice-actions__btn--gray"
                :class="{
                  'voice-finished-actions--keyboard-open': voiceKeyboardOpen,
                }"
                @mousedown="onVoiceRestartMouseDown"
                @contextmenu.prevent
                @touchstart.stop.prevent="onVoiceRestartStart"
                @touchmove.stop.prevent="updateVoiceGesture"
                @touchend.stop.prevent="onVoiceRestartEnd"
                @touchcancel.stop.prevent="onVoiceRestartCancel"
              >
                <image
                  src="@/assets/img/icon-voice-sm.svg"
                  mode="aspectFit"
                  class="voice-finished-actions__icon"
                />
              </view>
            </view>
            <view
              v-else
              class="voice-recording__rings"
              @mousedown="onVoiceTouchStart"
              @mouseup="onVoiceTouchEnd"
              @mousemove="updateVoiceGesture"
              @contextmenu.prevent
              @touchstart.stop.prevent="onVoiceTouchStart"
              @touchmove.stop.prevent="updateVoiceGesture"
              @touchend.stop.prevent="onVoiceTouchEnd"
              @touchcancel.stop.prevent="onVoiceTouchCancel"
            >
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--outer" />
              <view v-if="voicePhase === 'recording'" class="voice-ring voice-ring--middle" />
              <image
                mode="aspectFit"
                class="voice-ring--inner-img"
                src="@/assets/img/icon-voice-lg.svg"
              />
            </view>
          </view>
        </view>
      </view>
    </view>
    <!-- 底部输入栏：默认语音、键盘文本、发送和生成中状态 -->
    <view
      class="input-bar"
      :class="{ 'input-bar--text': inputMode === 'text' }"
    >
      <view
        v-if="inputMode === 'voice' && !isLoading"
        class="input-bar__keyboard"
        @tap="switchToText"
      >
        <image src="@/assets/img/icon-keyboard.svg" mode="aspectFit" />
      </view>
      <view
        v-else-if="!isLoading && !modelValue"
        class="input-bar__microphone"
        @tap="switchToDefaultVoice"
      >
        <image src="@/assets/img/icon-voice.svg" mode="aspectFit" />
      </view>

      <view
        v-if="inputMode === 'voice'"
        class="input-bar__voice-pill"
        @mousedown="onVoicePillMouseDown"
        @contextmenu.prevent
        @touchstart.stop.prevent="onVoicePillTouchStart"
        @touchmove.stop.prevent="updateVoiceGesture"
        @touchend.stop.prevent="onVoicePillTouchEnd"
        @touchcancel.stop.prevent="onVoicePillTouchCancel"
      >
        <text class="input-bar__voice-hint">
          按住 说话
        </text>
      </view>
      <view v-else class="input-bar__text-field">
        <textarea
          class="input-bar__textarea"
          :value="modelValue"
          :style="{ height: textTextareaHeight }"
          placeholder="发消息"
          :auto-height="false"
          :adjust-position="false"
          confirm-type="send"
          placeholder-class="input-bar__placeholder"
          @input="emit('update:modelValue', $event.detail.value)"
          @confirm="onTrySend"
          @focus="onTextTextareaFocus"
          @blur="onTextTextareaBlur"
        />
      </view>

      <view class="input-bar__plus" @tap="onToggleQuickList">
        <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
      </view>

      <view v-if="inputMode === 'text' && modelValue" class="input-bar__send" @tap="onTrySend">
        <image src="@/assets/img/icon-send.svg" mode="aspectFit" />
      </view>
      <view v-else-if="isLoading" class="input-bar__stop" @tap="emit('stop')">
        <image src="@/assets/img/icon-stop.svg" mode="aspectFit" />
      </view>
    </view>

    <!-- 输入单元下提示（Figma: 41116:6071） -->
    <view class="chat-input__footer">
      <text class="chat-input__footer-text">
        内容由AI生成，请核实重要信息
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.keyboard-interaction-mask {
  position: fixed;
  z-index: 1100;
  top: 0;
  right: 0;
  left: 0;
  // 仅覆盖键盘上方的可见区域；键盘本身由系统接管，无需也无法覆盖。
  height: max(0px, calc(var(--window-height, 100dvh) - var(--vv-bottom-offset, 0px)));
  background: transparent;
}

.chat-input {
  background: transparent;
  padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));
  box-sizing: border-box;
  position: relative;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

.chat-input--keyboard-open {
  // 键盘弹起时保持普通文档流，WebView 会自动将页面上移露出输入区
  // 不使用 fixed/transform，避免整体上移遮挡输入框
  position: relative;
}

// 普通输入模式键盘弹出：输入栏相对聊天容器绝对定位，并通过 visualViewport 偏移贴到键盘顶，
// 避免 WebView 对 fixed 元素重复避让导致输入栏位置异常。
.chat-input--text-keyboard-open {
  position: absolute;
  z-index: 1200;
  right: 0;
  bottom: var(--vv-bottom-offset, 0px);
  left: 0;
  // 键盘态不再消费底部安全区：输入栏底边贴键盘顶即可
  padding-bottom: 0;
  background: #ffffff;
}

.voice-sheet {
  position: fixed;
  z-index: 1300;
  right: 0;
  // 固定浮窗仅使用 px 安全区，避免与 visualViewport 的 px 偏移混算。
  bottom: var(--safe-bottom-px, env(safe-area-inset-bottom));
  left: 0;
  height: min(540rpx, var(--voice-sheet-h, calc(100dvh - 412rpx)));
  min-height: 420rpx;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 112rpx 112rpx 0 0;
  background:
    radial-gradient(ellipse 196rpx 117rpx at 0 0, rgba(123, 167, 217, 0.06) 50%, transparent 100%),
    radial-gradient(ellipse 301rpx 117rpx at 100% 0, rgba(254, 0, 0, 0.07) 0%, transparent 100%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.86) 0%, rgba(255, 251, 251, 0.78) 100%);
  backdrop-filter: blur(28rpx) saturate(122%);
  -webkit-backdrop-filter: blur(28rpx) saturate(122%);
  box-shadow: 0 -12rpx 56rpx rgba(75, 85, 99, 0.16);
}

.voice-sheet__close {
  position: absolute;
  z-index: 2;
  top: 24rpx;
  right: 28rpx;
  width: 52rpx;
  height: 52rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #7d8796;
  background: transparent;
  font-size: 40rpx;
  font-weight: 300;
  line-height: 1;
}

.voice-sheet::after {
  position: absolute;
  z-index: 0;
  bottom: -104rpx;
  left: -30rpx;
  width: 810rpx;
  height: 342rpx;
  border-radius: 50%;
  background: linear-gradient(180deg, #fce5e5 0%, rgba(252, 229, 229, 0) 99.43%);
  content: '';
}

.voice-sheet--keyboard-open {
  // 键盘弹出：浮窗底边贴 visualViewport 底边（即键盘顶），bottom 取安全区与键盘偏移的较大者。
  bottom: max(var(--safe-bottom-px, env(safe-area-inset-bottom)), var(--vv-bottom-offset, 0px));
  height: 540rpx;
  max-height: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.voice-sheet--keyboard-open .voice-recording {
  flex: 1;
  justify-content: space-between;
  align-items: stretch;
  padding: 0 48rpx 40rpx;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-sheet--keyboard-open .voice-recording__stream {
  flex: 1 1 0;
  height: 0;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.78);
  box-sizing: border-box;
  overflow: hidden;
}

.voice-sheet--keyboard-open .voice-recording__textarea {
  height: 100% !important;
}

/* 键盘弹起时保持原有流式布局，避免完成态的绝对定位覆盖输入区。 */
.voice-sheet--keyboard-open .voice-recording--finished .voice-recording__stream {
  position: static;
  flex: 1 1 0;
  height: 0;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
}

.voice-sheet--keyboard-open .voice-recording--finished .voice-finished-actions {
  position: relative;
  width: 460rpx;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin: 0 auto;
  // 安全区由外层 .voice-recording 统一消费，此处不再重复叠加
  padding: 0 0 36rpx;
}

.voice-sheet--keyboard-open .voice-recording--finished .voice-actions__btn {
  transform: translateY(42rpx);
}

.voice-sheet--keyboard-open .voice-recording--finished .voice-actions__btn-send {
  transform: none;
}

.voice-sheet--keyboard-open .voice-recording__body {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 0;
}

.voice-recording__body {
  flex: 0 0 auto;
  width: 100%;
}

.voice-recording__body--finished {
  position: static;
  margin: 0 0 8rpx;
}

.voice-recording__content {
  display: flex;
  justify-content: center;
}

.voice-sheet--keyboard-open .voice-recording__content {
  padding-top: 0;
}

.voice-sheet--keyboard-open .voice-recording__rings {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  width: 100%;
  height: auto;
  margin-top: 0;
  padding: 16rpx 0 32rpx;
}

.voice-sheet__home {
  display: flex;
  justify-content: center;
  padding: 0 0 16rpx;
  margin-top: auto;
}

.voice-sheet__home-bar {
  width: 134rpx; // 67px
  height: 10rpx; // 5px
  border-radius: 100rpx;
  background: #000;
}

.voice-tip {
  background: transparent;
  border-radius: 0;
  overflow: visible;
}
.voice-recording__instruction {
  height: 48rpx;
  display: flex;
  justify-content: center;
  align-items: center;
}

.voice-recording__instruction-text {
  font-size: 26rpx;
  font-weight: 500;
  color: #5f6775;
}

.voice-recording__content {
  padding-top: 0;
}
.voice-tip__header {
  display: flex;
  line-height: 32px;
  justify-content: center;
}

.voice-tip__text {
  font-size: 24rpx;
  color: #1f2937;
}

.voice-tip__mic-wrap {
  padding: 0 0 96rpx;
  display: flex;
  justify-content: center;
}

.voice-mic {
  width: 160rpx;
  height: 160rpx;
  border-radius: 80rpx;
  background: #f12832;
}

.voice-tip__home {
  padding: 32rpx 242rpx 16rpx;
}

.voice-tip__home-bar {
  height: 10rpx;
  border-radius: 100rpx;
  background: #000;
}

.voice-recording {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  padding: 0 48rpx 40rpx;
  box-sizing: border-box;
}

.voice-recording--finished {
  justify-content: space-between;
}

.voice-recording__live {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 0;
  // 上下对称 padding：安全区由外层 .voice-recording 统一消费，避免重复叠加导致居中内容偏移
  padding: 40rpx 0;
  box-sizing: border-box;
}

.voice-recording__header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}

.voice-recording__listening {
  font-size: 30rpx;
  font-weight: 500;
  color: #2f323c;
  line-height: 34rpx;
}

.voice-recording__hint {
  font-size: 26rpx;
  color: #8d95a3;
  line-height: 30rpx;
}

.voice-recording__header--cancelling {
  .voice-recording__listening,
  .voice-recording__hint {
    color: #f12832;
  }
}

.voice-recording__transcript {
  width: 100%;
  margin: 0 0 112rpx;
  font-size: 30rpx;
  color: #2f323c;
  line-height: 46rpx;
}

.voice-recording__wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  width: 496rpx;
  height: 46rpx;
  margin: 48rpx 0 0;
}

.voice-recording__wave-bar {
  width: 8rpx;
  height: 12rpx;
  border-radius: 100rpx;
  background: #f12832;
  transform-origin: center;
  animation: voice-wave 0.82s ease-in-out infinite alternate;
}

.voice-recording__wave-bar:nth-child(2n) {
  height: 18rpx;
  animation-delay: 0.12s;
}

.voice-recording__wave-bar:nth-child(3n) {
  height: 28rpx;
  animation-delay: 0.24s;
}

.voice-recording__wave-bar:nth-child(4n) {
  height: 38rpx;
  animation-delay: 0.36s;
}

.voice-recording__wave-bar:nth-child(-n + 6),
.voice-recording__wave-bar:nth-child(n + 20) {
  opacity: 0.42;
}

@keyframes voice-wave {
  from { transform: scaleY(0.55); }
  to { transform: scaleY(1.12); }
}

.voice-recording__stream {
  flex: 1;
  width: 100%;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.78);
  box-sizing: border-box;
  overflow: hidden;
}

.voice-recording--finished .voice-recording__stream {
  position: static;
  z-index: 1;
  flex: 1 1 0;
  width: 100%;
  min-height: 160rpx;
  margin: 52rpx 0 68rpx;
  padding: 38rpx 32rpx;
  border-radius: 24rpx;
  background: #f6f6f6;
}

.voice-recording__stream--editing {
  background: rgba(244, 247, 252, 0.96);
  box-shadow: inset 0 0 0 2rpx rgba(54, 109, 255, 0.16);
}
.voice-recording__stream--pressing {
  border-bottom: none;
}

.voice-recording__stream-text {
  display: block;
  font-size: 26rpx;
  color: #2f323c;
  line-height: 40rpx;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.voice-recording__textarea {
  width: 100%;
  height: 100%;
  min-height: 120rpx;
  padding: 0;
  margin: 0;
  font-size: 26rpx;
  color: #2f323c;
  line-height: 40rpx;
  background: transparent;
  overflow: hidden;
}

.voice-recording__stream--recognizing {
  position: relative;
}

.voice-recognizing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.72);
}

.voice-recognizing__spinner {
  width: 30rpx;
  height: 30rpx;
  border: 4rpx solid rgba(241, 40, 50, 0.2);
  border-top-color: #f12832;
  border-radius: 50%;
  animation: voice-recognizing-spin 0.8s linear infinite;
}

.voice-recognizing__text {
  color: #7d8796;
  font-size: 26rpx;
}

.voice-finished-actions--recognizing {
  pointer-events: none;
  opacity: 0.45;
}

@keyframes voice-recognizing-spin {
  to {
    transform: rotate(360deg);
  }
}

.voice-finished {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.voice-finished__top {
  flex-shrink: 0;
}

.voice-finished__text {
  flex: 0 0 auto;
  height: 300rpx; // 150px
  padding: 0 36rpx 48rpx; // 0 18px 24px
  border-bottom: 1rpx solid #e5e7ea;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-finished__text-content {
  height: 100%;
  width: 100%;
  display: block;
}

.voice-editing {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.voice-editing__top {
  flex-shrink: 0;
}

.voice-editing__textarea {
  flex: 0 0 auto;
  height: 132rpx; // 66px
  padding: 0 36rpx 30rpx; // 0 18px 15px
  box-sizing: border-box;
  overflow: hidden;
}

.voice-recording__rings {
  position: relative;
  width: 84rpx;
  height: 84rpx;
  margin: 0 auto 24rpx;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  cursor: pointer;
}

.voice-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
}

.voice-ring--outer {
  width: 104rpx;
  height: 104rpx;
  background: rgba(241, 40, 50, 0.12);
  animation: voice-pulse 2.4s ease-out infinite;
}

.voice-ring--middle {
  width: 92rpx;
  height: 92rpx;
  background: rgba(241, 40, 50, 0.18);
  animation: voice-pulse 1.8s ease-out infinite;
}

.voice-ring--inner {
  width: 84rpx;
  height: 84rpx;
  background: #f12832;
  display: flex;
  justify-content: center;
  align-items: center;
}
.voice-ring--inner-img {
  width: 84rpx;
  height: 84rpx;
}
@keyframes voice-pulse {
  0% {
    opacity: 0.8;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.3);
  }
}

.voice-actions {
  display: flex;
  justify-content: center;
  gap: 32rpx;
  padding: 48rpx 0;
}

.voice-finished__top {
  display: flex;
  justify-content: center;
  padding-top: 96rpx;
}

.voice-finished__title {
  font-size: 24rpx;
  color: #9a9a9a;
}

.voice-finished__text {
  padding: 0 36rpx 48rpx; // 0 18px 24px
  height: 300rpx; // 150px
  border-bottom: 1rpx solid #e5e7ea;
  box-sizing: border-box;
  display: flex;
  justify-content: center;
}

.voice-finished__text-content {
  width: 100%;
  padding: 0;
  font-size: 28rpx;
  color: #2f323c;
  line-height: 40rpx;
  overflow: hidden;
  height: 100%;
}

.voice-editing__top {
  display: flex;
  justify-content: center;
  padding-top: 96rpx;
}

.voice-editing__textarea {
  width: 100%;
  height: 132rpx; // 66px
  padding: 0 36rpx 30rpx; // 0 18px 15px
  font-size: 28rpx;
  color: #2f323c;
  box-sizing: border-box;
  overflow: hidden;
}

.voice-actions__btn,
.voice-actions__btn-send {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  background: transparent;

  &:active {
    opacity: 0.8;
  }
}

.voice-actions__btn {
  width: 72rpx;
  height: 72rpx;
}

.voice-actions__btn-send {
  width: 96rpx;
  height: 96rpx;
}

.voice-finished-actions--keyboard-open {
  aspect-ratio: 1;
  border-radius: 50%;
}

.voice-actions__btn-symbol {
  color: #9ca3af;
  font-size: 40rpx;
  font-weight: 300;
  line-height: 1;
}

.voice-actions__btn-arrow {
  color: #fff;
  font-size: 48rpx;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-2rpx);
}

.voice-actions__btn-text {
  font-size: 24rpx;
  color: #5f6775;
}

.voice-finished-actions {
  position: relative;
  z-index: 1;
  width: 460rpx;
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin: 0 auto;
  // 安全区由外层 .voice-recording 统一消费，此处不再重复叠加
  padding: 0 0 36rpx;
}

.voice-finished-actions .voice-actions__btn {
  transform: translateY(42rpx);
}

.voice-finished-actions .voice-actions__btn-send {
  transform: none;
}

.voice-finished-actions__icon {
  display: block;
  width: 72rpx;
  height: 72rpx;
}

.voice-finished-actions .voice-actions__btn {
  transform: translateY(42rpx);
}

.voice-finished-actions__icon--send {
  width: 96rpx;
  height: 96rpx;
}

.voice-actions__btn--red .voice-actions__btn-text {
  color: #ffffff;
}

.input-bar {
  display: flex;
  align-items: center;
  gap: 20rpx; // 10px
  min-height: 128rpx; // 64px
  padding: 0 40rpx; // 20px
  box-sizing: border-box;
}

.input-bar__keyboard,
.input-bar__microphone {
  width: 56rpx; // 28px
  height: 56rpx;
  flex: 0 0 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__voice-pill,
.input-bar__text-field {
  flex: 1;
  min-width: 0;
  min-height: 88rpx; // 44px
  border-radius: 44rpx;
  background: #f5f5f5;
  box-sizing: border-box;
}

.input-bar__voice-pill {
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__voice-hint {
  font-size: 24rpx; // 12px
  font-weight: 400;
  color: #999999;
  line-height: 34rpx;
}

.input-bar__text-field {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 12rpx 24rpx;
  overflow: hidden;
}

.input-bar__textarea {
  width: 100%;
  min-height: 40rpx;
  max-height: 176rpx;
  overflow-y: auto;
  line-height: 40rpx;
  font-size: 28rpx; // 1p4x
  color: #1a1a1a;
  background: transparent;
  box-sizing: border-box;
}

.input-bar__placeholder {
  font-size: 24rpx;
  color: #bababa;
}

.input-bar__plus,
.input-bar__send,
.input-bar__stop {
  display: flex;
  align-items: center;
  justify-content: center;
}
.input-bar__plus,
.input-bar__send {
  width: 64rpx; // 32px
  height: 64rpx;
}
.input-bar__stop {
  width: 54rpx;
  height: 54rpx;
}

.input-bar__keyboard:active,
.input-bar__microphone:active,
.input-bar__voice-pill:active,
.input-bar__plus:active,
.input-bar__send:active,
.input-bar__stop:active {
  opacity: 0.7;
}

.chat-input__hold {
  flex: 1;
  font-size: 32rpx; // 16px
  line-height: 44rpx;
  color: #232323;
  text-align: center;
}

.chat-input__icon-mic {
  width: 40rpx;
  height: 40rpx;
  background: #000;
  border-radius: 20rpx;
}

.chat-input__footer {
  padding-top: 4rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.chat-input__footer-text {
  width: 100%;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  color: #bababa;
  text-align: center;
  margin-bottom: 0;
}

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}
</style>

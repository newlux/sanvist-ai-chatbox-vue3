<script setup>
import { recognizeSpeechByUpload } from "@/api/chat";
import AiChatAttachments from "@/components/ai-chat-attachments/index.vue";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import VoiceRecorder from "@/utils/voiceRecorder.js";

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
  /** 键盘高度(px)。输入栏与语音面板按它整体上移，页面本身不缩放 */
  keyboardHeight: { type: Number, default: 0 },
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
  "input-focus",
  "input-blur",
]);

const VOICE_LONG_PRESS_MS = 300;
const VOICE_CANCEL_SWIPE_PX = 60;
const VOICE_ASR_TIMEOUT_MS = 30000;
// 识别态是入口的硬拦截条件，用看门狗兜底，避免任何异常路径把语音入口永久锁死
const VOICE_RECOGNIZE_WATCHDOG_MS = 45000;
const state = reactive({
  inputMode: "voice", // text | voice（组件内部维护）
  voicePhase: "idle", // idle | recording | recognizing | finished | editing
  _pressTimer: null,
  _typingTimer: null,
  _typingIndex: 0,
  recorder: null,
  _jobSeq: 0, // 递增任务序号：每开始一次录音自增，作废迟到的异步回调
  _voicePressStartedAt: 0,
  recognizedText: "",
  draftText: "",
  _isRecognizing: false,
  _recognizeWatchdog: null,
  _keepOldRecognizedText: false,
  _micPermissionReady: false,
  _micPermissionRequesting: false,
  // 上划取消手势：模板依赖 _voiceGestureCancelling，保留；其余手势状态收敛进 _gesture
  _voiceGestureCancelling: false,
  // 「再次识别」进行中：确认面板不卸载，靠这个标记切按钮样式
  _restartRecording: false,
  _gesture: { active: false, startY: 0, isRestart: false },
});
const { inputMode, voicePhase } = toRefs(state);
// 当前录音会话上下文：存放本次录音的 jobSeq 与 start promise，
// 避免模块级单变量被多入口并发覆盖。
let currentJob = null;

const voiceTextareaRef = ref(null);
const voiceTextValue = computed(() => {
  // 重录期间草稿被清空了，先显示上一轮的识别结果，别让文本框突然空掉
  if (state._restartRecording) return state.recognizedText;
  if (state.voicePhase === "finished") {
    return state.draftText;
  }
  return state.recognizedText;
});
const isVoiceConfirmationOpen = computed(() =>
  state.voicePhase === "finished" || state.voicePhase === "recognizing",
);
/**
 * 输入框的本地副本。父组件清空 v-model 是异步的（发送链路里还要过一次 store），
 * 这里保留一份本地值，发送时立即置空，保证输入框肉眼可见地被清干净。
 */
const draft = ref(String(props.modelValue || ""));
watch(() => props.modelValue, (value) => {
  const next = String(value || "");
  if (next !== draft.value) draft.value = next;
});

const textTextareaHeight = computed(() => {
  const maxCharsPerLine = 15;
  const lineCount = String(draft.value || "")
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
  return `${Math.min(Math.max(lineCount, 1), 4) * 40}rpx`;
});

const {
  attachments,
  hasAttachments,
  hasIncompleteAttachments,
  hasFailedAttachments,
  openAttachmentPicker,
  removeAttachment,
  retryAttachment,
  takeUploadedFiles,
} = useComposerAttachments();

const keyboardOpen = computed(() => props.keyboardHeight > 0);

/**
 * 支付宝不认 textarea 的 adjust-position，键盘弹起时页面不会自己让位，
 * 只能由输入栏和语音面板整体上移到键盘上沿。页面高度不参与，避免消息列表重排。
 */
const keyboardLiftStyle = computed(() => ({
  transform: keyboardOpen.value ? `translateY(-${props.keyboardHeight}px)` : "translateY(0)",
  transition: "transform 0.2s ease-out",
}));

/**
 * 收键盘后遮罩多留一会儿：键盘落下的过程中输入栏会跟着往下移动，
 * 遮罩要是立刻消失，这一次触摸的 tap 会落到刚好移过来的加号上，凭空弹出附件面板。
 */
const maskLingering = ref(false);
let maskLingerTimer = null;
const showKeyboardMask = computed(() => keyboardOpen.value || maskLingering.value);

/** 点击面板以外的区域收起键盘：识别结果编辑态下这是唯一的退出口 */
function onDismissKeyboard() {
  uni.hideKeyboard();
  emit("input-blur");
  maskLingering.value = true;
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  maskLingerTimer = setTimeout(() => {
    maskLingerTimer = null;
    maskLingering.value = false;
  }, 400);
}

/** 遮罩上的 tap 只做拦截，避免透传到下面的按钮 */
function onMaskTap() {}

const canSend = computed(() =>
  Boolean(draft.value.trim() || hasAttachments.value) && !hasIncompleteAttachments.value,
);

function onDraftInput(e) {
  draft.value = e.detail.value;
  emit("update:modelValue", draft.value);
}

function onTextareaFocus() {
  emit("input-focus");
}

function onTextareaBlur() {
  // 失焦即键盘收起：个别基础库不会再回调高度 0，这里主动复位，
  // 否则可视区会一直停在被压缩的高度上
  emit("input-blur");
}

function focusVoiceTextarea() {
  nextTick(() => {
    voiceTextareaRef.value?.focus?.();
  });
}

/**
 * 统一的发送出口（文本回车 / 发送按钮 / 语音识别结果确认）。
 * 附件与文本一起提交，随后立刻清空输入框与附件栏。
 */
function submitMessage(rawText) {
  if (props.isLoading) return;
  const text = String(rawText ?? draft.value).trim();
  if (!text && !hasAttachments.value) return;

  if (hasIncompleteAttachments.value) {
    uni.showToast({
      title: hasFailedAttachments.value ? "请重试或移除上传失败的附件" : "请等待附件上传完成",
      icon: "none",
    });
    return;
  }
  // 网关要求 query 非空，纯附件无法成会话
  if (!text) {
    uni.showToast({ title: "请输入要发送的内容", icon: "none" });
    return;
  }

  const files = takeUploadedFiles();
  draft.value = "";
  emit("update:modelValue", "");
  emit("send", { text, files });
}

function onTrySend() {
  submitMessage();
}

function onOpenAttachmentPicker() {
  if (props.isLoading) return;
  openAttachmentPicker();
}

function _ensureRecorder() {
  if (!state.recorder) {
    state.recorder = new VoiceRecorder();
  }
  return state.recorder;
}
/**
 * 识别态开关的唯一入口。开启时挂看门狗，保证即使某条异常路径漏了关闭，
 * 入口锁也会在有限时间内自动解除。
 */
function setRecognizing(on) {
  if (state._recognizeWatchdog) {
    clearTimeout(state._recognizeWatchdog);
    state._recognizeWatchdog = null;
  }
  state._isRecognizing = on;
  if (!on) return;
  state._recognizeWatchdog = setTimeout(() => {
    console.warn("[voice] recognizing watchdog fired, force reset");
    state._recognizeWatchdog = null;
    state._isRecognizing = false;
    if (state.voicePhase === "recognizing") {
      resetVoiceInput();
      uni.showToast({ title: "语音识别超时", icon: "none" });
    }
  }, VOICE_RECOGNIZE_WATCHDOG_MS);
}
function _resetVoiceText() {
  state._restartRecording = false;
  state.recognizedText = "";
  state.draftText = "";
  state._keepOldRecognizedText = false;
  setRecognizing(false);
  state._typingIndex = 0;
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}
/**
 * 作废当前录音会话：迟到的异步结果一律按 jobSeq 丢弃。
 * 作废意味着没有任何在途任务还需要识别态，这里统一解锁。
 */
function _invalidateJob() {
  state._jobSeq += 1;
  currentJob = null;
  setRecognizing(false);
}
function resetVoiceInput() {
  _resetVoiceText();
  _invalidateJob();
  state.voicePhase = "idle";
  state.inputMode = "voice";
  emit("toggle-quick-list", true);
}
function onVoiceClose() {
  _cancelVoiceRecorder();
  resetVoiceInput();
  state._voiceGestureCancelling = false;
  state._gesture.active = false;
  state._gesture.startY = 0;
  state._gesture.isRestart = false;
}
// 生成回答期间也允许切换输入方式：左侧按钮常驻，用户可以先把下一条消息打好
function switchToText() {
  state.inputMode = "text";
  state.voicePhase = "idle";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
}

function switchToDefaultVoice() {
  state.inputMode = "voice";
  state.voicePhase = "idle";
  emit("toggle-quick-list", true);
}

/** 左侧「语音 / 键盘」切换。录音或识别途中不切，避免把进行中的会话丢掉 */
function onToggleInputMode() {
  if (state._gesture.active || state._isRecognizing) return;
  if (state.inputMode === "voice") switchToText();
  else switchToDefaultVoice();
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
/**
 * 取消一次录音（上划取消 / 短按 / 面板关闭）。
 * 不等待录音器：cancel 会同步作废会话，原生释放动作在后台队列里完成，
 * 因此这里不存在任何可能把 UI 锁住的 await。
 */
function cancelVoiceRecording({ keepText = false } = {}) {
  const existingText = state.recognizedText || state.draftText;
  state._restartRecording = false;
  _invalidateJob();

  if (keepText && existingText) {
    state.recognizedText = existingText;
    state.draftText = existingText;
    state.voicePhase = "finished";
    state.inputMode = "voice";
  } else {
    resetVoiceInput();
  }
  resetVoiceGestureState();
  state._gesture.active = false;
  _cancelVoiceRecorder();
  emit("voice-cancel");
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
  // 「再次识别」是长在确认面板上的按钮：切到 recording 会让面板连同按钮一起卸载，
  // 手指还没松开，touchend 就没有接收者了，录音会一直停不下来。
  // 所以重录期间保持 finished 面板，只用 _restartRecording 标记录音态。
  state._restartRecording = restart;
  state.voicePhase = restart ? "finished" : "recording";
  state._gesture.active = true;
  state._gesture.isRestart = restart;
  state._voicePressStartedAt = Date.now();
  emit("toggle-quick-list", true);
  emit(restart ? "voice-restart" : "voice-start");

  const jobSeq = ++state._jobSeq;
  currentJob = {
    seq: jobSeq,
    start: _startVoiceRecorder(jobSeq),
  };
}

/**
 * 统一结束一次录音会话（正常松手 / 上划取消 / 短按）。
 * cancel=true 表示取消（上划或取消手势），不触发识别。
 */
async function endVoiceRecording({ cancel = false } = {}) {
  if (!state._gesture.active) return;
  const isRestart = state._gesture.isRestart;
  if (cancel) {
    // 再次识别入口取消时保留已有文本，回到确认面板
    cancelVoiceRecording({ keepText: isRestart });
    return;
  }
  resetVoiceGestureState();
  state._gesture.active = false;
  state._restartRecording = false;
  await finishVoiceGesture({ keepTextOnCancel: isRestart });
}
async function finishVoiceGesture({ keepTextOnCancel = false } = {}) {
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  state._typingIndex = 0;

  const pressDuration = Date.now() - state._voicePressStartedAt;
  const job = currentJob;
  // 短按（<300ms）或录音未真正启动：按取消处理，不触发识别
  if (pressDuration < VOICE_LONG_PRESS_MS || !job?.start) {
    cancelVoiceRecording({ keepText: keepTextOnCancel });
    return;
  }

  const jobSeq = job.seq;
  state.voicePhase = "recognizing";
  state.inputMode = "voice";
  setRecognizing(true);

  const startResult = await job.start;
  if (jobSeq !== state._jobSeq) return;
  currentJob = null;
  if (!startResult || startResult.success === false) {
    // _startVoiceRecorder 内部失败已自行回收；这里兜底未进入录音器的失败（如权限被拒）
    if (state.voicePhase === "recognizing") {
      cancelVoiceRecording({ keepText: keepTextOnCancel });
    }
    return;
  }
  if (state.voicePhase !== "recognizing") return;
  await _stopVoiceRecorderAndRecognize(jobSeq);
}
async function onVoicePillTouchStart(e) {
  if (
    props.isLoading
    || state._isRecognizing
    || state._gesture.active
    || state._micPermissionRequesting
  ) {
    return;
  }

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
async function onVoicePillTouchCancel() {
  if (!state._gesture.active) return;
  await endVoiceRecording({ cancel: true });
}
function onVoiceTouchStart(e) {
  console.info("[voice] press start", { phase: state.voicePhase, isLoading: props.isLoading });
  if (
    props.isLoading
    || state.voicePhase === "editing"
    || state._isRecognizing
    || state._gesture.active
    || state._micPermissionRequesting
  ) {
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
  const payload = state.voicePhase === "finished" ? state.draftText : state.recognizedText;
  const finalPayload = String(payload || "").trim();
  if (!finalPayload) return;
  state.voicePhase = "idle";
  // 语音发完仍停在语音态：用户下一句大概率还是说，不该被切回键盘
  state.inputMode = "voice";
  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  onDismissKeyboard();

  emit("voice-send", finalPayload);
  // 识别文本直接进发送出口，不再绕 v-model 回传，避免多触发一次 send
  submitMessage(finalPayload);
  _resetVoiceText();
}
async function onVoiceRestartStart(e) {
  if (
    props.isLoading
    || state._isRecognizing
    || state._gesture.active
    || state._micPermissionRequesting
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
  const keepText = state._keepOldRecognizedText;
  state._keepOldRecognizedText = false;

  const result = await recorder.start({ sampleRate: 16000, timeSlice: 1000 });
  if (jobSeq !== state._jobSeq) return { success: false, error: "任务已失效" };
  if (result?.success) return result;

  if (state._typingTimer) clearInterval(state._typingTimer);
  state._typingTimer = null;
  if (!result?.cancelled) {
    uni.showToast({
      title: result?.error || "录音启动失败",
      icon: "none",
      duration: 4000,
    });
  }
  // 启动失败时必须把手势与识别态一起回收，否则下一次按压会被残留状态拦住
  cancelVoiceRecording({ keepText });
  return result || { success: false, error: "录音启动失败" };
}

function _cancelVoiceRecorder() {
  try {
    state.recorder?.cancel?.();
  } catch (e) {
    console.warn("[voice] cancel recorder failed", e);
  }
}

function toastVoiceError(error, fallback) {
  const raw = error instanceof Error
    ? error.message
    : (error && typeof error === "object" && (error.message || error.errMsg || error.errorMessage))
      || String(error || fallback);
  const title = String(raw || fallback).replace(/^Error:\s*/, "").slice(0, 28) || fallback;
  uni.showToast({ title, icon: "none" });
}

async function _stopVoiceRecorderAndRecognize(jobSeq) {
  const recorder = _ensureRecorder();
  let result;
  try {
    result = await recorder.stop();
  } catch (e) {
    console.error("[voice] stop recorder failed", e);
    result = { success: false, error: e?.message || "录音停止失败" };
  }
  if (jobSeq !== state._jobSeq) return;

  if (!result?.success) {
    _invalidateJob();
    _cancelVoiceRecorder();
    resetVoiceInput();
    if (!result?.cancelled) {
      uni.showToast({ title: result?.error || "录音失败", icon: "none" });
    }
    return;
  }
  const filePath = result.data?.tempFilePath;
  console.info("[voice] ready to upload", { filePath, jobSeq });
  await _recognizeFromRecording(filePath, jobSeq);
}

/**
 * 录音文件直传后端识别。不再走 base64：整段音频转 base64 会多占约 1/3 体积，
 * 还要先把整个文件读进内存，长录音在小程序里很容易顶到请求体上限。
 */
async function _recognizeFromRecording(tempFilePath, jobId) {
  if (jobId !== state._jobSeq) return;
  if (!tempFilePath) {
    resetVoiceInput();
    uni.showToast({ title: "未录制到音频内容", icon: "none" });
    return;
  }

  const prevText = String(state.recognizedText || "");

  setRecognizing(true);
  try {
    if (jobId !== state._jobSeq) return;
    console.info("[voice] ASR upload start", { tempFilePath });
    const result = await withVoiceTimeout(recognizeSpeechByUpload({
      filePath: tempFilePath,
      timeout: VOICE_ASR_TIMEOUT_MS,
    }));
    console.info("[voice] ASR upload done", result);
    if (jobId !== state._jobSeq) return;
    const text = String(result?.text || "").trim();
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
  } catch (error) {
    console.error("[voice] ASR upload failed", error);
    if (jobId !== state._jobSeq) return;
    state.recognizedText = prevText;
    state.draftText = prevText;
    if (prevText) {
      state.voicePhase = "finished";
    } else {
      resetVoiceInput();
      toastVoiceError(error, "语音上传失败");
    }
  } finally {
    setRecognizing(false);
    if (state._typingTimer) clearInterval(state._typingTimer);
    state._typingTimer = null;
  }
}

/**
 * 兜底超时：uni.uploadFile 的 timeout 在部分环境不生效，
 * 这里再包一层，保证识别态不会一直挂着。
 */
function withVoiceTimeout(promise, message = "语音识别超时") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), VOICE_ASR_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

onBeforeUnmount(() => {
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  _invalidateJob();
  state._voiceGestureCancelling = false;
  state._gesture.active = false;
  state._gesture.startY = 0;
  state._gesture.isRestart = false;
  state._micPermissionRequesting = false;
  _cancelVoiceRecorder();
  if (state._pressTimer) clearTimeout(state._pressTimer);
  if (state._typingTimer) clearInterval(state._typingTimer);
});
</script>

<template>
  <view class="chat-input">
    <!-- 键盘弹起时的空白区兜底：点一下收键盘，否则编辑识别结果时没有退出口 -->
    <view
      v-if="showKeyboardMask"
      class="chat-input__keyboard-mask"
      :style="{ bottom: keyboardOpen ? `${keyboardHeight}px` : '0' }"
      @touchstart.stop.prevent="onDismissKeyboard"
      @tap.stop="onMaskTap"
    />

    <!-- 语音模式：悬浮在当前对话内容上的面板 -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle'"
      class="voice-sheet"
      :style="keyboardLiftStyle"
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
          :class="{ 'voice-recording__stream--recognizing': state._isRecognizing }"
        >
          <textarea
            ref="voiceTextareaRef"
            class="voice-recording__textarea"
            :value="voiceTextValue"
            :disabled="state._isRecognizing"
            placeholder=""
            confirm-type="send"
            :adjust-position="false"
            :cursor-spacing="16"
            :show-confirm-bar="false"
            @input="onVoiceTextareaInput"
            @confirm="onVoiceSend"
            @focus="onTextareaFocus"
            @tap="focusVoiceTextarea"
          />
          <view v-if="state._isRecognizing" class="voice-recognizing" aria-label="语音识别中">
            <view class="voice-recognizing__spinner" />
            <text class="voice-recognizing__text">
              语音识别中...
            </text>
          </view>
          <view v-else-if="state._restartRecording" class="voice-recognizing" aria-label="正在录音">
            <text class="voice-recognizing__text">
              {{ state._voiceGestureCancelling ? '松开取消' : '正在录音，松开识别' }}
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
                :class="{ 'voice-actions__btn--recording': state._restartRecording }"
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
    <view class="chat-input__dock" :style="keyboardLiftStyle">
      <!-- 附件预览栏：选中的文件在输入栏上方排开 -->
      <AiChatAttachments
        v-if="attachments.length"
        :attachments="attachments"
        @remove="removeAttachment"
        @retry="retryAttachment"
      />

      <!-- 底部输入栏：默认语音、键盘文本、发送和生成中状态 -->
      <view
        class="input-bar"
        :class="{ 'input-bar--text': inputMode === 'text' }"
      >
        <!-- 左侧语音/键盘切换常驻：生成回答时也不隐藏，否则发送后入口会消失 -->
        <view
          class="input-bar__mode"
          :class="{ 'input-bar__mode--disabled': state._gesture.active || state._isRecognizing }"
          @tap="onToggleInputMode"
        >
          <image
            v-if="inputMode === 'voice'"
            src="@/assets/img/icon-keyboard.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-voice.svg" mode="aspectFit" />
        </view>

        <view
          v-if="inputMode === 'voice'"
          class="input-bar__voice-pill"
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
            :value="draft"
            :style="{ height: textTextareaHeight }"
            placeholder="发消息"
            :auto-height="false"
            :adjust-position="false"
            :cursor-spacing="16"
            :maxlength="-1"
            confirm-type="send"
            placeholder-class="input-bar__placeholder"
            @input="onDraftInput"
            @confirm="onTrySend"
            @focus="onTextareaFocus"
            @blur="onTextareaBlur"
          />
        </view>

        <view
          class="input-bar__plus"
          :class="{ 'input-bar__plus--disabled': isLoading }"
          @tap="onOpenAttachmentPicker"
        >
          <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
        </view>

        <!-- 生成中固定为停止按钮，其余时刻是发送按钮：有内容才高亮可点 -->
        <view v-if="isLoading" class="input-bar__stop" @tap="emit('stop')">
          <image src="@/assets/img/icon-stop.svg" mode="aspectFit" />
        </view>
        <view
          v-else
          class="input-bar__send"
          :class="{ 'input-bar__send--disabled': !canSend }"
          @tap="onTrySend"
        >
          <image src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>

      <!-- 输入单元下提示（Figma: 41116:6071）。键盘弹起时收起，只留一条窄间距 -->
      <view v-if="!keyboardOpen" class="chat-input__footer">
        <text class="chat-input__footer-text">
          内容由AI生成，请核实重要信息
        </text>
      </view>
      <view v-else class="chat-input__keyboard-gap" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.chat-input {
  background: transparent;
  // 底部安全区：home indicator / 手势条区域不放内容
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  position: relative;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

.voice-sheet {
  position: fixed;
  z-index: 1300;
  right: 0;
  bottom: 0;
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

// 重录进行中：按钮给个按住反馈，面板本身保持不动
.voice-actions__btn--recording {
  opacity: 0.6;
}

.input-bar {
  display: flex;
  align-items: center;
  gap: 20rpx; // 10px
  min-height: 128rpx; // 64px
  padding: 0 40rpx; // 20px
  box-sizing: border-box;
}

.input-bar__mode {
  width: 56rpx; // 28px
  height: 56rpx;
  flex: 0 0 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__mode--disabled {
  opacity: 0.4;
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

// 没内容时保持占位但不高亮，避免发送按钮出现/消失导致输入栏跳动
.input-bar__send--disabled,
.input-bar__plus--disabled {
  opacity: 0.35;
}

.input-bar__mode:active,
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

.chat-input__dock {
  position: relative;
  // 必须高于收键盘遮罩，否则键盘弹起后点输入栏会被遮罩吃掉
  z-index: 1250;
  will-change: transform;
}

// 透明层，只负责接住「点空白收键盘」，底边贴着键盘顶沿。
// 用 touchstart + preventDefault：走 tap 的话遮罩在 touchend 时就被移除了，
// webview 随后补发的 click 会落到下面刚归位的加号按钮上，凭空弹出附件面板。
.chat-input__keyboard-mask {
  position: fixed;
  z-index: 1200;
  top: 0;
  right: 0;
  left: 0;
  background: transparent;
}

.chat-input__keyboard-gap {
  // 键盘顶边与输入栏之间的呼吸位
  height: 16rpx;
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
  margin-bottom: 12px;
}

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}
</style>

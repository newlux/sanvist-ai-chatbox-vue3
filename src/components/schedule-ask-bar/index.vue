<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import { ensureNativePermission, permissionDeniedMessage } from "@/utils/platform/mpaas";
import { createLogger } from "@/utils/logger";
import VoiceRecorder from "@/utils/voiceRecorder.js";

/**
 * 横屏甘特图右下角的输入条。三张稿子：
 *
 * - **6694:82（空态）**：240×38 胶囊，白底 + `#E6E6E6` 描边、圆角 14、阴影 `0 3px 5px -1px rgba(0,0,0,.086)`；
 *   占位文案「请输入你的问题」12px Italic `#999999`，**右侧灰色麦克风**（图标 12×14.7，`#6B6B6B`）；
 * - **4704:261（语音态）**：中间 9 颗 4px 红色圆点声纹（`#C8201E`，透明度 0.8→0.02 渐隐），
 *   右侧红色麦克风（`#C8201E`，即按住的那颗），占位文案隐藏；
 * - **4704:235（有内容态）**：正文 12px Italic `#1A1A1A`，右侧 22×22 红色圆形发送按钮（白箭头）。
 *
 * 右侧是同一个按钮位：空态 = 灰色麦克风（按住说话）、语音态 = 红色麦克风、有内容 = 发送按钮。
 *
 * 另外稿子 6694:101 是胶囊右侧那颗独立的键盘图标（17.1×10、`#6B6B6B`），
 * 按需求做「输入框显隐开关」：点它收起 / 展开输入胶囊。
 *
 * 语音识别沿用项目既有链路（VoiceRecorder + /speech/asr/*），识别结果直接落到输入框里，
 * 再由发送按钮交给页面（页面负责收起横屏、回对话页并发送）。
 */
defineOptions({ name: "ScheduleAskBar" });

const emit = defineEmits<{ (e: "send", text: string): void }>();

const logger = createLogger("schedule-ask");
const { t } = useI18n();

const ASR_TIMEOUT_MS = 30_000;

/** 录音器（VoiceRecorder 是 JS 文件，这里按实际用到的接口描述一下） */
interface RecorderResult {
  success?: boolean;
  cancelled?: boolean;
  error?: string;
  data?: { tempFilePath?: string; audioUrl?: string; audioBase64?: string; mimeType?: string };
}

interface RecorderLike {
  start: (options?: { sampleRate?: number; timeSlice?: number }) => Promise<RecorderResult>;
  stop: () => Promise<RecorderResult>;
  cancel: () => void;
}

/** 松手到识别结束之间不再接受新的按压，避免并发录音 */
const recording = ref(false);
const recognizing = ref(false);
/** 输入框是否显示：由右侧键盘图标控制（需求：键盘图标控制输入框显隐） */
const visible = ref(true);
const draft = ref("");
/** 键盘高度：旋转页里键盘盖住的是「横屏的右侧」，抬升要沿本地 X 轴反向平移 */
const keyboardHeight = ref(0);

const canSend = computed(() => Boolean(draft.value.trim()) && !recording.value && !recognizing.value);
/** 声纹圆点透明度：稿子里 0.8 起、向两侧递减 */
const waveDots = [0.8, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1, 0.05, 0.02];

/**
 * 键盘避让只作用在**输入胶囊**上：输入框显隐会开 / 收软键盘，
 * 若把整条（含键盘按钮）一起平移，键盘按钮的位置就会跟着跳；
 * 按钮固定在原处不动，抬升的只有胶囊。
 */
const pillStyle = computed(() => (
  keyboardHeight.value > 0 ? { transform: `translateX(${-keyboardHeight.value}px)` } : {}
));

let recorder: RecorderLike | null = null;
/** 录音器是否真的开始录了（权限申请/启动都可能是异步的） */
let recordStarted = false;
/** 录音会话序号：松手/取消后旧回调一律作废 */
let jobSeq = 0;

function toast(title: string) {
  if (title) uni.showToast({ title, icon: "none", duration: 3000 });
}

function ensureRecorder(): RecorderLike {
  if (!recorder) recorder = new VoiceRecorder() as unknown as RecorderLike;
  return recorder;
}

/** 上传接口的 timeout 在个别容器里不生效，这里再包一层兜底 */
function withTimeout<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(t("speech-recognize-timeout"))), ASR_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorText(error: unknown, fallback: string) {
  const raw = error instanceof Error
    ? error.message
    : (error && typeof error === "object"
      && ((error as { message?: string }).message || (error as { errMsg?: string }).errMsg))
    || String(error || fallback);
  return String(raw || fallback).replace(/^Error:\s*/, "").slice(0, 28) || fallback;
}

function onInput(event: InputEvent | { detail: { value: string } }) {
  const detail = (event as { detail?: { value?: string } })?.detail;
  draft.value = String(detail?.value ?? "");
}

/** 发送：文本交给页面（页面会收起横屏、回对话页并把它发出去） */
function onSubmit() {
  const text = draft.value.trim();
  if (!text || recording.value || recognizing.value) return;
  draft.value = "";
  uni.hideKeyboard();
  emit("send", text);
}

const inputRef = ref<{ focus?: () => void } | null>(null);

function toggleVisible() {
  visible.value = !visible.value;
  uni.hideKeyboard();
  if (!visible.value) {
    draft.value = "";
    return;
  }
  // 展开后直接聚焦：点键盘图标就是要打字
  nextTick(() => inputRef.value?.focus?.());
}

/* ---------------- 语音输入（按住说话 → 松手识别 → 文本落到输入框） ---------------- */

async function startRecording() {
  if (recording.value || recognizing.value) return;
  const job = ++jobSeq;
  recording.value = true;
  recordStarted = false;
  uni.hideKeyboard();

  try {
    const granted = await ensureNativePermission("record_audio");
    if (job !== jobSeq) return;
    if (!granted) {
      recording.value = false;
      toast(permissionDeniedMessage("record_audio"));
      return;
    }
    const started = await ensureRecorder().start({ sampleRate: 16000, timeSlice: 1000 });
    if (job !== jobSeq) return;
    if (started?.success) {
      recordStarted = true;
    }
    else {
      recording.value = false;
      if (!started?.cancelled) toast(started?.error || t("record-start-failed"));
    }
  }
  catch (error) {
    logger.error("start recorder failed", error);
    recording.value = false;
    toast(errorText(error, t("record-start-failed")));
  }
}

async function stopRecordingAndRecognize() {
  if (!recording.value) return;
  const job = ++jobSeq;
  recording.value = false;

  // 权限还没拿到 / 录音器还在启动中就松手了：按取消处理，不报错也不去识别
  if (!recordStarted) {
    recorder?.cancel?.();
    return;
  }
  recordStarted = false;
  recognizing.value = true;

  try {
    const result = await ensureRecorder().stop();
    if (job !== jobSeq) return;
    if (!result?.success) {
      if (!result?.cancelled) toast(result?.error || t("record-failed"));
      return;
    }

    const { tempFilePath, audioUrl, audioBase64, mimeType } = result.data || {};
    if (!tempFilePath && !audioUrl && !audioBase64) {
      toast(t("no-audio-recorded"));
      return;
    }

    const response = await withTimeout(
      audioUrl
        ? recognizeSpeechByUrl({ audioUrl })
        : audioBase64
          ? recognizeSpeechByBase64({ audioBase64, mimeType })
          : recognizeSpeechByUpload({ filePath: tempFilePath || "", timeout: ASR_TIMEOUT_MS }),
    );
    if (job !== jobSeq) return;

    const text = String(response?.text || "").trim();
    if (!text) {
      toast(t("no-speech-recognized"));
      return;
    }
    // 识别结果进输入框（有内容后输入栏右侧就变成发送按钮）
    draft.value = `${draft.value}${text}`;
  }
  catch (error) {
    logger.error("speech recognize failed", error);
    if (job === jobSeq) toast(errorText(error, t("record-failed")));
  }
  finally {
    if (job === jobSeq) recognizing.value = false;
  }
}

const onMicStart = () => {
  void startRecording();
};

const onMicEnd = () => {
  void stopRecordingAndRecognize();
};

/**
 * 松手 / 取消的兜底：录音时右侧红麦克风是另一个 DOM 节点，
 * 手指原本按的那个元素可能已经不在原位，所以挂到 window 上收尾。
 */
function bindWindowEnd() {
  if (typeof window === "undefined") return;
  window.addEventListener("touchend", onMicEnd);
  window.addEventListener("touchcancel", onMicEnd);
}

function unbindWindowEnd() {
  if (typeof window === "undefined") return;
  window.removeEventListener("touchend", onMicEnd);
  window.removeEventListener("touchcancel", onMicEnd);
}

/** 键盘高度变化时把输入条抬到键盘上方（旋转页里对应本地 -X） */
let keyboardWatcher: ((res: { height: number }) => void) | null = null;

onMounted(() => {
  bindWindowEnd();
  keyboardWatcher = (res: { height: number }) => {
    keyboardHeight.value = Math.max(0, Number(res?.height) || 0);
  };
  uni.onKeyboardHeightChange?.(keyboardWatcher);
});

onBeforeUnmount(() => {
  unbindWindowEnd();
  if (keyboardWatcher) uni.offKeyboardHeightChange?.(keyboardWatcher);
  jobSeq += 1;
  recorder?.cancel?.();
});
</script>

<template>
  <view class="schedule-ask">
    <!-- 输入胶囊：稿子 6694:279（空态）/ 4704:234（有内容）/ 4704:260（语音态）。
         收起态只是隐藏（保留占位），键盘按钮的位置才不会跟着跳 -->
    <view
      class="schedule-ask__pill"
      :class="{ 'schedule-ask__pill--hidden': !visible }"
      :style="pillStyle"
    >
      <!-- 语音态：中间 9 颗声纹圆点（稿子 4704:279） -->
      <view v-if="recording" class="schedule-ask__wave" aria-hidden="true">
        <view
          v-for="(dot, index) in waveDots"
          :key="index"
          class="schedule-ask__dot"
          :style="{ opacity: dot, animationDelay: `${index * 60}ms` }"
        />
      </view>
      <text v-else-if="recognizing" class="schedule-ask__hint">
        识别中...
      </text>
      <input
        v-else
        ref="inputRef"
        class="schedule-ask__input"
        :value="draft"
        :maxlength="-1"
        placeholder="请输入你的问题"
        placeholder-class="schedule-ask__placeholder"
        :adjust-position="false"
        :cursor-spacing="0"
        :hold-keyboard="true"
        confirm-type="send"
        @input="onInput"
        @confirm="onSubmit"
      >

      <!-- 右侧按钮位：语音态是红色麦克风（手指还按着，松手结束） -->
      <view v-if="recording" class="schedule-ask__mic">
        <image src="@/assets/img/icon-mic-red.svg" mode="aspectFit" />
      </view>
      <!-- 有内容：红色圆形发送按钮（稿子 4704:234） -->
      <view v-else-if="canSend" class="schedule-ask__send" @tap="onSubmit">
        <image src="@/assets/img/icon-send.svg" mode="aspectFit" />
      </view>
      <!-- 空态：灰色麦克风，按住说话（稿子 6694:281，放在胶囊右侧） -->
      <view
        v-else
        class="schedule-ask__mic"
        @touchstart.stop.prevent="onMicStart"
        @touchend.stop.prevent="onMicEnd"
        @touchcancel.stop.prevent="onMicEnd"
      >
        <image src="@/assets/img/icon-voice.svg" mode="aspectFit" />
      </view>
    </view>

    <!-- 右侧键盘图标：控制输入框显隐（稿子 6694:101） -->
    <view class="schedule-ask__keyboard" @tap="toggleVisible">
      <image src="@/assets/img/icon-keyboard.svg" mode="aspectFit" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.schedule-ask {
  position: absolute;
  /* 让开右侧那一列行内箭头（.schedule__scroll-btn--next：right 8px + 28 宽，占 8–36px），
     键盘按钮不再压在箭头上，收起 / 展开都停在这一处不移动 */
  right: 40px;
  bottom: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  /* 收起后胶囊留下的空位不要挡住下面的时间轴，只有胶囊和键盘按钮收手势 */
  pointer-events: none;

  uni-image {
    width: 100%;
    height: 100%;
  }
}

/* 输入胶囊：240×38、圆角 14、白底 + #E6E6E6 描边 + 阴影（稿子 6694:289） */
.schedule-ask__pill {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: 240px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid #e6e6e6;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.086);
  pointer-events: auto;
  /* 键盘避让的平移只作用在胶囊上（键盘按钮不跟着动） */
  transition: transform 0.16s ease-out;
}

/* 收起态：只隐藏、不移除（保留 240×38 占位），键盘按钮位置因此保持不变 */
.schedule-ask__pill--hidden {
  visibility: hidden;
  pointer-events: none;
}

/* 麦克风：20×20 图标框（稿子里图形 11.9×14.7、色 #6B6B6B） */
.schedule-ask__mic {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.schedule-ask__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  font-size: 12px;
  font-style: italic;
  color: #1a1a1a;

  /* uni-app H5 把 class 留在外层，内层 input 用 :deep 兜住 */
  :deep(input) {
    font-size: 12px;
    font-style: italic;
    color: #1a1a1a;
  }

  :deep(input::placeholder) {
    font-size: 12px;
    font-style: italic;
    color: #999999;
  }
}

.schedule-ask__placeholder {
  font-size: 12px;
  font-style: italic;
  color: #999999;
}

/* 识别中提示（稿子里没有这个态，沿用占位的灰字） */
.schedule-ask__hint {
  flex: 1 1 auto;
  font-size: 12px;
  font-style: italic;
  color: #999999;
}

/* 语音态声纹：9 颗 4px 圆点、间距 3px、色 #C8201E（稿子 4704:279） */
.schedule-ask__wave {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  flex: 1 1 auto;
}

.schedule-ask__dot {
  flex: 0 0 auto;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #c8201e;
  transform-origin: center;
  animation: schedule-ask-dot 0.72s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

@keyframes schedule-ask-dot {
  0%,
  100% {
    transform: scaleY(0.9) scaleX(0.9);
  }

  50% {
    transform: scaleY(2.1) scaleX(1.15);
  }
}

/* 发送按钮：22×22 红色实心圆 + 白箭头（稿子 4704:234） */
.schedule-ask__send {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;

  &:active {
    opacity: 0.8;
  }
}

/* 键盘图标：17.1×10 图形，外面给 28×28 触达区（稿子 6694:101） */
.schedule-ask__keyboard {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  pointer-events: auto;

  image {
    width: 20px;
    height: 20px;
  }

  &:active {
    opacity: 0.7;
  }
}
</style>

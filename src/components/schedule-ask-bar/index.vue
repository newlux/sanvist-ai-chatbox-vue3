<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl } from "@/api/chat";
import { isAsrServiceFailure } from "@/utils/asr-error";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission, permissionDeniedMessage } from "@/utils/platform/mpaas";
import VoiceRecorder from "@/utils/voiceRecorder.js";

/**
 * 横屏甘特图右下角的输入条。三张稿子：
 *
 * - **6694:82（空态）**：240×38 胶囊，白底 + `#E6E6E6` 描边、圆角 14、阴影 `0 3px 5px -1px rgba(0,0,0,.086)`；
 *   占位文案「请输入你的问题」12px `#999999`（稿子是斜体，按需求不加倾斜），
 *   **右侧语音入口图标**（与对话页输入栏同一张 `icon-voice-wave-dark.svg`，20×20，按住说话）；
 * - **4704:261（语音态）**：中间 9 颗 4px 红色圆点声纹（`#C8201E`，透明度 0.8→0.02 渐隐），
 *   右侧红色麦克风（`#C8201E`，即按住的那颗），占位文案隐藏；
 * - **4704:235（有内容态）**：正文 12px Italic `#1A1A1A`，右侧 22×22 发送按钮
 *   （与对话页同一张 `icon-send-up.svg`：黑圆 + 白上箭头，圆形底由切图自带）。
 *
 * 右侧是同一个按钮位：空态 = 语音入口图标（按住说话）、语音态 = 红色麦克风、有内容 = 发送按钮。
 *
 * 另外稿子 6694:98 / 6694:109 是胶囊右侧那颗独立的键盘按钮：34×34 白底圆形 +
 * `#C8201E` 描边 + 阴影（`0 3px 5px -1px rgba(0,0,0,.086)`），内部 20×20 键盘图形（`#6B6B6B`）；
 * 按需求做「输入框显隐开关」：点它收起 / 展开输入胶囊。
 *
 * 语音识别沿用项目既有链路（VoiceRecorder + /speech/asr/*），识别出文本后**直接作为问题发出**，
 * 由页面负责收起横屏、回对话页并发送；打字则用发送按钮交给页面。
 */
defineOptions({ name: "ScheduleAskBar" });

const props = withDefaults(defineProps<{
  /** 深色模式：与调度视图（pages/schedule / schedule-pre / schedule-gantt）的底板同步 */
  dark?: boolean;
  /**
   * 页面是否走了 CSS 旋转模拟横屏：
   * - true：键盘盖住的是「横屏的右侧」→ 胶囊沿本地 X 轴平移；
   * - false：竖屏 / 原生横屏 → 键盘从底部升起 → 整条输入条上移。
   */
  rotated?: boolean;
}>(), {
  dark: false,
  rotated: false,
});

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
/**
 * 键盘高度（CSS px）。
 * - 旋转页（rotated=true，设备竖着拿、页面 CSS 转了 90°）：键盘盖住的是本地右侧，抬升沿本地 X；
 * - 竖屏 / 原生横屏（rotated=false）：键盘从底部升起，整条输入条整体上移同样的高度。
 */
const keyboardHeight = ref(0);

/** 低于这个高度不算键盘：地址栏收缩、工具条变化也会让可视视口变矮 */
const MIN_KEYBOARD_HEIGHT_PX = 80;
/** 收起延迟：盖过键盘动画中途插进来的那一帧 0 */
const KEYBOARD_COLLAPSE_DELAY_MS = 160;

/** 页面不随键盘压缩时，被盖住的高度只能靠可视视口反推，这里记一个基准高度 */
let baseViewportHeight = 0;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
/** uni.onKeyboardHeightChange 报的高度（小程序端 / 部分容器），与视口反推取大 */
let uniKeyboardHeight = 0;

const canSend = computed(() => Boolean(draft.value.trim()) && !recording.value && !recognizing.value);
/** 声纹圆点透明度：稿子里 0.8 起、向两侧递减 */
const waveDots = [0.8, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1, 0.05, 0.02];

/**
 * 旋转页（CSS 转了 90°）里键盘避让只作用在**输入胶囊**上：输入框显隐会开 / 收软键盘，
 * 若把整条（含键盘按钮）一起平移，键盘按钮的位置就会跟着跳；按钮固定在原处不动。
 *
 * 收起 / 展开用 scale 0 → 1 的缩放（配合 opacity）：布局占位仍是 240×38，
 * 所以键盘按钮不会跟着跳；transform 只能走内联样式（键盘避让的位移也在这里），
 * CSS 里的 transform 会被它覆盖，缩放才会写在这一处。
 */
const pillStyle = computed(() => {
  const shift = props.rotated && keyboardHeight.value > 0 ? -keyboardHeight.value : 0;
  const scale = visible.value ? 1 : 0;
  return { transform: `translateX(${shift}px) scale(${scale})` };
});

/**
 * 竖屏 / 原生横屏：键盘从屏幕底部升起，整条输入条（胶囊 + 键盘按钮）一起抬到键盘上方。
 * 走 bottom 而不是 transform：胶囊的 transform 要留给展开缩放与旋转页的位移。
 * 底边留 12px，和 CSS 里的 bottom: 12px 是同一个间距。
 */
const rootStyle = computed(() => {
  const lift = !props.rotated && keyboardHeight.value > 0 ? keyboardHeight.value : 0;
  return lift > 0 ? { bottom: `${12 + lift}px` } : undefined;
});

/** 输入条根节点：直接量和可视视口的重叠，比按视口高度猜更准（见 readCoveredByRect） */
const rootRef = ref<unknown>(null);

function readElement(target: unknown): HTMLElement | null {
  const candidate = (target as { $el?: unknown })?.$el ?? target;
  return candidate && typeof (candidate as HTMLElement).getBoundingClientRect === "function"
    ? candidate as HTMLElement
    : null;
}

/**
 * 输入条被键盘盖住多少（CSS px），量不到返回 null。
 *
 * 为什么不直接按「视口缩了多少」算：Android 键盘会 resize 布局视口（页面自己就缩了、
 * 不用再抬），iOS / WebView 则是覆盖式（页面不动、必须抬），两种用同一个公式必错一个。
 * 改成量「根节点底边」和「可视视口底边」的差距：页面已经缩好的情况自然算出 ≤0，无需抬。
 */
function readCoveredByRect(): number | null {
  if (typeof window === "undefined") return null;
  const el = readElement(rootRef.value);
  if (!el) return null;
  const viewport = window.visualViewport;
  const visibleBottom = viewport
    ? viewport.height + viewport.offsetTop
    : Number(window.innerHeight) || 0;
  if (visibleBottom <= 0) return null;
  // 量到的是「已经抬起过」的位置，先把抬升量加回去还原成未抬起的底边，
  // 否则每量一次都会算出「已经不用抬」，输入条一抬上去又掉回来
  const unshiftedBottom = el.getBoundingClientRect().bottom + keyboardHeight.value;
  const lift = Math.ceil(unshiftedBottom + 12 - visibleBottom);
  // 抬起后底边离键盘留 12px，与设计稿的 bottom 间距一致
  return lift > 0 ? lift : 0;
}

/** 页面本身不随键盘压缩时，被键盘盖住的高度只能靠可视视口反推（量不到节点时的兜底） */
function readViewportKeyboardHeight(): number {
  if (typeof window === "undefined") return 0;
  const viewport = window.visualViewport;
  if (!viewport) {
    const shrunk = baseViewportHeight - (Number(window.innerHeight) || 0);
    return shrunk > MIN_KEYBOARD_HEIGHT_PX ? Math.round(shrunk) : 0;
  }
  const layoutHeight = Math.max(Number(window.innerHeight) || 0, baseViewportHeight);
  const occluded = layoutHeight - viewport.height - viewport.offsetTop;
  if (occluded > MIN_KEYBOARD_HEIGHT_PX) return Math.round(occluded);
  baseViewportHeight = Math.max(baseViewportHeight, viewport.height);
  return 0;
}

/** 当前该抬多少：旋转页按键盘高度，其余优先量节点与可视视口的重叠 */
function measureKeyboardLift(): number {
  if (props.rotated) return Math.max(readViewportKeyboardHeight(), uniKeyboardHeight);
  const byRect = readCoveredByRect();
  if (byRect !== null) return byRect;
  return Math.max(readViewportKeyboardHeight(), uniKeyboardHeight);
}

/** 键盘弹出时浏览器会滚一段布局视口去露输入框，这里拉回原点，否则整页跟着漂 */
function pinViewport() {
  if (typeof window === "undefined") return;
  if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
}

function applyKeyboardHeight(next: number) {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (next > 0) {
    if (Math.abs(next - keyboardHeight.value) >= 4) keyboardHeight.value = next;
    return;
  }
  if (keyboardHeight.value === 0) return;
  // 键盘收起动画中途会给到 0，延后一拍再确认，避免输入条先掉下去再弹回来
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    keyboardHeight.value = measureKeyboardLift();
  }, KEYBOARD_COLLAPSE_DELAY_MS);
}

function syncKeyboardHeight() {
  const next = measureKeyboardLift();
  if (next > 0) pinViewport();
  applyKeyboardHeight(next);
}

/** 主动收键盘（发送 / 收起输入框 / 转语音）：容器不一定补发 blur，这里立刻把抬升收回来 */
function dismissKeyboard() {
  uni.hideKeyboard?.();
  uniKeyboardHeight = 0;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  keyboardHeight.value = 0;
}

function onInputFocus() {
  pinViewport();
  // 部分 WebView 键盘弹出不触发 resize，补两拍再量一次
  setTimeout(syncKeyboardHeight, 120);
  setTimeout(syncKeyboardHeight, 360);
}

function onInputBlur() {
  // 失焦：另一路（uni）报的高度不再可信，重新按视口收敛
  uniKeyboardHeight = 0;
  setTimeout(syncKeyboardHeight, 60);
}

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
  // ASR 服务侧失败统一提示，不把后端原始 message（code=500 系统繁忙）弹给用户
  if (isAsrServiceFailure(error)) return t("asr-no-content-retry");
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
  dismissKeyboard();
  emit("send", text);
}

const inputRef = ref<{ focus?: () => void } | null>(null);
/** 展开动画跑完再聚焦：软键盘一弹出就会触发键盘避让位移，会把 0 → 1 的缩放打断 */
let focusTimer: ReturnType<typeof setTimeout> | null = null;

function toggleVisible() {
  visible.value = !visible.value;
  dismissKeyboard();
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  if (!visible.value) {
    draft.value = "";
    return;
  }
  // 展开后聚焦（点键盘图标就是要打字），等过渡结束再弹键盘
  focusTimer = setTimeout(() => {
    focusTimer = null;
    inputRef.value?.focus?.();
  }, 220);
}

/* ---------------- 语音输入（按住说话 → 松手识别 → 文本落到输入框） ---------------- */

async function startRecording() {
  if (recording.value || recognizing.value) return;
  const job = ++jobSeq;
  recording.value = true;
  recordStarted = false;
  dismissKeyboard();

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
    // 语音问完直接当问题发出去：合并已有草稿 → 交给页面（返回对话页并发送），
    // 不再要求用户再看一眼、再点一次发送按钮。
    const question = `${draft.value}${text}`.trim();
    draft.value = "";
    dismissKeyboard();
    emit("send", question);
  }
  catch (error) {
    logger.error("speech recognize failed", error);
    if (job === jobSeq) toast(errorText(error, t("record-failed")));
  }
  finally {
    if (job === jobSeq) recognizing.value = false;
  }
}

function onMicStart() {
  void startRecording();
}

function onMicEnd() {
  void stopRecordingAndRecognize();
}

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

/** 键盘高度变化时把输入条抬到键盘上方（旋转页里对应本地 -X，其余走 -Y） */
let keyboardWatcher: ((res: { height: number }) => void) | null = null;

onMounted(() => {
  bindWindowEnd();
  if (typeof window !== "undefined") {
    baseViewportHeight = Number(window.visualViewport?.height) || Number(window.innerHeight) || 0;
    // H5 / WebView 里 uni.onKeyboardHeightChange 多半不触发，可视视口变化是更通用的一路
    window.addEventListener("resize", syncKeyboardHeight);
    window.visualViewport?.addEventListener("resize", syncKeyboardHeight);
    window.visualViewport?.addEventListener("scroll", syncKeyboardHeight);
  }
  keyboardWatcher = (res: { height: number }) => {
    uniKeyboardHeight = Math.max(0, Number(res?.height) || 0);
    syncKeyboardHeight();
  };
  uni.onKeyboardHeightChange?.(keyboardWatcher);
});

onBeforeUnmount(() => {
  unbindWindowEnd();
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", syncKeyboardHeight);
    window.visualViewport?.removeEventListener("resize", syncKeyboardHeight);
    window.visualViewport?.removeEventListener("scroll", syncKeyboardHeight);
  }
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (keyboardWatcher) uni.offKeyboardHeightChange?.(keyboardWatcher);
  if (focusTimer) {
    clearTimeout(focusTimer);
    focusTimer = null;
  }
  jobSeq += 1;
  recorder?.cancel?.();
});
</script>

<template>
  <!-- rootStyle：竖屏 / 原生横屏下由键盘高度抬起来的 bottom（旋转页留空，走胶囊的 translateX） -->
  <view
    ref="rootRef"
    class="schedule-ask"
    :class="{ 'schedule-ask--dark': dark }"
    :style="rootStyle"
  >
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
        @focus="onInputFocus"
        @blur="onInputBlur"
        @confirm="onSubmit"
      >

      <!-- 右侧按钮位：语音态是红色麦克风（手指还按着，松手结束） -->
      <view v-if="recording" class="schedule-ask__mic">
        <image src="@/assets/img/icon-mic-red.svg" mode="aspectFit" />
      </view>
      <!-- 有内容：发送按钮，图标与对话页输入栏同一张（icon-send-up：黑圆 + 白上箭头） -->
      <view v-else-if="canSend" class="schedule-ask__send" @tap="onSubmit">
        <image src="@/assets/img/icon-send-up.svg" mode="aspectFit" />
      </view>
      <!-- 空态：语音输入，按住说话；图标与对话页输入栏的语音入口同一张（icon-voice-wave-dark，20×20） -->
      <view
        v-else
        class="schedule-ask__mic"
        @touchstart.stop.prevent="onMicStart"
        @touchend.stop.prevent="onMicEnd"
        @touchcancel.stop.prevent="onMicEnd"
      >
        <image src="@/assets/img/icon-voice-wave-dark.svg" mode="aspectFit" />
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
  /* 显隐：从键盘按钮那一侧（右缘）缩放展开，位移与缩放都写在内联 transform 上 */
  transform-origin: right center;
  transition: transform 0.2s ease-out, opacity 0.2s ease-out;
  will-change: transform, opacity;
}

/* 收起态：只隐藏、不移除（保留 240×38 占位），键盘按钮位置因此保持不变。
   不加 visibility，否则 opacity / scale 的过渡会被瞬间截断 */
.schedule-ask__pill--hidden {
  opacity: 0;
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
  color: #1a1a1a;

  /* uni-app H5 把 class 留在外层，内层 input 用 :deep 兜住 */
  :deep(input) {
    font-size: 12px;
    color: #1a1a1a;
  }

  :deep(input::placeholder) {
    font-size: 12px;
    color: #999999;
  }
}

/* 占位文案：稿子是斜体，按需求取消倾斜，字号 / 颜色沿用 */
.schedule-ask__placeholder {
  font-size: 12px;
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

/* 发送按钮：22×22，图标换成与对话页一致的 icon-send-up（黑圆 + 白上箭头，自带实心圆底） */
.schedule-ask__send {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;

  &:active {
    opacity: 0.8;
  }
}

/* 键盘按钮（稿子 1522:665 外圈 / 1522:662 键盘图形）：34×34 圆形、白底 +
   1px #1166D6 描边（original INSIDE，border-box 的 border 正好画在内侧）+ 阴影 0 3px 5px -1px rgba(0,0,0,.086)；
   内部 20×20 键盘图形，控制输入框显隐 */
.schedule-ask__keyboard {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 34px;
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  border: 1px solid #1166d6;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.086);
  pointer-events: auto;

  image {
    width: 20px;
    height: 20px;
  }

  &:active {
    opacity: 0.7;
  }
}

/* ===== 深色主题：右下角输入条 =====
   与调度视图底板一致（页 #0D0D0D、控件 #1A1A1A + 1px #303030），
   尺寸 / 圆角 / 阴影 / 麦克风与发送按钮的红色一律不动：
   - 输入胶囊：白底 → #1A1A1A，描边 #E6E6E6 → #303030，正文 #1A1A1A → 80% 白，占位 #999 → #6B6B6B；
   - 键盘按钮：白底 → #1A1A1A，品牌蓝描边保留；图标是深色线条，反相成白。 */
.schedule-ask--dark {
  .schedule-ask__pill {
    border-color: #303030;
    background: #1a1a1a;
  }

  .schedule-ask__input {
    color: rgb(255 255 255 / 80%);

    :deep(input) {
      color: rgb(255 255 255 / 80%);
    }

    :deep(input::placeholder) {
      color: #6b6b6b;
    }
  }

  .schedule-ask__placeholder,
  .schedule-ask__hint {
    color: #6b6b6b;
  }

  .schedule-ask__keyboard {
    background: #1a1a1a;

    image {
      filter: invert(1);
    }
  }

  // 语音入口图标本体是 #0D0D0D，深底上要反相
  .schedule-ask__mic image {
    filter: invert(1);
  }
}
</style>

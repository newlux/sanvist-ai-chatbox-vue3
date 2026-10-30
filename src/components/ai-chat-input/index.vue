<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AiAttachmentPicker from "@/components/ai-attachment-picker/index.vue";
import AiChatAttachments from "@/components/ai-chat-attachments/index.vue";
import { useComposerAttachments } from "@/hooks/useComposerAttachments";
import { usePressDelay } from "@/hooks/usePressDelay";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { createLogger } from "@/utils/logger";
import { getMicrophoneVolume } from "@/utils/platform/mpaas";

const logger = createLogger("chat-input");

const props = defineProps({
  modelValue: { type: String, default: "" },
  isLoading: { type: Boolean, default: false },
  /** 键盘高度(px)。 */
  keyboardHeight: { type: Number, default: 0 },
  /** 语音识别结果编辑时的键盘高度。 */
  voiceKeyboardHeight: { type: Number, default: 0 },
  /** 是否禁用上传附件入口。 */
  attachmentDisabled: { type: Boolean, default: false },
  /**
   * 录音监听态改用「底部小面板」样式（听播页用）：
   * 只占底部一小块，不整屏遮罩，页面主体保持可见。
   */
  compactVoiceListening: { type: Boolean, default: false },
  /**
   * 语音播报（TTS）进行中：底部换成「请选择你的身份吧」页同一套三色带波纹。
   * 播报期间常态那条淡蓝波浪让位，避免两种底纹叠在一起。
   */
  speaking: { type: Boolean, default: false },
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
  "voice-input-focus",
  "voice-input-blur",
  "dock-height-change",
  "recognize-begin",
  "recognize-fail",
  "voice-panel-open",
]);

const { t } = useI18n();

/**
 * 输入框的本地副本。父组件清空 v-model 是异步的（发送链路里还要过一次 store），
 * 这里保留一份本地值，发送时立即置空，保证输入框肉眼可见地被清干净。
 */
const draft = ref(String(props.modelValue || ""));
watch(
  () => props.modelValue,
  (value) => {
    const next = String(value || "");
    if (next !== draft.value) draft.value = next;
  },
);

const textTextareaHeight = computed(() => {
  const maxCharsPerLine = 15;
  const lineCount = String(draft.value || "")
    .split("\n")
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / maxCharsPerLine)), 0);
  return `${Math.min(Math.max(lineCount, 1), 4) * 40}rpx`;
});

const {
  attachments,
  hasIncompleteAttachments,
  hasFailedAttachments,
  openAttachmentPicker,
  isNativePickerAvailable,
  chooseImages,
  chooseFilesFromNative,
  removeAttachment,
  retryAttachment,
  takeUploadedFiles,
  appendUploadedAttachments,
} = useComposerAttachments();

/**
 * 输入文字或添加附件后都进入可发送状态；上传未完成时点击发送会给出状态提示。
 */
const canSend = computed(() => Boolean(draft.value.trim() || attachments.value.length));
const showSendButton = computed(() => !props.isLoading && canSend.value);

/**
 * 录音态底部的 40 根声纹（设计稿 1291:1 Frame 114）：
 * 每根 2px 宽、间距 2px，高度逐根取自设计稿（px × 2 = rpx），中间高两端低。
 * 顺序与原节点一致，不做对称重排。
 */
const VOICE_WAVE_BARS = [
  5.6,
  20.5,
  15.6,
  11.2,
  6.7,
  20.5,
  8.9,
  11.2,
  8.9,
  11.2,
  20.5,
  4.5,
  4.5,
  20.5,
  26.8,
  8.9,
  20.5,
  4.5,
  4.5,
  4.5,
  20.5,
  4.5,
  20.5,
  4.5,
  20.5,
  4.5,
  4.5,
  20.5,
  8.9,
  8.9,
  8.9,
  20.5,
  33.5,
  13,
  24.2,
  5.6,
  5.6,
  20.5,
  15.6,
  26.8,
];

/**
 * 声纹动效参数：设计稿这 40 根是静态高度，这里只当「基线」，
 * 录音中由 JS 逐根算系数（见 tickBarScales），模板再乘回基线高度。
 *
 * - gain：这一根对音量的响应强度，0.85~1.34 伪随机打散，避免整排等幅；
 * - speed / phase：各自的抖动角速度与初相，频率错开后才像真实电平表，
 *   而不是整排一起呼吸。频率必须压在 1~3Hz：30fps 采样下，
 *   4~6Hz 的抖动只会被采成一片高频噪点，看起来就是「等幅乱颤」，
 *   声音大小完全读不出来。
 */
const VOICE_WAVE_BARS_MOTION = VOICE_WAVE_BARS.map((height, index) => ({
  height,
  gain: Number((0.85 + ((index * 37) % 50) / 100).toFixed(2)),
  /** rad/s：约 1.6~3.1Hz，说话时声纹上下「甩」得出来，又不至于抖成高频噪点 */
  speed: Number((10 + (index % 7) * 1.6).toFixed(1)),
  phase: Number((index * 0.73).toFixed(2)),
}));

const keyboardOpen = computed(() => props.keyboardHeight > 0);
const voiceKeyboardOpen = computed(() => props.voiceKeyboardHeight > 0);
const inputLiftStyle = computed(() => {
  const lift = Math.max(0, Number(props.keyboardHeight || props.voiceKeyboardHeight) || 0);
  return lift > 0 ? { bottom: `${lift}px` } : {};
});

const dockRef = ref<unknown>(null);
const voiceSheetRef = ref<unknown>(null);
let composerResizeObserver: ResizeObserver | null = null;

function readEl(raw: unknown): HTMLElement | null {
  if (!raw) return null;
  if (typeof HTMLElement !== "undefined" && raw instanceof HTMLElement) return raw;
  const el = (raw as { $el?: unknown }).$el;
  if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) return el;
  return null;
}

function measureComposerHeight() {
  const dock = readEl(dockRef.value);
  const sheet = readEl(voiceSheetRef.value);
  const height = Math.round(Math.max(dock?.offsetHeight || 0, sheet?.offsetHeight || 0));
  if (height > 0) emit("dock-height-change", height);
}

function observeComposer() {
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
  measureComposerHeight();
  if (typeof ResizeObserver === "undefined") return;
  const dock = readEl(dockRef.value);
  const sheet = readEl(voiceSheetRef.value);
  if (!dock && !sheet) return;
  composerResizeObserver = new ResizeObserver(() => measureComposerHeight());
  if (dock) composerResizeObserver.observe(dock);
  if (sheet) composerResizeObserver.observe(sheet);
}

/**
 * 收键盘后遮罩多留一会儿：键盘落下的过程中输入栏会跟着往下移动，
 * 遮罩要是立刻消失，这一次触摸的 tap 会落到刚好移过来的加号上，凭空弹出附件面板。
 */
const maskLingering = ref(false);
let maskLingerTimer = null;
const showKeyboardMask = computed(
  () => keyboardOpen.value || voiceKeyboardOpen.value || maskLingering.value,
);

/** 点击面板以外的区域收起键盘：识别结果编辑态下这是唯一的退出口 */
function onDismissKeyboard() {
  uni.hideKeyboard();
  emit("input-blur");
  if (voiceKeyboardOpen.value) emit("voice-input-blur");
  maskLingering.value = true;
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  maskLingerTimer = setTimeout(() => {
    maskLingerTimer = null;
    maskLingering.value = false;
  }, 400);
}

/** 遮罩上的 tap 只做拦截，避免透传到下面的按钮 */
function onMaskTap() {}

/**
 * 统一的发送出口（文本回车 / 发送按钮 / 语音识别结果确认）。
 * 必须有文字（或语音识别文本）才发送；附件仅作附带，随文字一起提交，
 * 随后立刻清空输入框与附件栏。
 */
function submitMessage(rawText?: string) {
  if (props.isLoading) return;
  const text = String(rawText ?? draft.value).trim();
  if (!text && !attachments.value.length) return;

  if (hasIncompleteAttachments.value) {
    uni.showToast({
      title: hasFailedAttachments.value
        ? t("attachment-retry-or-remove")
        : t("attachment-uploading-wait"),
      icon: "none",
    });
    return;
  }

  const { files, meta } = takeUploadedFiles();
  if (!text && !files.length) return;
  draft.value = "";
  emit("update:modelValue", "");
  emit("send", { text, files, attachments: meta });
}

// 语音输入（录音手势、权限、识别、确认面板）整体收在 useVoiceInput 里
const {
  inputMode,
  voicePhase,
  voiceTextValue,
  isVoiceConfirmationOpen,
  voiceTextareaRef,
  state: voice,
  onToggleInputMode,
  switchToText,
  onVoiceClose,
  onVoiceSend,
  onVoiceTextareaInput,
  focusVoiceTextarea,
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
} = useVoiceInput({
  isLoading: () => props.isLoading,
  submit: text => submitMessage(text),
  onRecognizeBegin: () => emit("recognize-begin"),
  onRecognizeFail: () => emit("recognize-fail"),
  toggleQuickList: () => emit("toggle-quick-list", true),
  dismissKeyboard: onDismissKeyboard,
  emitVoiceEvent: (event, payload) => emit(event, payload),
});

/**
 * 紧凑态面板的防误触：真机上手一碰就抬起，也会立刻挂载整块底部渐变，
 * 底部导航 / 输入栏跟着让位，看起来很闪。所以按住满 500ms 才挂载面板，
 * 不足 500ms 的快速点按从头到尾都不出现任何变化。
 * 整屏态（非 compact）不吃这个延迟 —— 那里的「按住说话」按钮本身就藏在整屏遮罩里，
 * 延迟会出现 500ms 空窗。
 */
const VOICE_PANEL_DELAY_MS = 500;
const {
  active: voicePanelReady,
  press: beginVoicePanelDelay,
  release: cancelVoicePanelDelay,
} = usePressDelay(VOICE_PANEL_DELAY_MS);

/** 底部录音面板是否该挂载（模板 v-if 用这个，而不是直接看 voicePhase） */
const showVoiceSheet = computed(() => {
  const recording = inputMode.value === "voice" && voicePhase.value === "recording";
  if (!recording) return false;
  return props.compactVoiceListening ? voicePanelReady.value : true;
});

watch(
  () => inputMode.value === "voice" && voicePhase.value === "recording",
  (recording) => {
    if (recording && props.compactVoiceListening) beginVoicePanelDelay();
    else cancelVoicePanelDelay();
  },
  { immediate: true },
);

/**
 * 紧凑录音态底部面板（设计稿 1204:467 录动态）是否展开。
 * 设计稿这一屏底部只有「水面 + 提示行 + 声纹」，面板一出现，
 * 底部导航（听汇报 / 作业指导…）、输入栏、免责文案都要让位，
 * 所以把开合状态同步给页面，由页面决定哪些贴底元素要收起。
 * 用 showVoiceSheet 而不是直接看 voicePhase：让位时机与面板挂载严格同步，
 * 快速点按（<500ms）既不出面板也不让位。
 */
const isVoicePanelOpen = computed(
  () => props.compactVoiceListening && showVoiceSheet.value,
);

watch(isVoicePanelOpen, open => emit("voice-panel-open", open));

/**
 * 按住说话的实时音量：录音期间每 100ms 调一次
 * AlipayJSBridge.call("microphoneVolume", {}, (res) => {})，
 * 用 res.level(0~1) 驱动底部 40 根声纹（豆包那种「声音越大跳得越高」）。
 * - level 缺失时用 amplitude / 32767 兜底；
 * - 桥不可用 / 宿主没实现时返回 null，声纹保留轻幅呼吸，录制本身完全不受影响。
 *
 * 注意：宿主对 microphoneVolume 的回调本来就「时有时无」（见 callNative 的注释），
 * 所以这里拿到 null 只降频重试，绝不停止轮询、更不能顺手停掉声纹动效 ——
 * 一旦停了，barScales 会归位到静态基线，真机表现就是「录着音但声纹一动不动」。
 */
const micLevel = ref<number | null>(null);
let micLevelPolling = false;
let micLevelTimer: ReturnType<typeof setTimeout> | undefined;
/** 连续拿不到电平的次数：只用于退避，不代表放弃 */
let micLevelMisses = 0;
/** 退避上限：宿主偶发不回调时仍保持 1s 一次，别把声纹的呼吸也一起掐掉 */
const MIC_LEVEL_MAX_BACKOFF_MS = 1000;

async function pollMicLevel() {
  if (!micLevelPolling) return;
  const level = await getMicrophoneVolume();
  if (!micLevelPolling) return;

  if (level == null) {
    micLevelMisses += 1;
    const delay = Math.min(MIC_LEVEL_MAX_BACKOFF_MS, 100 * 2 ** Math.min(micLevelMisses, 4));
    micLevelTimer = setTimeout(pollMicLevel, delay);
    return;
  }

  micLevelMisses = 0;
  micLevel.value = level;
  micLevelTimer = setTimeout(pollMicLevel, 100);
}

/**
 * 逐根声纹的起伏系数，rAF 里每帧算一次：
 *   幅度 = f(平滑后的电平)          —— 音量决定这一根能跳多高，跟着声音走
 *        × sin(t·speed + phase)      —— 决定这一根此刻在起还是在落
 *        × gain                      —— 逐根强弱错开，避免整排等幅齐闪
 * 静音（level≈0）时约 0.28~0.40 倍的轻呼吸；说话时随电平逐根甩到 1~3 倍基线（上限 3.4）。
 *
 * 关键：不再把系数交给模板重新渲染，而是直接写 DOM 的 `transform: scaleY()`。
 * 之前是 `:style="{ height: …rpx }"`，30fps 下每秒要重渲染 40 个节点、还要过
 * rpx→rem 归一化那一层；真机上出现了「采样日志在跳、声纹却不动」的情况，
 * 说明卡在渲染这一环。直接改 transform 绕开 vnode diff，也走合成层，不掉帧。
 */
const voiceBarsRef = ref<unknown>(null);
/** 40 根声纹的真实节点，容器子树重建时按数量重新取 */
let barNodes: HTMLElement[] = [];
/** 平滑后的电平（0~1）：声纹幅度、水面起伏都读它 */
const barLevel = ref(0);
let smoothedLevel = 0;
let barFrameId = 0;
let lastBarFrameAt = 0;
let barSampleLogAt = 0;
/** ~30fps：看着够顺滑，又不用每帧都去算 40 个节点（低端 WebView 也能扛） */
const BAR_FRAME_MS = 33;

/** 取 40 根声纹节点：容器重建（v-if 开关）后按数量重新收集一次 */
function getBarNodes(): HTMLElement[] {
  const host = readEl(voiceBarsRef.value);
  if (!host) {
    barNodes = [];
    return barNodes;
  }
  if (barNodes.length !== host.children.length) {
    barNodes = Array.from(host.children) as HTMLElement[];
  }
  return barNodes;
}

/**
 * 拿不到电平时的兜底「呼吸」：约 3Hz 的轻幅起伏。
 * 宿主这一次没回调（null）不等于静音，声纹不该僵成一条直线，
 * 所以用一段合成电平顶住，等真电平回来再被平滑接管。
 */
function idleBreathLevel(now: number) {
  const t = now / 1000;
  return 0.14 + 0.1 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3.2));
}

/**
 * 电平 → 视觉幅度：
 * 早先是「固定 0.4 底座 + 每根自己 0.3~1 的抖动」× 电平的线性系数，
 * 抖动本身占了大头，音量只把整排等比放大一点；再叠上 4~6Hz 的抖频，
 * 30fps 采出来就是一片等幅乱颤，肉眼读不出「声音变大」。
 * 现在反过来：电平决定「这一根能甩多高」，静音贴着基线轻呼吸，
 * 说话时逐根甩开，动态对比才出得来。
 */
function tickBarScales(now: number) {
  barFrameId = requestAnimationFrame(tickBarScales);
  if (now - lastBarFrameAt < BAR_FRAME_MS) return;
  lastBarFrameAt = now;

  const target = micLevel.value ?? idleBreathLevel(now);
  // attack 快、release 慢：音节进来立刻起，收尾慢慢落，才像人在说话
  const follow = target > smoothedLevel ? 0.75 : 0.2;
  smoothedLevel += (target - smoothedLevel) * follow;
  if (Math.abs(target - smoothedLevel) < 0.003) smoothedLevel = target;
  barLevel.value = Number(smoothedLevel.toFixed(3));

  // 0.45 次幂：宿主给的电平常年偏小（实测安静时 0.1 上下、说话 0.4~1），
  // 指数越小于 1，中低音量被抬得越高；0.45 相当于把 0.5 当成 0.73 用，
  // 平常说话就能把整排甩满，不用等到喊出来
  const shaped = Math.min(1, Math.max(0, smoothedLevel)) ** 0.45;
  // 0.08 是静音底：始终留一点呼吸，不至于变成一条死线
  const amp = 0.08 + 2.6 * shaped;

  const t = now / 1000;
  // 整排共享的慢摆动（约 1Hz）：40 根一起上下起伏才有「声浪」的观感；
  // 只留逐根相位差的话，看上去是「抖」而不是「跳」
  const sway = 0.5 + 0.5 * Math.sin(t * 6.2);
  const scales = VOICE_WAVE_BARS_MOTION.map((bar) => {
    const flutter = 0.5 + 0.5 * Math.sin(t * bar.speed + bar.phase);
    // 0.05~1 的波形：谷压到近乎贴线、峰整根甩开，落差越大抖动越明显
    const wave = 0.05 + 0.95 * (0.62 * flutter + 0.38 * sway);
    // 0.12 的静态底比原来的 0.22 更低：低谷更接近一条线，视觉落差再放大一档
    const scale = 0.12 + amp * bar.gain * wave;
    return Number(Math.min(3.4, scale).toFixed(3));
  });

  const nodes = getBarNodes();
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].style.transform = `scaleY(${scales[i] ?? 1})`;
  }

  // 每秒打一条采样，真机上可以直接对照「电平多大 → 声纹多高」
  if (now - barSampleLogAt >= 1000) {
    barSampleLogAt = now;
    logger.debug("[voice] 声纹采样", {
      level: micLevel.value,
      smoothed: barLevel.value,
      amp: Number(amp.toFixed(3)),
      scale0: scales[0],
      peak: Math.max(...scales),
    });
  }
}

function startMicLevelAnimation() {
  // 个别内核没有 rAF 时保持设计稿静态基线，别抛错。
  // 注意：这是功能性反馈（音量表），系统开了「减少动态效果」也照样要动 ——
  // 早先按 prefers-reduced-motion 一刀切停掉，表现就是「数据在跳、声纹不动」。
  if (barFrameId || typeof requestAnimationFrame !== "function") return;
  lastBarFrameAt = 0;
  barFrameId = requestAnimationFrame(tickBarScales);
  logger.debug("[voice] 声纹动效启动", {
    reducedMotion: typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}

function stopMicLevelAnimation() {
  if (barFrameId) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(barFrameId);
    barFrameId = 0;
  }
  smoothedLevel = 0;
  barLevel.value = 0;
  // 直接改过的 transform 得自己还原，否则下一轮录音会停在上一帧的形态
  for (const node of barNodes) node.style.transform = "";
  barSampleLogAt = 0;
}

function startMicLevelPolling() {
  startMicLevelAnimation();
  if (micLevelPolling) return;
  micLevelPolling = true;
  micLevelMisses = 0;
  void pollMicLevel();
}

/** 结束录音时整体收尾：停轮询 + 停动效（轮询失败不会走到这里） */
function stopMicLevelPolling() {
  micLevelPolling = false;
  micLevelMisses = 0;
  if (micLevelTimer) {
    clearTimeout(micLevelTimer);
    micLevelTimer = undefined;
  }
  micLevel.value = null;
  stopMicLevelAnimation();
}

// 跟着面板挂载一起起停：紧凑态防误触等待期间不去空转轮询
watch(showVoiceSheet, (open) => {
  if (open) startMicLevelPolling();
  else stopMicLevelPolling();
});

onBeforeUnmount(stopMicLevelPolling);

function onDraftInput(e: { detail: { value: string } }) {
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

function resetVoiceKeyboardState() {
  emit("voice-input-blur");
}

/** 收起语音编辑键盘只退出编辑焦点，保留识别草稿和语音确认态。 */
function onVoiceTextareaBlur() {
  resetVoiceKeyboardState();
}

/**
 * 点击识别结果进入编辑：先同步把「语音编辑」标志置位（早于浏览器 focusin），
 * 避免 onFocusIn 从 DOM 判定失败而把普通输入栏弹起；随后再聚焦。
 */
function prepareVoiceTextareaFocus() {
  emit("voice-input-focus");
  focusVoiceTextarea();
}

function onVoiceCloseUi() {
  resetVoiceKeyboardState();
  onVoiceClose();
}

function onVoiceSendUi() {
  resetVoiceKeyboardState();
  onVoiceSend();
}

function onVoiceRestartStartUi(e: unknown) {
  uni.hideKeyboard();
  resetVoiceKeyboardState();
  onVoiceRestartStart(e);
}

function onToggleInputModeUi() {
  uni.hideKeyboard();
  emit("input-blur");
  resetVoiceKeyboardState();
  onToggleInputMode();
}

function onTrySend() {
  submitMessage();
}

const textTextareaRef = ref<unknown>(null);

/**
 * 供外部调用（步骤卡拍照）：先切到文本模式，再聚焦文本输入框。
 * 走的是 textarea 自己的 focus 链路，键盘与底部间距沿用原有逻辑。
 */
async function focusTextInput() {
  switchToText();
  await nextTick();
  const el = textTextareaRef.value as { focus?: () => void } | null;
  el?.focus?.();
}

/**
 * 页面级长按录音入口：首页除灵动岛外的任意位置长按都要能录音，
 * 手势判定放在页面（要排除灵动岛 / 输入框），这里只把触点转成 useVoiceInput 认识的形状，
 * 复用同一套状态机 —— 300ms 短按取消、上划取消、松手识别、录音面板视觉都不另写。
 */
function startGlobalVoiceHold(clientY: number) {
  onVoicePillTouchStart({ touches: [{ clientY }], cancelable: false });
}

function updateGlobalVoiceHold(clientY: number) {
  updateVoiceGesture({ touches: [{ clientY }] });
}

async function endGlobalVoiceHold() {
  await onVoicePillTouchEnd({ cancelable: false });
}

async function cancelGlobalVoiceHold() {
  await onVoicePillTouchCancel();
}

/**
 * 对外接口（页面通过 ref 调用）：
 * - appendAttachments：把「已经上传好」的附件挂进输入栏（步骤卡拍照走这条路，不重复上传）；
 * - focusTextInput：切到文本模式并聚焦输入框；
 * - startGlobalVoiceHold / updateGlobalVoiceHold / endGlobalVoiceHold / cancelGlobalVoiceHold：
 *   页面级长按录音（任意位置长按，见 ai-page 的手势绑定）。
 * 注意 appendAttachments 对应 hook 里的 appendUploadedAttachments，两处名字必须一致。
 */
defineExpose({
  appendAttachments: appendUploadedAttachments,
  focusTextInput,
  startGlobalVoiceHold,
  updateGlobalVoiceHold,
  endGlobalVoiceHold,
  cancelGlobalVoiceHold,
});

/** 附件来源弹窗：拍照 / 相册 / 文件 三选一（强制 H5 上传期间为唯一入口） */
const isAttachmentPickerOpen = ref(false);

async function onOpenAttachmentPicker() {
  if (props.attachmentDisabled || props.isLoading || voice.isRecognizing) return;
  if (attachments.value.length >= 3) {
    openAttachmentPicker(); // 触顶提示
    return;
  }

  // FORCE_H5_UPLOAD 期间 isNativePickerAvailable 恒为 false，走前端三选项弹窗：
  // 拍照/相册 → uni.chooseImage，文件 → uni.chooseFile（均走 /files/upload）
  const nativeReady = await isNativePickerAvailable();
  if (nativeReady) {
    void chooseFilesFromNative();
    return;
  }

  // 原生不可用（Web/H5 等）时用前端三选项弹窗
  isAttachmentPickerOpen.value = true;
}

function onPickAttachmentSource(source: "camera" | "album" | "file") {
  isAttachmentPickerOpen.value = false;
  if (source === "file") {
    void chooseFilesFromNative();
  } else {
    void chooseImages([source]);
  }
}

watch(
  () => [
    keyboardOpen.value,
    voiceKeyboardOpen.value,
    inputMode.value,
    voicePhase.value,
    isVoiceConfirmationOpen.value,
    attachments.value.length,
    textTextareaHeight.value,
  ],
  () => nextTick(observeComposer),
);

onMounted(() => nextTick(observeComposer));

onBeforeUnmount(() => {
  if (maskLingerTimer) clearTimeout(maskLingerTimer);
  composerResizeObserver?.disconnect();
  composerResizeObserver = null;
});
</script>

<template>
  <view
    class="chat-input"
    :class="{
      'chat-input--keyboard-open': keyboardOpen || voiceKeyboardOpen,
      'chat-input--voice-panel-open': isVoicePanelOpen,
    }"
    :style="inputLiftStyle"
  >
    <!-- 键盘弹起时的空白区兜底：点一下收键盘，否则编辑识别结果时没有退出口 -->
    <view
      v-if="showKeyboardMask"
      class="chat-input__keyboard-mask"
      @touchstart.stop.prevent="onDismissKeyboard"
      @click.stop="onDismissKeyboard"
      @tap.stop="onMaskTap"
    />

    <!-- 只有全屏对焦态（listening）才挂到 body：它要盖住底部导航与浮动按钮。
         紧凑态（首页 / 听播 / 异常列表追问）只做底部装饰，留在输入栏容器里渲染，
         这样它在页面内的层级跟着使用者走 —— 弹层（异常列表追问浮层）打开的
         时候不会被浮层背景整块遮住，视觉态和首页一致 -->
    <Teleport to="body" :disabled="compactVoiceListening">
      <view
        v-if="showVoiceSheet"
        class="voice-sheet"
        :class="compactVoiceListening ? 'voice-sheet--listening-compact' : 'voice-sheet--listening'"
      >
        <view
          class="voice-listening"
          :class="{
            'voice-listening--compact': compactVoiceListening,
            'voice-listening--cancelling': voice.cancelling,
          }"
        >
          <!-- ===== 紧凑态（首页 / 听播 / 异常列表追问）：设计稿 1204:467 录动态底部 ===== -->
          <template v-if="compactVoiceListening">
            <!-- ① 1204:725 Rectangle 105（375×250 @562）+ 1204:609 Rectangle 103（375×166 @646）：
                两层同色 #FAFAFA 渐隐，页面内容向上淡入白色（见 .voice-panel__fade） -->
            <view class="voice-panel__fade" aria-hidden="true" />

            <!-- ② 录音态 1204:715 Frame 85（375×166 @646）→ Mask group：
                 遮罩 1204:719 Vector 87（449×195 @ −38,655，图层模糊 50）只裁形、不绘制；
                 真正上色的是 1302:3 Ellipse 75（434×341 @ −31,655），
                 #EFEFEE(α0) → #0F7EEE 纵向渐变 + 图层模糊 37（详见 .voice-panel__wave）。
                 取消态 1204:740 同结构，但蓝色填充被关掉、换成 #E02E2A 淡水红（434×365），
                 见 .voice-listening--cancelling .voice-panel__wave -->
            <view
              class="voice-panel__wave"
              :class="{ 'voice-panel__wave--paused': voice.cancelling }"
              :style="{ transform: `scaleY(${(1 + barLevel * 0.3).toFixed(3)})` }"
              aria-hidden="true"
            />

            <!-- ③ 录音态 1204:722（119×20 @128,695，14px / #6D8AA6，左对齐于居中框内）；
                 取消态 1291:65（56×20 @159,695，14px / #C8201E，居中，文案「松手取消」） -->
            <text class="voice-panel__hint">
              {{ voice.cancelling ? t("input-voice-panel-cancel") : t("input-voice-tip") }}
            </text>

            <!-- ④ 1291:1 Frame 114（195×20.76 @91,733）：40 根声纹，正常白、取消态红。
                 设计稿高度只做基线，录音中由 tickBarScales 直接写每根的 transform: scaleY()
                 （绕开逐帧 vnode diff，声音大 → 整排变高，每根按自己的 speed / phase 起落） -->
            <view ref="voiceBarsRef" class="voice-panel__bars" aria-hidden="true">
              <view
                v-for="(bar, index) in VOICE_WAVE_BARS_MOTION"
                :key="index"
                class="voice-panel__bar"
                :style="{ height: `${bar.height}rpx` }"
              />
            </view>
          </template>

          <!-- ===== 整屏态：其它页面沿用原样式，结构保持不动 ===== -->
          <template v-else>
            <view
              class="voice-listening__header"
              :class="{ 'voice-listening__header--cancelling': voice.cancelling }"
            >
              <text class="voice-listening__title">
                {{ voice.cancelling ? t("input-voice-cancel-voice") : t("input-voice-listening") }}
              </text>
              <text class="voice-listening__hint">
                {{ voice.cancelling ? t("input-voice-cancel-recognize") : t("input-voice-release-send") }}
              </text>
            </view>

            <!-- 对称圆点声纹 -->
            <view v-if="voicePhase === 'recording'" class="voice-wave" aria-hidden="true">
              <view class="voice-wave__dots voice-wave__dots--left">
                <view v-for="i in 9" :key="`l${i}`" class="voice-wave__dot" />
              </view>
              <view class="voice-wave__center" />
              <view class="voice-wave__dots voice-wave__dots--right">
                <view v-for="i in 9" :key="`r${i}`" class="voice-wave__dot" />
              </view>
            </view>

            <!-- 麦克风（按住说话） -->
            <view
              class="voice-listening__mic"
              @touchstart.prevent="onVoiceTouchStart"
              @touchmove.prevent="updateVoiceGesture"
              @touchend.prevent="onVoiceTouchEnd"
              @touchcancel.prevent="onVoiceTouchCancel"
              @mousedown.prevent="onVoiceTouchStart"
              @mousemove.prevent="updateVoiceGesture"
              @mouseup.prevent="onVoiceTouchEnd"
            >
              <image
                src="@/assets/img/icon-mic-red.svg"
                mode="aspectFit"
                class="voice-listening__mic-img"
              />
            </view>
          </template>
        </view>
      </view>
    </Teleport>

    <!-- 识别完成 / 编辑态：底部面板（设计稿 495:589 / 495:656） -->
    <view
      v-if="inputMode === 'voice' && voicePhase !== 'idle' && isVoiceConfirmationOpen"
      ref="voiceSheetRef"
      class="voice-sheet"
      :class="{ 'voice-sheet--keyboard-open': voiceKeyboardOpen }"
    >
      <view class="voice-confirm">
        <view
          class="voice-confirm__box"
          :class="{ 'voice-confirm__box--recognizing': voice.isRecognizing }"
        >
          <textarea
            ref="voiceTextareaRef"
            class="voice-confirm__textarea"
            data-voice-confirm-input="true"
            :value="voiceTextValue"
            :disabled="voice.isRecognizing"
            placeholder=""
            confirm-type="send"
            :adjust-position="false"
            :cursor-spacing="0"
            :show-confirm-bar="false"
            @input="onVoiceTextareaInput"
            @confirm="onVoiceSendUi"
            @focus="emit('voice-input-focus')"
            @blur="onVoiceTextareaBlur"
            @touchstart.stop="prepareVoiceTextareaFocus"
          />
          <view
            v-if="voice.isRecognizing"
            class="voice-confirm__recognizing"
            :aria-label="t('input-voice-recognizing-aria')"
          >
            <view class="voice-confirm__spinner" />
            <text class="voice-confirm__recognizing-text">{{ t("input-voice-recognizing") }}</text>
          </view>
          <view
            v-else-if="voice.restartRecording"
            class="voice-confirm__recognizing"
            :aria-label="t('input-voice-recording-aria')"
          >
            <text class="voice-confirm__recognizing-text">
              {{ voice.cancelling ? t("input-voice-cancel") : t("input-voice-recording") }}
            </text>
          </view>
        </view>

        <view
          v-if="!voiceKeyboardOpen"
          class="voice-confirm__actions"
          :class="{ 'voice-confirm__actions--recognizing': voice.isRecognizing }"
        >
          <!-- 关闭 -->
          <view
            class="voice-action voice-action--ghost"
            @touchstart.stop.prevent="onVoiceCloseUi"
            @tap="onVoiceCloseUi"
          >
            <image
              src="@/assets/img/icon-close-lg.svg"
              mode="aspectFit"
              class="voice-action__icon"
            />
          </view>
          <!-- 发送 -->
          <view
            class="voice-action voice-action--send"
            @touchstart.stop.prevent="onVoiceSendUi"
            @tap="onVoiceSendUi"
          >
            <image
              src="@/assets/img/icon-send-2.svg"
              mode="aspectFit"
              class="voice-action__icon voice-action__icon--send"
            />
          </view>
          <!-- 重新识别 -->
          <view
            class="voice-action voice-action--ghost"
            :class="{ 'voice-action--recording': voice.restartRecording }"
            @touchstart.prevent="onVoiceRestartStartUi"
            @touchmove.prevent="updateVoiceGesture"
            @touchend.prevent="onVoiceRestartEnd"
            @touchcancel.prevent="onVoiceRestartCancel"
            @mousedown.prevent="onVoiceRestartStartUi"
            @mousemove.prevent="updateVoiceGesture"
            @mouseup.prevent="onVoiceRestartEnd"
          >
            <image
              src="@/assets/img/icon-voice-sm.svg"
              mode="aspectFit"
              class="voice-action__icon"
            />
          </view>
        </view>
      </view>
    </view>
    <!-- 始终 fixed 贴底；键盘弹起时用 bottom 抬到键盘上方 -->
    <view v-if="!voiceKeyboardOpen" ref="dockRef" class="chat-input__dock">
      <!-- 页面自定义的贴底区域，会一起计入输入栏高度 -->
      <slot name="dock-top" />

      <!-- 附件预览栏：选中的文件在输入栏上方排开 -->
      <AiChatAttachments
        v-if="attachments.length"
        :attachments="attachments"
        @remove="removeAttachment"
        @retry="retryAttachment"
      />

      <!--
        底部输入栏：默认语音、键盘文本、发送三种状态。
        文本态空闲（input-bar--plain）走灰色胶囊样式：无文字时右侧是声波（切语音），
        有文字时右侧是黑圆上箭头（发送）。
        回答生成中（思考中）整条输入栏照常展示，只把右侧的键盘/发送换成黑色停止按钮，
        「按住说话」置灰并暂时禁用；点停止或生成结束即恢复。
      -->
      <view
        class="input-bar"
        :class="{
          'input-bar--text': inputMode === 'text',
          'input-bar--plain': inputMode === 'text' && !isLoading && !voice.isRecognizing,
        }"
      >
        <!-- 左侧：附件入口（思考中同样展示） -->
        <view
          v-if="!(attachmentDisabled || voice.isRecognizing)"
          class="input-bar__plus"
          @tap="onOpenAttachmentPicker"
        >
          <image src="@/assets/img/icon-plus.svg" mode="aspectFit" />
        </view>

        <!--
          语音态：设计稿 1204:337 Toolbar（375×64，padding 8 / 20，gap 10）
          加号（左 44×44） + 按住说话框（中 219×44，r45，#0D0D0D 3.61%） + 键盘（右 44×44）
          录音手势直接挂在「按住说话」这块框上，不再用原来的小语音段图标
        -->
        <view
          v-if="inputMode === 'voice'"
          class="input-bar__hold"
          :class="{ 'input-bar__hold--disabled': isLoading }"
          @touchstart.prevent="onVoicePillTouchStart"
          @touchmove.prevent="updateVoiceGesture"
          @touchend.prevent="onVoicePillTouchEnd"
          @touchcancel.prevent="onVoicePillTouchCancel"
          @mousedown.prevent="onVoicePillTouchStart"
          @mousemove.prevent="updateVoiceGesture"
          @mouseup.prevent="onVoicePillTouchEnd"
        >
          <!-- 识别中占用同一块框，文案换成识别态 -->
          <text v-if="voice.isRecognizing" class="input-bar__hold-hint">
            {{ t("input-recognizing") }}
          </text>
          <text v-else class="input-bar__hold-label">{{ t("input-hold-to-talk") }}</text>
        </view>
        <view
          v-else
          class="input-bar__text-field"
          :class="{
            'input-bar__text-field--padding': attachmentDisabled || voice.isRecognizing,
          }"
        >
          <textarea
            ref="textTextareaRef"
            class="input-bar__textarea"
            :value="draft"
            :style="{ height: textTextareaHeight }"
            :placeholder="t('input-placeholder')"
            :disabled="isLoading"
            :auto-height="false"
            :adjust-position="false"
            :cursor-spacing="0"
            :hold-keyboard="true"
            :maxlength="-1"
            confirm-type="send"
            placeholder-class="input-bar__placeholder"
            @input="onDraftInput"
            @confirm="onTrySend"
            @focus="onTextareaFocus"
            @blur="onTextareaBlur"
          />
        </view>

        <!-- 右侧：生成中只有一个黑色停止按钮（#0D0D0D 圆 + 白色圆角方块），
             其余时间才是「键盘 / 声波」切换钮或发送钮 -->
        <view v-if="isLoading" class="input-bar__stop" @tap="emit('stop')">
          <image src="@/assets/img/icon-stop-circle.svg" mode="aspectFit" />
        </view>
        <!-- 右侧切换入口：设计稿 1204:337 键盘按钮（44×44 圆形，同一行最右）
             语音态 = 键盘（切到文字输入）；文本态 = 声波（切回语音） -->
        <view
          v-else-if="!showSendButton"
          class="input-bar__mode"
          :class="{ 'input-bar__mode--disabled': voice.gesture.active || voice.isRecognizing }"
          @tap="onToggleInputModeUi"
        >
          <image
            v-if="inputMode === 'voice'"
            src="@/assets/img/icon-keyboard-dark.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-voice-wave-dark.svg" mode="aspectFit" />
        </view>
        <view v-else class="input-bar__send" @touchstart.stop.prevent="onTrySend">
          <!-- 文本态：黑圆上箭头；语音态保持原红色发送 -->
          <image
            v-if="inputMode === 'text'"
            src="@/assets/img/icon-send-up.svg"
            mode="aspectFit"
          />
          <image v-else src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>

      <!-- 输入单元下提示（Figma: 41116:6071）。跟着输入栏一起上移，键盘弹起时同样要看得见 -->
      <view class="chat-input__footer">
        <text class="chat-input__footer-text">
          {{ t("ai-content-disclaimer") }}
        </text>
      </view>
    </view>

    <!-- 附件来源弹窗：拍照 / 从相册选择 / 选择文件；步骤卡复用同一个组件 -->
    <AiAttachmentPicker
      v-model:visible="isAttachmentPickerOpen"
      @pick="onPickAttachmentSource"
    />
  </view>
</template>

<style lang="scss" scoped>
.chat-input {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  box-sizing: border-box;
  background: #fafafa;
  uni-image {
    width: 100%;
    height: 100%;
  }
}

// 紧凑录音态（首页 / 听播 / 异常列表追问）：
// 1) 整条输入栏容器降到 z-index 0 —— 底部导航（z-index 1）仍然浮在渐变之上；
// 2) 容器底色去掉，否则 #fafafa 实色底会把面板的渐变色波浪下半截切掉。
// 面板不 Teleport，留在容器内部（z-index 0）渲染，所以它一定在输入栏之下、
// 又跟着所在页面 / 弹层走，不会被浮层背景遮住。
.chat-input--voice-panel-open {
  z-index: 0;
  background: transparent;
}

/* 3) 设计稿 1204:467 的录音态底部只有「提示行 + 声纹 + 水面」：
   输入栏（加号 / 按住说话 / 键盘）与「内容由 AI 生成」提示在这一屏让位。
   只降透明度不摘 DOM —— 手指还按在 .input-bar__hold 上，元素一旦移除手势就断了 */
.chat-input--voice-panel-open .input-bar,
.chat-input--voice-panel-open .chat-input__footer {
  opacity: 0;
  transition: opacity 0.16s ease;
}

.voice-sheet {
  position: relative;
  z-index: 2;
  box-sizing: border-box;
  // 识别完成/编辑态：设计稿中的窄幅底部面板
  border-radius: 64rpx 64rpx 0 0;
  background: #ffffff;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  box-shadow: 0 -0.5rem 1.5rem rgba(51, 51, 51, 0.14);
}

// 监听态：全屏对焦（设计稿 495:543）
.voice-sheet--listening {
  position: fixed;
  z-index: 100000;
  top: 0;
  right: 0;
  bottom: auto;
  left: 0;
  height: 100%;
  border-radius: 0;
  background:
    radial-gradient(ellipse 196rpx 117rpx at 0 0, rgba(123, 167, 217, 0.06) 50%, transparent 100%),
    radial-gradient(ellipse 301rpx 117rpx at 100% 0, rgba(254, 0, 0, 0.07) 0%, transparent 100%),
    #ffffff;
  box-shadow: none;
}

/* ==========================================================================
   底部语音面板（首页紧凑态）：设计稿 1204:467 录动态底部
   面板范围：y532 → y812，高 280px = 560rpx，四层自下而上依次是
   ① 1204:725 + 1204:609 两层 #FAFAFA 渐隐（.voice-panel__fade）
   ② 1204:715 → Mask group 内绘制的 1302:3 Ellipse 75（.voice-panel__wave）
   ③ 1204:722 提示行「松手发送  上滑取消」（.voice-panel__hint）
   ④ 1291:1 40 根白色声纹（.voice-panel__bars）
   ========================================================================== */
.voice-sheet--listening-compact {
  position: fixed;
  /* 紧凑态不 Teleport，留在输入栏容器（z-index 1）内渲染：
     层级只跟输入栏比，天然压在输入栏之下，又能跟着所在页面 / 弹层走，
     不会被异常列表追问浮层这类高层级容器整块盖住 */
  /* 只做底部装饰：层级压在底部导航（z-index 1）与输入栏之下，
     录音时「听汇报 / 作业指导」等入口照旧可点可见 */
  z-index: 0;
  right: 0;
  bottom: 0;
  left: 0;
  height: 560rpx; /* 280px（y532 → y812） */
  overflow: hidden;
  border-radius: 0; /* 覆盖基类 .voice-sheet 的 64rpx 顶角圆角：贴合屏幕两边缘，无弹窗感 */
  background: transparent; /* 设计稿无面板容器：底色全透明，只叠柔性形状 */
  box-shadow: none; /* 覆盖基类上抛投影：装饰层直接落在页面上，不是浮层 */
  padding-bottom: 0; /* 覆盖基类 safe-area 内边距：波浪色带应贴到屏幕物理底边 */
  pointer-events: none; /* 容器只承担视觉层，不挡页面滚动；录音手势由页面长按接管 */
}

/* 复合类提高优先级：基础 .voice-listening 定义在本段之后 */
.voice-listening.voice-listening--compact {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  /* 挂载即可见那一档：整块底部渐变 220ms 淡入 + 上托。
     500ms 的防误触在 JS 里（showVoiceSheet），不到点这段 DOM 根本不会挂载 */
  animation: voice-panel-enter 0.22s ease-out both;
}

@keyframes voice-panel-enter {
  from {
    opacity: 0;
    transform: translateY(24rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 1204:725 Rectangle 105（375×250 @562）+ 1204:609 Rectangle 103（375×166 @646）：
   两层同色 #FAFAFA 渐隐，都是 0 → 80%(21.16%) → 100%(35.86%)；
   第二层从 y646 重新起坡，两层叠加让面板下半段更实。
   面板顶 = y532，故第一层落在 30px(=60rpx)，第二层落在 (646−562)=84px(=168rpx) 处 */
.voice-panel__fade {
  position: absolute;
  top: 60rpx; /* y562 − y532 = 30px */
  left: 0;
  width: 750rpx; /* 375px */
  height: 500rpx; /* 250px */
  background: linear-gradient(
    180deg,
    rgb(250 250 250 / 0%) 0%,
    rgb(250 250 250 / 80%) 21.16%,
    #fafafa 35.86%
  );
  pointer-events: none;
}

/* 第二层渐隐（1204:609）：与第一层同色同参数，只错开起点 */
.voice-panel__fade::after {
  content: "";
  position: absolute;
  top: 168rpx; /* 646 − 562 = 84px */
  left: 0;
  width: 100%;
  height: 332rpx; /* 166px */
  background: linear-gradient(
    180deg,
    rgb(250 250 250 / 0%) 0%,
    rgb(250 250 250 / 80%) 21.16%,
    #fafafa 35.86%
  );
}

/* 1204:715 Frame 85（375×166 @646）→ Mask group 里唯一上色的一层：
   1302:3 Ellipse 75 —— 椭圆 434×341，左上角 (x −31, y 655)，
   圆心 (186, 825.5) 落在屏幕底边（y812）下方 13.5px，所以底边两角同样吃到饱和蓝；
   上半部越靠边越早「出界」，顶部自然收成一条圆弧，而不是通栏直角。
   Mask group 的首子节点 1204:719 Vector 87（449×195 @ −38,655，图层模糊 50）是遮罩、
   只裁形不上色 —— 设计稿渲染里合成色恒为 #0F7EEE（按 R/G 双通道反解 α 一致），
   若把 Vector 87 的 #295DC3 → #0D7ABA 也画上去，蓝通道会被拉低、与设计稿不符。

   填充 = #EFEFEE(α0) → #0F7EEE 的纵向渐变，起止位置按设计稿渲染像素反解：
   渐变 0 点取 y665（元素内 2.9%）、1 点取 y812（元素内 46%），
   实测剖面 y700≈0.21、y733≈0.40、y760≈0.62、y800≈0.92、y811≈0.93。
   （设计稿 Ellipse 75 的 gradientTransform 是 90° 旋转矩阵，按矩阵推算的坡道与
     实际渲染不符 —— 拷贝节点常见的绑定失效，故以渲染像素为准。）
   设计稿的图层模糊 37 在该尺寸下等价于 CSS 高斯 σ≈12px，同样由渲染像素拟合得到。

   整层只做 opacity 呼吸：一旦改用 background-position 位移，元素顶端会露出硬边。 */
.voice-panel__wave {
  position: absolute;
  z-index: 1; /* 水面压在渐隐层之上，但在提示行 / 声纹之下 */
  top: 246rpx; /* y655 − y532 = 123px */
  left: -62rpx; /* x = −31px */
  width: 868rpx; /* 434px */
  height: 682rpx; /* 341px */
  border-radius: 50%;
  background: linear-gradient(180deg, rgb(239 239 238 / 0%) 2.9%, #0f7eee 46%);
  filter: blur(24rpx); /* σ = 12px（设计稿图层模糊 37 的等效值） */
  animation: voice-water-breathe 5.6s ease-in-out infinite alternate;
  /* 音量驱动整片水面从底边往上"涨"：模板内联 scaleY(1 + 电平 × 0.3)，
     电平满格时涨三成（682rpx → 约 887rpx，顶端仍在面板内，不会露硬边）。
     这一层只管蓝色渐变，中间那 40 根声纹不受影响。 */
  transform-origin: bottom center;
  will-change: opacity, transform;
  pointer-events: none;
}

/* 取消态：水面停止呼吸（与声纹条暂停逻辑一致） */
.voice-panel__wave--paused {
  animation-play-state: paused;
}

/* 水面的呼吸：只改整层不透明度（幅度 ±3%，几乎不扰动设计稿的坡道） */
@keyframes voice-water-breathe {
  from {
    opacity: 0.94;
  }
  to {
    opacity: 1;
  }
}

/* 1204:722（119×20 @128,695）：提示行，14px / #6D8AA6，取消态换成「松手取消」并转红 */
.voice-panel__hint {
  position: absolute;
  z-index: 3; /* 明确压在水面上，杜绝任何内核下的遮挡 */
  top: 326rpx; /* y695 − y532 = 163px */
  right: 0;
  left: 0;
  font-size: 28rpx; /* 14px */
  font-weight: 400;
  line-height: 40rpx; /* 20px */
  color: #6d8aa6;
  text-align: center;
  pointer-events: none;
}

/* 1291:1 Frame 114（195×20.76 @91,733）：40 根白色声纹。
   设计稿每根是「0 宽矢量 + 2px 白色描边」，节点间距 5px；
   等价到 CSS 就是 2px 宽的竖条 + 3px gap：40×2 + 39×3 = 197px
   = 设计稿 195px + 左右各 1px 描边出血，整体仍居中。
   每根高度由模板内联（设计稿 px × 2 = rpx），竖向居中对齐 */
.voice-panel__bars {
  position: absolute;
  z-index: 3; /* 明确压在水面上 */
  top: 402rpx; /* y733 − y532 = 201px */
  right: 0;
  left: 0;
  display: flex;
  height: 41.5rpx; /* 20.76px */
  align-items: center;
  justify-content: center;
  gap: 6rpx; /* 3px */
  /* 起伏交给每根自己（模板按实时电平内联高度），容器只管布局；
     整排一起缩放就成了「整体放大缩小」，不是豆包那种逐根跳动。 */
  pointer-events: none;
}

/* 声纹条：设计稿是 40 根静态白线，这里的高度只做基线，
   录音中由 tickBarScales 逐帧写 transform: scaleY()（JS 逐帧算，~30fps）。
   注意两点：
   1. 别再挂 CSS animation —— 动画会盖掉内联样式，电平就白算了；
   2. transform-origin 必须在中心，父级是 align-items: center，
      这样缩放才是「上下同时长」而不是单向往上顶。
   最高一根 33.5rpx × 3.4 ≈ 114rpx，会溢出 41.5rpx 的容器，
   容器不设 overflow: hidden，让它照常画出去就行。 */
.voice-panel__bar {
  flex: 0 0 auto;
  width: 4rpx; /* 2px */
  min-height: 2rpx; /* 缩放到底也别彻底消失 */
  border-radius: 4rpx;
  background: #ffffff;
  transform-origin: center center;
  will-change: transform;
}

/* ---------- 取消态（1204:740）：提示行 + 声纹 + 水面三处同时转红 ---------- */

/* 1291:65（56×20 @159,695）：14px / #C8201E / 居中，文案「松手取消」
   （设计稿该行 56px 宽 = 4 字 × 14px，居中于 x=187，与录音态同一基线 y695） */
.voice-listening--cancelling .voice-panel__hint {
  color: #c8201e;
}

/* 1291:24 Frame 114 内 40 根声纹：描边由 #FFFFFF 改为 #C8201E，粗细仍为 2px。
   设计稿取消态的声纹容器 y=731.23（比录音态 733 高 1.77px），属副本漂移，
   这里沿用录音态的 402rpx，避免上滑进入取消态时声纹整体跳动 */
.voice-listening--cancelling .voice-panel__bar {
  background: #c8201e;
}

/* 1204:740 → 1291:17 Mask group：设计稿把 Ellipse 75 的蓝色填充关掉（元素级 visible:false），
   换成 #E02E2A 的淡水红 —— 椭圆 434×365（比录音态高 24px，顶边同为 y655）。
   填充标注为 #E02E2A α0 → α0.244，但经 Mask group（449×171 @ −38,679，模糊 50）衰减后，
   设计稿渲染实测中轴透明度为：y660≈0.005、y690≈0.049、y760≈0.142、y800≈0.181、屏幕底≈0.181
   （即「淡红雾」，不是实心红面，与蓝水底边 0.93 完全不同）。
   按实测剖面拟合：线性坡道 0 → 18.1%（y790 处到达顶点，元素内 37%），其后保持 18.1%，
   与 17 个采样点的平均误差 0.0045；模糊仍沿用 24rpx（σ≈12px，拟合中 8~12 无差别）。 */
.voice-listening--cancelling .voice-panel__wave {
  height: 730rpx; /* 365px：设计稿取消态 Ellipse 75 的高度 */
  background: linear-gradient(180deg, rgb(224 46 42 / 0%) 0%, rgb(224 46 42 / 18.1%) 37%);
}

/* ---------- 监听态 ---------- */
.voice-listening {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  padding-bottom: calc(env(safe-area-inset-bottom) + 60rpx);
  box-sizing: border-box;
}

.voice-listening__header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  margin-top: auto;
}

.voice-listening__title {
  font-family:
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    "Helvetica Neue",
    sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 34rpx;
  text-align: center;
}

.voice-listening__hint {
  font-family:
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    "Helvetica Neue",
    sans-serif;
  font-size: 24rpx; // 12px
  font-weight: 400;
  color: #999999;
  line-height: 30rpx;
  text-align: center;
}

.voice-listening__header--cancelling {
  .voice-listening__title,
  .voice-listening__hint {
    color: #c8201e;
  }
}

/* 对称圆点声纹（中心点 + 左右各 9 点，透明度渐隐） */
.voice-wave {
  display: flex;
  align-items: center;
  margin-top: 48rpx;
}

.voice-wave__dots {
  display: flex;
  align-items: center;
  gap: 16rpx; // 8px
}

.voice-wave__dots--left {
  flex-direction: row-reverse;
}

.voice-wave__center {
  flex: 0 0 auto;
  width: 16rpx; // 8px
  height: 16rpx;
  margin: 0 16rpx;
  border-radius: 50%;
  background: #c8201e;
  box-shadow: 0 0 14rpx rgba(200, 32, 30, 0.45);
  animation: voice-wave-center-pulse 0.72s ease-in-out infinite;
}

.voice-wave__dot {
  flex: 0 0 auto;
  width: 10rpx; // 5px
  height: 10rpx;
  border-radius: 50%;
  background: #c8201e;
  transform-origin: center;
  animation: voice-wave-breathe 0.72s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}

.voice-wave__dot:nth-child(1) {
  opacity: 1;
  animation-delay: 0s;
}
.voice-wave__dot:nth-child(2) {
  opacity: 0.86;
  animation-delay: 0.05s;
}
.voice-wave__dot:nth-child(3) {
  opacity: 0.7;
  animation-delay: 0.1s;
}
.voice-wave__dot:nth-child(4) {
  opacity: 0.52;
  animation-delay: 0.15s;
}
.voice-wave__dot:nth-child(5) {
  opacity: 0.36;
  animation-delay: 0.2s;
}
.voice-wave__dot:nth-child(6) {
  opacity: 0.24;
  animation-delay: 0.25s;
}
.voice-wave__dot:nth-child(7) {
  opacity: 0.15;
  animation-delay: 0.3s;
}
.voice-wave__dot:nth-child(8) {
  opacity: 0.08;
  animation-delay: 0.35s;
}
.voice-wave__dot:nth-child(9) {
  opacity: 0.04;
  animation-delay: 0.4s;
}

@keyframes voice-wave-breathe {
  0%,
  100% {
    transform: scaleY(0.75) scaleX(0.85);
  }
  50% {
    transform: scaleY(3) scaleX(1.15);
  }
}

@keyframes voice-wave-center-pulse {
  0%,
  100% {
    transform: scale(0.9);
  }
  50% {
    transform: scale(1.45);
  }
}

/* 麦克风（按住说话） */
.voice-listening__mic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx; // 84px 触达区，视觉 42px
  height: 168rpx;
  margin-top: 96rpx;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.voice-listening__mic-img {
  display: block;
  flex: 0 0 84rpx;
  width: 84rpx !important; // 42px
  height: 84rpx !important;

  img {
    width: 84rpx !important;
    height: 84rpx !important;
  }
}

/* ---------- 识别完成 / 编辑态 ---------- */
.voice-confirm {
  padding: 50rpx 32rpx 0;
}

.voice-sheet--keyboard-open {
  border-radius: 32rpx 32rpx 0 0;
  padding-bottom: 0;
  background: #ffffff;
  box-shadow: 0 -16rpx 48rpx rgba(51, 51, 51, 0.14);

  .voice-confirm {
    padding: 32rpx;
  }
}

.voice-confirm__box {
  position: relative;
  height: 256rpx; // 128px
  padding: 32rpx 28rpx;
  border-radius: 24rpx; // 12px
  background: #f6f6f6;
  box-sizing: border-box;
}

.voice-confirm__textarea {
  width: 100%;
  height: 192rpx;
  padding: 0;
  margin: 0;
  font-family:
    "Inter",
    "Sarasa Gothic SC",
    "PingFang SC",
    "Noto Sans SC",
    -apple-system,
    "Helvetica Neue",
    "Microsoft YaHei",
    sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 40rpx; // 20px
  background: transparent;
}

.voice-confirm__recognizing {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  border-radius: 24rpx;
  background: rgba(246, 246, 246, 0.88);
}

.voice-confirm__spinner {
  width: 30rpx;
  height: 30rpx;
  border: 4rpx solid rgba(200, 32, 30, 0.2);
  border-top-color: #c8201e;
  border-radius: 50%;
  animation: voice-confirm-spin 0.8s linear infinite;
}

@keyframes voice-confirm-spin {
  to {
    transform: rotate(360deg);
  }
}

.voice-confirm__recognizing-text {
  color: #999999;
  font-size: 24rpx;
}

.voice-confirm__actions {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 142rpx 72rpx 74rpx;
}

.voice-confirm__actions--recognizing {
  pointer-events: none;
  opacity: 0.45;
}

.voice-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;

  &:active {
    opacity: 0.8;
  }
}

.voice-action--ghost {
  width: 72rpx; // 36px
  height: 72rpx;
}

.voice-action--send {
  width: 96rpx; // 48px
  height: 96rpx;
}

.voice-action--recording {
  opacity: 0.6;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

.voice-action__icon {
  display: block;
  width: 72rpx;
  height: 72rpx;
}

.voice-action__icon--send {
  width: 100rpx;
  height: 100rpx;
  transform: translateY(-32rpx);
}

// 整条输入栏就是那颗胶囊：加号、语音、发送都收在里面
.input-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  min-height: 112rpx;
  margin: 0 32rpx 12rpx;
  padding: 10rpx 12rpx;
  box-sizing: border-box;
  border-radius: 56rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 28rpx rgba(32, 42, 60, 0.08);
}

/* 语音态输入栏：设计稿 1204:337 Toolbar（375×64）
   上下 8 / 左右 20，三项横排、间距 10 → 16rpx 40rpx，gap 20rpx，透明底 */
.input-bar:not(.input-bar--text) {
  gap: 20rpx;
  min-height: 128rpx;
  margin: 0;
  padding: 16rpx 40rpx;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.input-bar__mode {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__mode--disabled {
  opacity: 0.4;
}

.input-bar__text-field {
  flex: 1;
  min-width: 0;
  min-height: 76rpx;
  background: transparent;
  box-sizing: border-box;
}

/* ==========================================================================
   「按住说话」框：设计稿 1204:337 Toolbar
   375×44 → 750×88rpx；圆角 45 → 90rpx；底 rgba(13,13,13,0.0361)；
   文案 14px / 行高 20px / #5E5E5E / Regular；
   整块就是录音手势区（按下即录、上滑取消、松手识别）
   ========================================================================== */
.input-bar__hold {
  display: flex;
  flex: 1;
  min-width: 0;
  height: 88rpx; // 44px
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 90rpx; // 45px
  background: rgba(13, 13, 13, 0.0361);
  touch-action: none; /* 长按时禁用滚动/缩放，pointer 事件不被默认手势劫持 */
  -webkit-user-select: none;
  user-select: none;
}

.input-bar__hold-label {
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx; // 20px
  color: #0d0d0d;
  text-align: center;
}

/* 生成中（思考中）：整块「按住说话」暂时禁用 —— 不吃手势、文案转 #5E5E5E，
   与参考图里思考中的置灰态一致；生成结束（isLoading 变 false）即恢复 */
.input-bar__hold--disabled {
  pointer-events: none;
}

.input-bar__hold--disabled .input-bar__hold-label {
  color: #5e5e5e;
}

/* 识别中：同一块框内换文案，沿用原来的提示色 */
.input-bar__hold-hint {
  font-size: 24rpx; // 12px
  font-weight: 400;
  line-height: 34rpx;
  color: #999999;
  text-align: center;
}

/* 语音态右侧键盘按钮：设计稿 44×44 圆形，与加号同一底色 */
.input-bar:not(.input-bar--text) .input-bar__mode {
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
  padding: 0;
  border-radius: 50%;
  background: rgba(13, 13, 13, 0.0361);
}

/* 键盘图标：设计稿 20×20 → 40rpx */
.input-bar:not(.input-bar--text) .input-bar__mode image {
  width: 40rpx;
  height: 40rpx;
}

.input-bar__text-field {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 12rpx 10rpx;
  overflow: hidden;
}

.input-bar__text-field--padding {
  padding-left: 20rpx;
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

// 胶囊内的两颗圆按钮
.input-bar__plus,
.input-bar__mode {
  width: 76rpx;
  height: 76rpx;
  flex: 0 0 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  box-sizing: border-box;
}

// 加号：设计稿 1204:337 左侧加号 44×44（图标 icon-plus.svg 自带 3.61% 圆底与 #0D0D0D 十字）
.input-bar__plus {
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
  background: transparent;
}

.chat-input .input-bar__plus image {
  width: 88rpx;
  height: 88rpx;
}

// 语音/键盘是纯图标，底色由 CSS 给，留出内边距
.input-bar__mode {
  padding: 18rpx;
  background: #f1f2f4;
}

// 发送与停止本身就是实心图标，不再加底色
.input-bar__send,
.input-bar__stop {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.input-bar__send {
  width: 68rpx;
  height: 68rpx;
}

/* 停止按钮：参考图是「#0D0D0D 实心圆 35px + 白色 12px 圆角方块」，由 icon-stop-circle.svg 自带，
   这里只给 35px 的方形落位，与语音态 44px 的键盘钮共用同一行的 10px 间距 */
.input-bar__stop {
  flex: 0 0 70rpx;
  width: 70rpx; /* 35px */
  height: 70rpx;
  margin-right: 0;
}

.input-bar__stop image {
  width: 70rpx;
  height: 70rpx;
}

.input-bar__mode:active,
.input-bar__hold:active,
.input-bar__plus:active,
.input-bar__send:active,
.input-bar__stop:active {
  opacity: 0.7;
}

.chat-input__icon-mic {
  width: 40rpx;
  height: 40rpx;
  background: #000;
  border-radius: 20rpx;
}

.chat-input--keyboard-open .chat-input__dock {
  // 键盘挡住了 home indicator，这段安全区留白让给键盘
  padding-bottom: 0;
}

.chat-input__dock {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding-top: 16rpx;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}

// 输入栏下方提示：内容由AI生成，请核实重要信息
// 设计稿 1204:292：Toolbar 底 775 → 文字 top 783（8px = 16rpx），文字 12px #BABABA
.chat-input__footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 16rpx;
}

.chat-input__footer-text {
  width: 100%;
  margin-bottom: 30rpx; // 文字底到页面底边 15px
  color: #bababa;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  text-align: center;
}

// 透明层，只负责接住「点空白收键盘」，铺满全屏。
// 铺满是有意为之：键盘真在的时候，它盖住的那段区域触摸事件归输入法，我们收不到；
// 一旦这段区域的点击落到遮罩上，反过来证明键盘已经收了（安卓返回键收起输入法时
// 既不 blur 也无视口变化，只能靠这个反推）。
// 用 touchstart + preventDefault：走 tap 的话遮罩在 touchend 时就被移除了，
// webview 随后补发的 click 会落到下面刚归位的加号按钮上，凭空弹出附件面板。
.chat-input__keyboard-mask {
  position: fixed;
  z-index: 1;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: transparent;
}

.chat-input__home-indicator-wrap {
  width: 100%;
  padding: 0 240rpx 16rpx;
  box-sizing: border-box;
}

/* ==========================================================================
   文本态输入栏（设计稿：灰色胶囊 + 右侧切换）
   - 无文字：胶囊右侧是深色声波（切到语音）
   - 有文字：胶囊右侧是黑圆上箭头（发送）
   只在 .input-bar--plain 下生效，生成中 / 语音态维持原样。
   换算：1px = 2rpx。胶囊高 44、加号 44（与首次一致）、切换图标 20（同语音态键盘图标）、
   发送黑圆 35、左右内边距 16。

   外层盒模型必须与语音态（1204:337 Toolbar）逐项对齐 —— margin 0、padding 16/40、gap 20、
   min-height 128，否则切到键盘的那一帧整行会变宽变高，看着像抖一下。
   ========================================================================== */
.input-bar.input-bar--plain {
  position: relative;
  gap: 20rpx; // 10px，与语音态一致
  min-height: 128rpx; // 64px，与语音态一致（内容 88 + 上下 16*2，撑到 128）
  margin: 0;
  padding: 16rpx 40rpx;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

/* 加号：与首次的加号同尺寸（44px 圆底由 icon-plus.svg 自带） */
.chat-input .input-bar--plain .input-bar__plus {
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
}

.chat-input .input-bar--plain .input-bar__plus image {
  width: 88rpx;
  height: 88rpx;
}

/* 灰色胶囊本体：#F3F3F3，高 44，r22，左内边距 16
   右侧留出切换钮的位置（钮画在胶囊内部，不再单独占一列） */
.chat-input .input-bar--plain .input-bar__text-field {
  min-height: 88rpx;
  padding: 0 130rpx 0 32rpx;
  border-radius: 44rpx;
  background: #f3f3f3;
  box-sizing: border-box;
}

.chat-input .input-bar--plain .input-bar__textarea {
  font-size: 28rpx; // 14px，与首次输入文字一致
  line-height: 40rpx;
  color: #0d0d0d;
}

.chat-input .input-bar--plain .input-bar__placeholder {
  font-size: 28rpx;
  color: #8e8e8e;
}

/* 右侧切换钮：画在灰色胶囊内部右侧，不额外占列
   外层 padding 与语音态一致（40rpx = 20px），胶囊右边缘就在 40rpx 处，
   钮再内缩 20rpx → right 60rpx，与胶囊右边缘留 10px 呼吸位 */
.chat-input .input-bar--plain .input-bar__mode,
.chat-input .input-bar--plain .input-bar__send {
  position: absolute;
  top: 50%;
  right: 60rpx; // 30px = 胶囊右边缘 20px + 内缩 10px
  width: 70rpx; // 35px
  height: 70rpx;
  flex: 0 0 70rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  transform: translateY(-50%);
}

/* 切换图标：与语音态胶囊里的键盘图标同尺寸（20px） */
.chat-input .input-bar--plain .input-bar__mode image {
  width: 40rpx; // 20px
  height: 40rpx;
}

.chat-input .input-bar--plain .input-bar__send image {
  width: 70rpx; // 35px，与按钮同大
  height: 70rpx;
}

/* 附件来源弹窗样式随组件走：src/components/ai-attachment-picker/index.vue */
</style>

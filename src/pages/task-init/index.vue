<script setup lang="ts">
import type { WakeStep, WakeValidateResult } from "@/api/chat/types";
import type { FlowStep, FlowStepOption, FlowStepsParams } from "@/api/flow";
import type { VisitorRole } from "@/stores/modules/user";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl, validateWakeWord } from "@/api/chat";
import { getFlowSteps } from "@/api/flow";
import brandLogo from "@/assets/img/header-island-logo.png";
import { usePlainTts } from "@/hooks/usePlainTts";
import { useUserStore } from "@/stores";
import { VISITOR_ROLE_ACCOUNTS } from "@/stores/modules/user";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission } from "@/utils/platform/mpaas";
import VoiceRecorder from "@/utils/voiceRecorder.js";

/**
 * 任务协同初始化页（Ardot 350:1052 SANI 自我介绍 / 350:964 选择身份 / 350:1119、1204、1288 调度员信息）。
 *
 * 实现与「作业指导初始化页」同一套骨架：唤醒帧 → 自我介绍 → 步骤页，步骤的标题 / 提示 / 选项全部来自
 * GET /flow/steps?module=TASK，页面只负责按 stepCode 选版式与推进：
 *   WELCOME（Hey,SANI 招呼帧，说「你好三一」唤醒）→ HEY（自我介绍）
 *   → IDENTITY（选择身份）→ IDENTITY_DETAIL（身份信息）→ 进任务协同。
 *
 * 两个接口各管一件事：
 *   - GET  /flow/steps?module=TASK：每一步的 title / hint / options（options 按 sortNo 升序）。
 *     选中身份后带上 roleCode 再拉一次，拿到该身份的 IDENTITY_DETAIL（标题 + 胶囊）；
 *   - POST /speech/wake/validate：长按说话 → ASR 文本 + 当前 step 送后端比热词。
 *     命中（matched）读 currentStep 前进；BACK 读 targetStep 回退（null 表示已在 HEY，不跳转）；
 *     未命中播报兜底话术（fallbackTexts 按 fallbackRound 循环），有效选择后轮次归零；
 *   - 点选选项不经过校验接口，按同一条链推进，保证没有麦克风时也能走完全程。
 *
 * stepCode → 版式：
 *   - IDENTITY / IDENTITY_DETAIL 都是三颗胶囊（设计稿 350:964 身份卡 / 350:1119 信息胶囊）；
 *   - 其它/新增 stepCode 先按胶囊版式兜底，接口加了新步骤也不会白屏。
 *
 * 标题里的 {name} 取当前用户名（游客态用设计稿占位名）。
 *
 * 版面取设计稿 375×812（含 54 高状态栏）：所有 y 已扣掉状态栏，换算成 rpx（1px = 2rpx），
 * 外层再用安全区高度做偏移，保证刘海屏下标题仍落在设计稿位置。
 *
 * 多语言：接口文案按后端语言返回，前端兜底文案走 i18n（zh_CN / en_US）。英文比中文长，
 * 所以标题只定左边距、右边留白；胶囊「按最小宽度撑开 + 最大宽度约束」，换行变高而不溢出。
 *
 * 收尾：把身份写进 store（visitorRole）后直接回首页（/pages/index/index?mode=demo，
 * 与「选择体验身份」页进首页同一套参数），不再进任务协同页，也不经过 IDENTITY_DETAIL。
 */
defineOptions({ name: "AiTaskInitPage" });

const logger = createLogger("task-init-page");
const { t, locale } = useI18n();
const userStore = useUserStore();

/** /flow/steps 的模块名：任务协同 */
const FLOW_MODULE = "TASK";

/**
 * 流程链：与任务协同的 step 取值一一对应。
 * WELCOME（Hey,SANI 招呼帧）/ HEY（自我介绍）由前端固定，与作业指导初始化页同一套视觉；
 * 中间两步的文案与选项全部来自 /flow/steps；
 * RECOMMEND 不在本页渲染——选完身份信息直接进任务协同页。
 * 接口没下发某一步时自动跳过，不会出现白屏页。
 */
const STEP_WELCOME = "WELCOME";
const STEP_HEY = "HEY";
const STEP_IDENTITY = "IDENTITY";
const STEP_IDENTITY_DETAIL = "IDENTITY_DETAIL";
const STEP_RECOMMEND = "RECOMMEND";
const FLOW_CHAIN: string[] = [
  STEP_WELCOME,
  STEP_HEY,
  STEP_IDENTITY,
  STEP_IDENTITY_DETAIL,
  STEP_RECOMMEND,
];
/** 前端固定帧：没有接口步骤，链上永远可进入 */
const FRONT_STEPS = new Set<string>([STEP_WELCOME, STEP_HEY]);
/**
 * 自我介绍什么时候进第一步：**等这段口播播完**再进。
 * 三个时长各管一件事，不能混着用：
 * - INTRO_MIN_VISIBLE_MS：画面至少露这么久，避免一句话还没看清就跳走；
 * - INTRO_FALLBACK_MS：**只在没开声时**生效（被 WebView 拦自动播放 / TTS 接口失败），
 *   一出声就必须撤掉 —— 否则它会把还没播完的句子硬切掉，看起来就是「语音没播完就跳帧」；
 * - INTRO_MAX_WAIT_MS：开声后的兜底之兜底，个别 WebView 不触发 onEnded 时别把页面卡死。
 */
const INTRO_MIN_VISIBLE_MS = 1600;
const INTRO_FALLBACK_MS = 6000;
const INTRO_MAX_WAIT_MS = 20000;
/** 选中态亮一下再切下一步，避免点下去没有反馈 */
const SELECT_DELAY_MS = 220;

/**
 * 气泡槽位（选择身份，设计稿 350:964）：三颗 82px 的圆，直径 164rpx，
 * 位置按设计稿「右上 / 左中 / 右下」分布。
 */
const TASK_BUBBLES = [
  { left: 489, top: 486, size: 164 },
  { left: 55, top: 621, size: 164 },
  { left: 489, top: 911, size: 164 },
];

/** 装饰虚化球：不参与交互，只补设计稿里的层次 */
const GHOST_BUBBLES = [
  { key: "dot-a", fill: ["#e7eaff", "#f0f2ff"], left: 210, top: 540, size: 60 },
  { key: "dot-b", fill: ["#e3f5ff", "#f1faff"], left: 636, top: 740, size: 52 },
  { key: "dot-c", fill: ["#def1fc", "#f1faff"], left: 96, top: 878, size: 44 },
];

/**
 * 胶囊槽位（身份信息，设计稿 350:1119）：按内容撑开，同时给每颗一个最大宽度，
 * 长文案在自己的槽位里折行，不会压到旁边那颗。
 */
const TASK_PILL_SLOTS = [
  { left: 77, top: 627, minWidth: 200, maxWidth: 360 },
  { left: 485, top: 666, minWidth: 180, maxWidth: 249 },
  { left: 57, top: 934, minWidth: 220, maxWidth: 380 },
];

/** 身份页标题里的称呼：游客态没有昵称时用设计稿的占位名 */
const visitorName = computed(() => String(userStore.username || "").trim() || t("task-init-guest"));

/** 保险丝：接口没回来 / 失败时用的设计稿步骤，stepCode 与接口一致，走同一条渲染链路 */
const FALLBACK_STEPS = computed<FlowStep[]>(() => [
  {
    stepCode: STEP_IDENTITY,
    title: t("task-init-identity-title", { name: visitorName.value }),
    hint: t("task-init-hint-identity"),
    options: [
      { label: t("task-init-role-site"), bubbleType: "STATIC", hitValue: "SITE_DISPATCHER", sortNo: 1 },
      { label: t("task-init-role-pump"), bubbleType: "STATIC", hitValue: "PUMPING_DISPATCHER", sortNo: 2 },
      { label: t("task-init-role-plant"), bubbleType: "STATIC", hitValue: "PLANT_DISPATCHER", sortNo: 3 },
    ],
  },
  {
    stepCode: STEP_IDENTITY_DETAIL,
    title: t("task-init-detail-title"),
    hint: t("task-init-hint-detail"),
    options: [
      { label: t("task-init-detail-pill-late"), bubbleType: "STATIC", hitValue: "TRUCK_LATE", sortNo: 1 },
      { label: t("task-init-detail-pill-pour"), bubbleType: "STATIC", hitValue: "POUR_AFFECTED", sortNo: 2 },
      { label: t("task-init-detail-pill-risk"), bubbleType: "STATIC", hitValue: "POUR_RISK", sortNo: 3 },
    ],
  },
]);

/** 接口返回的步骤；空数组时整页走 FALLBACK_STEPS */
const flowSteps = ref<FlowStep[]>([]);
/** 当前所在的 step：WELCOME / HEY / IDENTITY / IDENTITY_DETAIL / RECOMMEND */
const activeStep = ref(STEP_WELCOME);
/** 当前处于「已选中」反馈态的选项（hValue） */
const selectedKey = ref("");
/** 已选答案：stepCode → hValue（IDENTITY 的 hValue 就是 roleCode） */
const answers = ref<Record<string, string>>({});
/** 选中的身份：hValue 是拉 IDENTITY_DETAIL 用的 roleCode，label 用于兜底展示 */
const pickedRole = ref<{ hitValue: string; label: string } | null>(null);
/**
 * 兜底话术轮次：未命中时随 fallbackRound 递增，按 fallbackTexts 顺序循环；
 * 有效选择（命中 / 点选 / 换页）后重置为 0。
 */
const fallbackRound = ref(0);
/** 按住说话中：页面停止播报、选项不可点 */
const isRecording = ref(false);
/** 松手后的识别 / 校验中：底部保持录音那套波纹，等接口回结果 */
const isChecking = ref(false);
/** 用户已经用语音交互过：唤醒页不再因为「播报停了」自动往下走（等接口结果决定去向） */
let voiceInteracted = false;
/** 长按已进入录音：松手后补出来的 tap 要吞掉，不能当成「跳过唤醒页」 */
let holdFired = false;
/** 跳转中标记：收尾只执行一次 */
let navigating = false;

let introTimer: ReturnType<typeof setTimeout> | null = null;
let selectTimer: ReturnType<typeof setTimeout> | null = null;

/** 英文文案比中文长，字号与行高单独收一档，避免气泡 / 胶囊被撑破 */
const isEnglish = computed(() => String(locale.value || "").toLowerCase().startsWith("en"));

/**
 * 语音播报：与首页 / 欢迎页共用同一套（usePlainTts → POST /speech/tts/stream），
 * 每一步出现时口播标题；播报期间底部三色带波浪流动，播完回到设计稿的静态基线。
 */
const introTts = usePlainTts(isEnglish.value ? "en" : "zh");
/** 模板里直接用：true 时底部波浪进入流动 + 摆动（与首页 speaking-wave 一致） */
const speaking = introTts.playing;

/** stepCode → step：接口优先，接口为空时用设计稿兜底；未知 stepCode 也留在表里（接口加了新步骤不白屏） */
const stepMap = computed<Record<string, FlowStep>>(() => {
  const map: Record<string, FlowStep> = {};
  const list = flowSteps.value.length ? flowSteps.value : FALLBACK_STEPS.value;
  list.forEach((step) => {
    const code = String(step?.stepCode || "").trim().toUpperCase();
    if (code) map[code] = step;
  });
  return map;
});

/** 首帧 Hey,SANI 招呼帧：说「你好三一」唤醒后进入自我介绍 */
const isWelcomeStep = computed(() => activeStep.value === STEP_WELCOME);
/** 自我介绍帧（HEY）由前端固定占位，没有接口步骤 */
const isWakeStep = computed(() => activeStep.value === STEP_HEY);
const currentStep = computed(() => (
  isWelcomeStep.value || isWakeStep.value ? null : stepMap.value[activeStep.value] || null
));

/** 标题左边距按设计稿：选择身份 34 / 身份信息 37（px → rpx） */
const TITLE_LEFTS: Record<string, number> = {
  [STEP_IDENTITY]: 68,
  [STEP_IDENTITY_DETAIL]: 74,
};

const titleLeft = computed(() => {
  const code = String(currentStep.value?.stepCode || "").toUpperCase();
  return TITLE_LEFTS[code] ?? TITLE_LEFTS[STEP_IDENTITY];
});

/** stepCode 决定用哪套版式：选择身份是气泡，其余（身份信息）是胶囊 */
type Layout = "bubbles" | "pills";

function layoutOf(stepCode: string): Layout {
  return String(stepCode || "").toUpperCase() === STEP_IDENTITY ? "bubbles" : "pills";
}

const currentLayout = computed(() => layoutOf(currentStep.value?.stepCode || ""));

/** 当前版式的槽位表 */
const currentSlots = computed(() => (currentLayout.value === "bubbles" ? TASK_BUBBLES : TASK_PILL_SLOTS));

/**
 * 当前步骤的选项：过滤空文案、按 sortNo 升序，并按槽位数截断。
 * label 展示、hValue 是答案（IDENTITY 即 roleCode），与接口约定一致。
 */
const currentOptions = computed(() => {
  const step = currentStep.value;
  if (!step) return [];
  return [...(Array.isArray(step.options) ? step.options : [])]
    .filter(option => String(option?.label || "").trim())
    .sort((a, b) => (Number(a.sortNo) || 0) - (Number(b.sortNo) || 0))
    .slice(0, currentSlots.value.length);
});

/** step 码统一大写，接口与 i18n 兜底都用同一套写法 */
function normalizeStep(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

/**
 * 选项的命中值：接口字段是 hValue，老字段是 hitValue，两者都兼容；
 * 没有命中值时退回 label（点选至少能推进流程）。
 */
function optionValue(option: FlowStepOption) {
  return String(option?.hValue ?? option?.hitValue ?? option?.label ?? "").trim();
}

/** 某一步在本页是否真有可交互内容（有步骤且有选项）；没有就顺延，避免出现只有标题的空白页 */
function hasStepContent(code: string) {
  const step = stepMap.value[normalizeStep(code)];
  return Boolean(step && Array.isArray(step.options) && step.options.length);
}

/**
 * 从 from 往后找第一个「本页真有内容」的 step：
 * 前端固定帧（WELCOME / HEY）与收尾的 RECOMMEND 永远可达，其余要求接口下发了该步且有选项。
 */
function nextStepAfter(from: string): string {
  const index = FLOW_CHAIN.indexOf(normalizeStep(from));
  const rest = FLOW_CHAIN.slice(index + 1);
  const found = rest.find(code => FRONT_STEPS.has(code) || code === STEP_RECOMMEND || hasStepContent(code));
  return found || STEP_RECOMMEND;
}

/** 换页：换页即视为一次有效选择，兜底轮次归零 */
function switchTo(code: string) {
  if (activeStep.value === code) return;
  activeStep.value = code;
  fallbackRound.value = 0;
  selectedKey.value = "";
}

/**
 * 跳到某个 step。
 * - 前进：接口命中后读 currentStep；
 * - 回退：intent = BACK 时读 targetStep，null / 空表示已在 HEY，按文档不跳转；
 * - 接口给的是本页没下发内容的步骤（例如 INTRO 没配置、或后端还有 SAN 自检这类本页不渲染的 step）时，
 *   顺延到下一个有内容的步骤，不出现空白页；
 * - 链走完（RECOMMEND）不在本页渲染，直接进作业指导页。
 */
function goToStep(target: string, from = activeStep.value) {
  const code = normalizeStep(target);
  if (code === STEP_WELCOME) {
    switchTo(STEP_WELCOME);
    return;
  }
  if (code === STEP_HEY) {
    enterIntroFrame();
    return;
  }
  if (code === STEP_RECOMMEND) {
    finish();
    return;
  }
  if (FLOW_CHAIN.includes(code) && hasStepContent(code)) {
    switchTo(code);
    return;
  }
  const next = nextStepAfter(FLOW_CHAIN.includes(code) ? code : from);
  if (next === STEP_RECOMMEND) {
    finish();
    return;
  }
  switchTo(next);
}

/** 识别文本命中某个选项值时，回查它的展示文案（身份即 roleCode，收尾时写进 store） */
function findOptionLabel(stepCode: string, hitValue: string) {
  const step = stepMap.value[normalizeStep(stepCode)];
  const options = Array.isArray(step?.options) ? step.options : [];
  const matched = options.find(option => optionValue(option) === hitValue);
  return String(matched?.label || "").trim();
}

/**
 * 步骤表被接口替换后，当前所在的 step 可能已经没有内容：
 * 顺延到下一个有内容的步骤，不留在空白页上。
 */
watch(stepMap, () => {
  if (isWelcomeStep.value || isWakeStep.value) return;
  if (hasStepContent(activeStep.value)) return;
  const next = nextStepAfter(activeStep.value);
  if (next === STEP_RECOMMEND) finish();
  else switchTo(next);
});

/** 标题占位符补值：接口只给模板（{name}） */
function fillTitle(raw: string) {
  return String(raw || "")
    .replace(/\{\s*name\s*\}/g, visitorName.value)
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const currentTitle = computed(() => (
  currentStep.value ? fillTitle(currentStep.value.title) : t("task-init-welcome-title")
));

/** 底部提示：接口 hint 为空时用设计稿文案兜底，保证这一步不会突然少了那行说明 */
const currentHint = computed(() => {
  const step = currentStep.value;
  if (!step) return "";
  const hint = String(step.hint || "").trim();
  if (hint) return fillTitle(hint);
  const code = String(step.stepCode || "").toUpperCase();
  if (code === STEP_IDENTITY) return t("task-init-hint-identity");
  if (code === STEP_IDENTITY_DETAIL) return t("task-init-hint-detail");
  return "";
});

/** 副标题按行拆开：渐变逐行铺满（与首页 welcome-visitor__intro-line 同一套做法） */
const subtitleLines = computed(() =>
  String(t("task-init-welcome-subtitle") || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean),
);

/**
 * 本步要口播的整段话：自我介绍是「标题 + 副标题」两句，步骤态是接口给的 title。
 * 拼成一段送 TTS，画面上有多少字就念多少。
 */
const narration = computed(() => {
  // 首帧招呼页不自动开口：等用户长按说「你好三一」唤醒后再播自我介绍
  if (isWelcomeStep.value) return "";
  if (isWakeStep.value) {
    return [t("task-init-welcome-title"), ...subtitleLines.value]
      .map(line => String(line || "").trim())
      .filter(Boolean)
      .join(isEnglish.value ? ", " : "，");
  }
  return currentTitle.value;
});

/**
 * 文案一变就口播：一句新题目自动打断上一句，用户点选后紧跟着念下一步，
 * 与首页「答案一开始渲染就听播」同一套时机（不额外等接口 / 动画）。
 */
watch(narration, (text) => {
  const content = String(text || "").trim();
  if (content) introTts.speak(content);
}, { immediate: true });

/** 自我介绍露出的时刻：用来保证「播完再进」时画面至少露够 INTRO_MIN_VISIBLE_MS */
let introShownAt = Date.now();

function clearIntroAdvance() {
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }
}

/**
 * 进入自我介绍帧：切页 + 记露出时刻 + 起兜底计时器（口播没起来时 6s 后也能进下一步）。
 */
function enterIntroFrame() {
  const already = activeStep.value === STEP_HEY;
  switchTo(STEP_HEY);
  if (!already) introShownAt = Date.now();
  // 唤醒结果已经落地（招呼帧「你好三一」命中 / 点屏幕跳过）：这一帧回到「播完再进」的默认节奏，
  // 否则 voiceInteracted 还把 speaking 的收尾挡着，自我介绍只能被兜底计时器硬切
  voiceInteracted = false;
  clearIntroAdvance();
  introTimer = setTimeout(advanceToFirstStep, INTRO_FALLBACK_MS);
}

/** 招呼 / 自我介绍收尾：进链上的下一步（点屏幕 / 语音命中都会提前走到这里） */
function advanceToFirstStep() {
  clearIntroAdvance();
  if (isWelcomeStep.value) {
    enterIntroFrame();
    return;
  }
  if (isWakeStep.value) goToStep(nextStepAfter(STEP_HEY), STEP_HEY);
}

/**
 * 唤醒页只在「口播真的播完」时才走：
 * - on = true（开始出声）：立刻撤掉「没开声」的兜底，否则 6s 一到就把正在念的句子切了；
 *   同时换成 20s 硬上限，防止个别 WebView 不发 onEnded 把页面挂死；
 * - on = false（播完 / 排队清空）：画面露够 INTRO_MIN_VISIBLE_MS 后进下一步。
 */
watch(speaking, (on) => {
  if (!isWakeStep.value) return;
  // 用户已经开口（起录会主动打断播报）/ 正在校验：播报停了也不能把页面推走，
  // 去向由 /speech/wake/validate 的结果决定
  if (voiceInteracted || isRecording.value || isChecking.value) return;
  clearIntroAdvance();
  if (on) {
    introTimer = setTimeout(advanceToFirstStep, INTRO_MAX_WAIT_MS);
    return;
  }
  const visibleFor = Date.now() - introShownAt;
  introTimer = setTimeout(advanceToFirstStep, Math.max(0, INTRO_MIN_VISIBLE_MS - visibleFor));
});

/**
 * 气泡文案按字数断开：设计稿是「工地 / 调度员」「泵送公司 / 调度主管」这种两行版式，
 * 中文按一半字数断行（5 字 → 2+3，8 字 → 4+4），英文交给 word-break 按词断。
 */
function wrapBubbleLabel(label: string) {
  const text = String(label || "").trim();
  if (!text || text.includes("\n")) return text;
  if (!/^[\u4E00-\u9FA5，。！？、]+$/.test(text)) return text;
  const half = Math.floor(text.length / 2);
  if (half <= 0) return text;
  return `${text.slice(0, half)}\n${text.slice(half)}`;
}

function bubbleStyle(item: { left: number; top: number; size: number }) {
  return {
    left: `${item.left}rpx`,
    top: `${item.top}rpx`,
    width: `${item.size}rpx`,
    height: `${item.size}rpx`,
  };
}

/**
 * 胶囊宽度不写死：中文与设计稿同宽，接口那种长 label / 英文按 max-width 折行，
 * 胶囊变高而不是顶出屏幕；maxWidth 同时受槽位列宽与屏幕右侧约束。
 */
function pillStyle(item: { left: number; top: number; minWidth: number; maxWidth?: number }) {
  const available = 750 - item.left - 16;
  const max = Math.min(item.maxWidth ?? available, available);
  return {
    left: `${item.left}rpx`,
    top: `${item.top}rpx`,
    minWidth: `${item.minWidth}rpx`,
    maxWidth: `${max}rpx`,
  };
}

/* ---------------- 语音：长按说话 → ASR → /speech/wake/validate ---------------- */

/** 长按多久算「开始说话」（更短的按压当误触，松手不识别） */
const HOLD_START_MS = 300;
/** 按住期间位移超过这个距离视为滑动，不进入录音态 */
const HOLD_MOVE_PX = 12;
/** ASR 兜底超时：上传接口的 timeout 在个别容器里不生效 */
const ASR_TIMEOUT_MS = 30_000;
/** 校验超时：超过就按未命中处理，别让页面一直停在「校验中」 */
const WAKE_VALIDATE_TIMEOUT_MS = 8_000;

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

let recorder: RecorderLike | null = null;
/** 录音会话序号：松手 / 取消 / 卸载后，旧的异步回调一律作废 */
let recordSeq = 0;
/** 当前这次按压的启动过程：松手时可能还在申请权限，要等它 */
let recordJob: { seq: number; start: Promise<RecorderResult | null>; step: string } | null = null;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdStartX = 0;
let holdStartY = 0;

function ensureRecorder(): RecorderLike {
  if (!recorder) recorder = new VoiceRecorder() as unknown as RecorderLike;
  return recorder;
}

/** 三个识别入口按拿到的音频形态走，与项目里其它语音入口保持一致 */
function requestRecognition(audio: { filePath?: string; audioUrl?: string; audioBase64?: string; mimeType?: string }) {
  if (audio.audioUrl) return recognizeSpeechByUrl({ audioUrl: audio.audioUrl });
  if (audio.audioBase64) return recognizeSpeechByBase64({ audioBase64: audio.audioBase64, mimeType: audio.mimeType });
  return recognizeSpeechByUpload({ filePath: audio.filePath || "", timeout: ASR_TIMEOUT_MS });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function clearHoldTimer() {
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = null;
}

/** 进入录音态时开始录；失败只记日志，流程照走（用户可以改用点选） */
function startRecording() {
  const seq = ++recordSeq;
  const step = activeStep.value;
  const start = (async () => {
    const granted = await ensureNativePermission("record_audio");
    if (seq !== recordSeq) return null;
    if (!granted) {
      logger.warn("mic permission denied, skip guide recording");
      return null;
    }
    const result = await ensureRecorder().start({ sampleRate: 16000, timeSlice: 1000 });
    if (seq !== recordSeq) return result;
    if (!result?.success) logger.warn("guide recorder start failed", result?.error);
    return result;
  })().catch((error) => {
    logger.warn("guide recorder start failed", error);
    return null;
  });
  recordJob = { seq, start, step };
}

function cancelRecording() {
  recordSeq += 1;
  recordJob = null;
  try {
    recorder?.cancel();
  }
  catch (error) {
    logger.warn("guide recorder cancel failed", error);
  }
}

/**
 * 松手：停录 → 语音识别 → 送 `/speech/wake/validate`。
 * 识别不出文字 / 识别失败都按未命中处理（页面停在当前 step，用户可重试或点选）。
 */
async function stopRecordingAndRecognize() {
  const job = recordJob;
  recordJob = null;
  if (!job) {
    isChecking.value = false;
    return;
  }
  const { seq, start, step } = job;

  try {
    const started = await start;
    if (seq !== recordSeq) return;
    if (!started?.success) {
      isChecking.value = false;
      return;
    }

    const result = await ensureRecorder().stop();
    if (seq !== recordSeq) return;
    if (!result?.success || result?.cancelled) {
      isChecking.value = false;
      if (!result?.cancelled) logger.warn("guide recorder stop failed", result?.error);
      return;
    }

    const { tempFilePath, audioUrl, audioBase64, mimeType } = result.data || {};
    if (!tempFilePath && !audioUrl && !audioBase64) {
      isChecking.value = false;
      return;
    }

    const response = await withTimeout(requestRecognition({ filePath: tempFilePath, audioUrl, audioBase64, mimeType }), ASR_TIMEOUT_MS);
    if (seq !== recordSeq) return;
    const text = String(response?.text || "").trim();
    logger.info("guide asr result", { step, text });
    if (!text) {
      isChecking.value = false;
      return;
    }
    await validateVoiceText(seq, text, step);
  }
  catch (error) {
    logger.warn("guide speech recognize failed", error);
    if (seq === recordSeq) isChecking.value = false;
  }
}

/** 当前页面的 step 即校验接口的 step（HEY / IDENTITY / IDENTITY_DETAIL） */
async function validateVoiceText(seq: number, text: string, step: string) {
  try {
    const result = await withTimeout(
      validateWakeWord({
        module: FLOW_MODULE,
        // 招呼帧对应后端的唤醒页 HEY；其它帧直接用当前 step
        step: (normalizeStep(step) === STEP_WELCOME ? STEP_HEY : step) as WakeStep,
        text,
        fallbackRound: fallbackRound.value,
      }),
      WAKE_VALIDATE_TIMEOUT_MS,
    );
    // 期间又按了一次 / 取消 / 卸载：这次结果作废
    if (seq !== recordSeq) return;
    logger.info("guide wake validate result", {
      step,
      matched: result?.matched,
      hitWord: result?.hitWord,
      hitValue: result?.hitValue,
      intent: result?.intent,
      targetStep: result?.targetStep,
      currentStep: result?.currentStep,
      defaultHint: result?.defaultHint,
    });
    isChecking.value = false;
    applyValidateResult(result, step);
  }
  catch (error) {
    logger.warn("guide wake validate failed", error);
    if (seq === recordSeq) isChecking.value = false;
  }
}

/** 播报兜底话术：优先用后端这一轮给的 defaultHint，否则按 fallbackTexts 顺序循环 */
function speakFallback(result?: WakeValidateResult | null) {
  const texts = (Array.isArray(result?.fallbackTexts) ? result?.fallbackTexts : [])
    .map(item => String(item || "").trim())
    .filter(Boolean);
  const hint = String(result?.defaultHint || result?.fallbackText || "").trim();
  const round = fallbackRound.value;
  const text = hint || (texts.length ? texts[round % texts.length] : "");
  if (texts.length) fallbackRound.value = round + 1;
  if (!text) return;
  logger.info("guide fallback", { round, text });
  introTts.speak(text);
}

/**
 * 校验结果 → 页面动作，严格按文档：
 * - BACK：读 targetStep 回退，null / 空表示已在 HEY，不跳转；
 * - matched：读 currentStep 前进（带 hitValue 时先把这一步的答案记下来）；
 * - 未命中：播报兜底话术，页面不动，fallbackRound +1，有效选择后归零。
 */
function applyValidateResult(result: WakeValidateResult | null | undefined, step: string) {
  const matched = Boolean(result?.matched ?? result?.success);
  const intent = normalizeStep(result?.intent);
  const localStep = normalizeStep(step);

  // 首帧招呼页：命中就进自我介绍帧；已在第一帧，BACK 无处可退直接忽略
  if (localStep === STEP_WELCOME) {
    if (matched && intent !== "BACK") {
      fallbackRound.value = 0;
      enterIntroFrame();
      return;
    }
    if (!matched) speakFallback(result);
    return;
  }

  if (matched && intent === "BACK") {
    fallbackRound.value = 0;
    const target = normalizeStep(result?.targetStep);
    if (!target) return;
    introTts.stop();
    goToStep(target, step);
    return;
  }

  if (!matched) {
    speakFallback(result);
    return;
  }

  const hitValue = String(result?.hitValue ?? "").trim();
  const code = normalizeStep(step);
  if (hitValue && stepMap.value[code]) {
    fallbackRound.value = 0;
    void applySelection(code, hitValue, findOptionLabel(code, hitValue) || hitValue);
    return;
  }

  fallbackRound.value = 0;
  const next = normalizeStep(result?.currentStep)
    || normalizeStep(result?.targetStep)
    || nextStepAfter(step);
  goToStep(next, step);
}

function readPoint(e: any) {
  const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(point?.clientX ?? 0), y: Number(point?.clientY ?? 0) };
}

/** 按住 300ms 进入录音态（期间位移过大视为滑动，不起录） */
function onHoldStart(e: any) {
  if (isRecording.value || isChecking.value) return;
  holdFired = false;
  voiceInteracted = true;
  // 用户开口了：撤掉「自我介绍播完自动进下一步」的计时器
  clearIntroAdvance();
  const point = readPoint(e);
  holdStartX = point.x;
  holdStartY = point.y;
  clearHoldTimer();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    holdFired = true;
    isRecording.value = true;
    // 起录即打断播报，别让题目盖住用户说话、也别被 ASR 录进去
    introTts.stop();
    startRecording();
  }, HOLD_START_MS);
}

function onHoldMove(e: any) {
  if (isRecording.value || !holdTimer) return;
  const point = readPoint(e);
  if (Math.abs(point.x - holdStartX) > HOLD_MOVE_PX || Math.abs(point.y - holdStartY) > HOLD_MOVE_PX) {
    clearHoldTimer();
  }
}

function onHoldEnd() {
  clearHoldTimer();
  if (!isRecording.value) return;
  isRecording.value = false;
  isChecking.value = true;
  void stopRecordingAndRecognize();
}

/** 手势被系统打断（来电、返回手势）：丢掉这次录音，页面状态复位 */
function onHoldCancel() {
  clearHoldTimer();
  if (!isRecording.value) return;
  isRecording.value = false;
  isChecking.value = false;
  cancelRecording();
}

function clearTimers() {
  if (introTimer) {
    clearTimeout(introTimer);
    introTimer = null;
  }
  if (selectTimer) {
    clearTimeout(selectTimer);
    selectTimer = null;
  }
  clearHoldTimer();
}

/** 招呼 / 自我介绍帧：点屏幕跳过（顺手掐掉还没播完的口播，别和下一步的题目叠在一起） */
function onPageTap() {
  // 长按录音松手后还会补一个 tap，别当成「跳过本帧」
  if (holdFired) {
    holdFired = false;
    return;
  }
  if (!isWelcomeStep.value && !isWakeStep.value) return;
  introTts.stop();
  advanceToFirstStep();
}

/** 选中一项：先亮一下反馈，再按流程链推进到下一步 */
function onOptionTap(item: FlowStepOption) {
  // 长按录音松手后补出来的 tap 不算点选（否则一次长按既录音又选了选项）
  if (holdFired) {
    holdFired = false;
    return;
  }
  if (isRecording.value || isChecking.value) return;
  const step = currentStep.value;
  if (!step || selectedKey.value) return;
  const hit = optionValue(item);
  if (!hit) return;
  selectedKey.value = hit;
  fallbackRound.value = 0;
  const code = normalizeStep(step.stepCode);
  const label = String(item.label || "").trim() || hit;
  selectTimer = setTimeout(() => {
    selectTimer = null;
    selectedKey.value = "";
    void applySelection(code, hit, label);
  }, SELECT_DELAY_MS);
}

/**
 * 记下这一步的答案并推进：
 * 点选与语音命中走同一条路；选中身份后**直接进首页**（module=TASK 的接口只下发 IDENTITY，
 * 身份信息那一步不参与本页流程，其余步骤仍按同一条链推进）。
 */
async function applySelection(stepCode: string, hitValue: string, label: string) {
  const code = normalizeStep(stepCode);
  if (code) answers.value = { ...answers.value, [code]: hitValue };
  const isIdentityStep = code === STEP_IDENTITY;
  if (isIdentityStep && hitValue) {
    pickedRole.value = { hitValue, label: label || hitValue };
  }

  if (isIdentityStep) {
    finish();
    return;
  }

  goToStep(nextStepAfter(code), code);
}

/** 任务协同的身份码只有落在本地 VisitorRole 里才能写进 store，其它码只记日志 */
const VISITOR_ROLE_CODES = new Set<string>(Object.keys(VISITOR_ROLE_ACCOUNTS));

/**
 * 收尾：把身份写进 store（首页按它取建议问题 / 觉醒语），随后进首页。
 * 后端给的身份码不一定等于本地 VisitorRole，对不上就保留当前值。
 */
function applyVisitorRole(roleCode: string) {
  const code = normalizeStep(roleCode);
  if (!code) return;
  if (VISITOR_ROLE_CODES.has(code)) {
    userStore.setVisitorRole(code as VisitorRole);
    return;
  }
  logger.warn("unknown task role code, keep current visitor role", code);
}

function finish() {
  if (navigating) return;
  navigating = true;
  clearTimers();
  introTts.stop();
  applyVisitorRole(pickedRole.value?.hitValue || answers.value[STEP_IDENTITY] || "");
  // 选完身份直接回首页：带 mode=demo 与「选择体验身份」页一致，首页会跳过欢迎态直接进对话
  uni.redirectTo({ url: "/pages/index/index?mode=demo" });
}

/**
 * GET /flow/steps?module=TASK：标题 / 提示 / 选项全用接口值。
 * 首次只带 module（保证一定能拿到 IDENTITY 这一步来选择身份）；
 * 选中身份后补 roleCode 再拉一遍，拿该身份的 IDENTITY_DETAIL。
 */
async function loadFlowSteps() {
  const params: FlowStepsParams = { module: FLOW_MODULE };
  const roleCode = normalizeStep(pickedRole.value?.hitValue);
  if (roleCode) params.roleCode = roleCode;

  try {
    const data = await getFlowSteps(params);
    const list = Array.isArray(data?.steps) ? data.steps : [];
    const usable = list.filter(step => String(step?.stepCode || "").trim());
    if (!usable.length) {
      logger.warn("flow steps empty, fallback to design copy");
      return;
    }
    flowSteps.value = usable;
  }
  catch (error) {
    logger.warn("failed to load task flow steps", error);
  }
}

onMounted(() => {
  introShownAt = Date.now();
  navigating = false;
  voiceInteracted = false;
  void loadFlowSteps();
  // 首帧是招呼页：不自动推进，等用户说「你好三一」唤醒（或点屏幕跳过）
  clearIntroAdvance();
});

onBeforeUnmount(() => {
  clearTimers();
  isRecording.value = false;
  isChecking.value = false;
  cancelRecording();
  introTts.stop();
});
</script>

<template>
  <view
    class="gi"
    :class="{
      'gi--en': isEnglish,
      'gi--welcome': isWelcomeStep,
      'gi--speaking': speaking,
      'gi--recording': isRecording,
      'gi--checking': isChecking,
    }"
    @tap="onPageTap"
    @touchstart="onHoldStart"
    @touchmove="onHoldMove"
    @touchend="onHoldEnd"
    @touchcancel="onHoldCancel"
    @mousedown="onHoldStart"
    @mouseup="onHoldEnd"
  >
    <!-- 背景：设计稿 #F5FCFF → #FFF 的冷色渐变 -->
    <view class="gi__bg" />

    <!-- 底部光效：与「Hey,SANI」欢迎页（welcome-visitor__glow）同一套结构与切换时机 ——
         常态贴底一缕淡蓝（62px）；播报 / 按住说话 / 校验中换成三色带波纹（118px），
         色带 + 波形遮罩横向流动 / 轮廓摆动，停下后淡回常态 -->
    <view class="gi__glow" aria-hidden="true">
      <view class="gi__glow-fade" />
      <view class="gi__glow-voice">
        <view class="gi__glow-voice-wave">
          <view class="gi__wave-band gi__wave-band--back" />
          <view class="gi__wave-band" />
        </view>
      </view>
    </view>

    <view class="gi__content">
      <!-- 首帧招呼页（与 /pages/index 欢迎页同一套视觉）：
           Hey,SANI + 三一图标 + 渐变标语，说「你好三一」唤醒后进自我介绍 -->
      <view v-if="isWelcomeStep" class="gi__brand">
        <view class="gi__brand-title">
          <text class="gi__brand-title-hey">
            {{ t("init-brand-hey") }}
          </text>
          <text class="gi__brand-title-sani">
            {{ t("init-brand-sani") }}
          </text>
        </view>
        <image class="gi__brand-logo" :src="brandLogo" mode="aspectFit" />
        <view class="gi__brand-caption">
          <text class="gi__brand-slogan">
            {{ t("init-brand-slogan") }}
          </text>
          <text class="gi__brand-desc">
            {{ t("init-brand-desc-1") }}
          </text>
          <text class="gi__brand-desc">
            {{ t("init-brand-desc-2") }}
          </text>
        </view>
      </view>

      <!-- 标题 + 自我介绍副标题同一列流式排布：
           标题按内容折行（英文比中文长，常常两行），副标题紧跟其后自然下移 ——
           两者都用写死的 top 定位时，英文标题多出的一行会直接压在副标题上 -->
      <view
        v-if="!isWelcomeStep"
        :key="`head-${activeStep}-${currentTitle}`"
        class="gi__head"
        :style="{ left: `${isWakeStep ? 106 : titleLeft}rpx` }"
      >
        <text class="gi__title">
          {{ currentTitle }}
        </text>

        <!-- 唤醒页副标题：紫 → 蓝 → 粉渐变字。
             与首页欢迎态一致，按行拆开渲染 —— 每行按自身文字宽度收缩，
             渐变才会逐行铺满（整块渲染时渐变按容器宽度铺，第二行只在蓝色区间，到不了末端的粉） -->
        <view v-if="isWakeStep" class="gi__subtitle">
          <text
            v-for="(line, index) in subtitleLines"
            :key="line"
            class="gi__subtitle-line"
            :style="{ animationDelay: `${index * 80}ms` }"
          >
            {{ line }}
          </text>
        </view>
      </view>

      <!-- 中心 SANI 图标（每步位置一致；招呼帧用品牌区自带的那张） -->
      <view v-if="!isWelcomeStep" class="gi__logo">
        <image class="gi__logo-img" :src="brandLogo" mode="aspectFit" />
      </view>

      <!-- 气泡版式：选择身份（设计稿 350:964 三颗圆） -->
      <view v-if="currentStep && currentLayout === 'bubbles'" :key="`bubbles-${activeStep}`" class="gi__layer">
        <view
          v-for="(item, index) in currentOptions"
          :key="`${optionValue(item)}-${index}`"
          class="gi__bubble"
          :class="{ 'gi__bubble--selected': selectedKey === optionValue(item) }"
          :style="{ ...bubbleStyle(TASK_BUBBLES[index]), animationDelay: `${index * 90}ms` }"
          @tap.stop="onOptionTap(item)"
        >
          <text class="gi__bubble-text">
            {{ wrapBubbleLabel(item.label) }}
          </text>
        </view>
        <view
          v-for="(item, index) in GHOST_BUBBLES"
          :key="item.key"
          class="gi__bubble gi__bubble--ghost"
          :style="{
            ...bubbleStyle(item),
            background: `linear-gradient(160deg, ${item.fill[0]} 0%, ${item.fill[1]} 100%)`,
            animationDelay: `${(index + 1) * 90}ms`,
          }"
        />
      </view>

      <!-- 胶囊版式：身份信息；未知 stepCode 也走这里 -->
      <view v-if="currentStep && currentLayout === 'pills'" :key="`pills-${activeStep}`" class="gi__layer">
        <view
          v-for="(item, index) in currentOptions"
          :key="`${optionValue(item)}-${index}`"
          class="gi__pill"
          :class="{ 'gi__pill--selected': selectedKey === optionValue(item) }"
          :style="{ ...pillStyle(TASK_PILL_SLOTS[index]), animationDelay: `${index * 90}ms` }"
          @tap.stop="onOptionTap(item)"
        >
          <text class="gi__pill-text">
            {{ item.label }}
          </text>
        </view>
      </view>

      <!-- 底部提示：招呼帧与自我介绍帧按设计稿留白，其余步骤用接口 hint -->
      <text
        v-if="!isWelcomeStep && !isWakeStep && currentHint"
        :key="`hint-${activeStep}`"
        class="gi__hint"
      >
        {{ currentHint }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 设计稿 375×812：尺寸用 rpx（1px = 2rpx），描边保留 px；
   y 坐标均已扣掉 54 高状态栏，外层用安全区高度把内容整体下移 */
.gi {
  position: relative;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  padding-top: max(var(--safe-top-px, 0px), env(safe-area-inset-top));
  overflow: hidden;
  background: #fafafa;
  font-family: "PingFang SC", "Source Han Sans CN", sans-serif;
}

.gi__bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(180deg, #f5fcff 0%, #ffffff 46%, #fbfdff 74%, #ffffff 100%),
    linear-gradient(120deg, rgba(239, 239, 255, 0.55) 0%, rgba(241, 248, 255, 0.45) 52%, rgba(250, 228, 243, 0.4) 100%);
}

/* 招呼帧与首页欢迎态一致：整页纯 #FAFAFA，底部只留那缕淡蓝光晕，不要步骤态那层冷色渐变 */
.gi--welcome .gi__bg {
  background: #fafafa;
}

/* ===== 底部光效：常态一缕淡蓝，播报时换成三色带波纹 =====
   与欢迎页 welcome-visitor__glow 完全同一套结构与切换时机：
   - __glow：贴底 120px 容器（比波形容器多留 2px 给遮罩模糊的出血），overflow hidden；
   - __glow-fade：常态 #FAFAFA → #BFDAF4 的 62px 渐变，曲线按反馈图逐段采样，上半段不过早显色；
   - __glow-voice：播报态 118px 波形容器，只靠外层 opacity 淡入淡出（避免 transition 和 keyframes 抢属性）；
   - __wave-band：11332:97 Rectangle 106 的三色带（#EBB4E9 → #56ABFA → #9795E8），
     用 voice-listening-wave-blur-mask.svg 的波形遮罩裁出软边。
   状态类是根节点上的 gi--speaking，对应欢迎页的 --finishing / --glow-idle。 */
.gi__glow {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: 240rpx; // 120px
  overflow: hidden;
  pointer-events: none;
}

.gi__glow-fade {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 124rpx; // 62px
  background-image: linear-gradient(
    180deg,
    #fafafa 0%,
    #f7f8f9 38%,
    #f0f4f8 52%,
    #e7eff6 65%,
    #d9e8f6 77%,
    #c8def4 90%,
    #bfdaf4 100%
  );
  transition: opacity 320ms ease;
}

.gi__glow-voice {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx; // 118px：波形容器高度
  opacity: 0;
  transition: opacity 0.24s ease;
  pointer-events: none;
  will-change: opacity;
}

/* 播报 / 按住说话 / 校验中：波纹色带上场，常态那缕淡蓝让位 */
.gi--speaking .gi__glow-voice,
.gi--recording .gi__glow-voice,
.gi--checking .gi__glow-voice {
  opacity: 1;
}

.gi--speaking .gi__glow-fade,
.gi--recording .gi__glow-fade,
.gi--checking .gi__glow-fade {
  opacity: 0;
}

/* 11332:91 Frame 45：波浪容器，贴底 118px */
.gi__glow-voice-wave {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx; // 118px
}

/* 11332:97 Rectangle 106：三色带本体。
   为了「横向流动不露边、不跳色」，色带做成镜像周期 —— 0 → 50% 是设计稿色带，
   50% → 100% 是它的镜像，首尾同为 #EBB4E9；背景宽取两个窗口宽，位移一个周期即无缝循环 */
.gi__wave-band {
  position: absolute;
  top: 130rpx; // y759 − y694 = 65px
  left: 0;
  width: 750rpx; // 375px
  height: 106rpx; // 53px
  background: linear-gradient(
    90deg,
    #ebb4e9 0%,
    #56abfa 24.36%, // 设计稿 #56ABFA 在色带 48.72% → 半周期 24.36%
    #9795e8 50%, // 设计稿色带末端 #9795E8 → 半周期端点
    #56abfa 75.64%, // 后半为镜像
    #ebb4e9 100%
  );
  background-size: 1500rpx 100%; // 两个窗口宽，配合镜像渐变实现无缝循环
  -webkit-mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 990rpx 286rpx; // 遮罩画布 495×143 @2x
  mask-size: 990rpx 286rpx;
  -webkit-mask-position: -121rpx -14rpx; // 画布原点对齐页面 (−60.5, 752)
  mask-position: -121rpx -14rpx;
  will-change: background-position, mask-position;
}

/* 后层波浪：轮廓相同、透明度更低，叠出液面的层次感 */
.gi__wave-band--back {
  opacity: 0.4;
  transform: translateY(8rpx);
}

/* 动画只在播报时跑（同欢迎页 --finishing）：色带横向流动 + 遮罩左右摆动，后层更慢且反向；
   常态下不挂动画，不占合成线程 */
.gi--speaking .gi__wave-band,
.gi--recording .gi__wave-band,
.gi--checking .gi__wave-band {
  animation:
    gi-wave-color-flow 5.6s linear infinite,
    gi-wave-sway 4.8s ease-in-out infinite alternate;
}

.gi--speaking .gi__wave-band--back,
.gi--recording .gi__wave-band--back,
.gi--checking .gi__wave-band--back {
  animation:
    gi-wave-color-flow 7.6s linear infinite reverse,
    gi-wave-sway 6s ease-in-out infinite alternate;
}

/* 色带横向流动：位移一个背景周期（1500rpx），首尾同色，循环无缝 */
@keyframes gi-wave-color-flow {
  from {
    background-position: 0 0;
  }

  to {
    background-position: 1500rpx 0;
  }
}

/* 波形轮廓缓慢起伏：基准 mask-position 为 (−121rpx, −14rpx)，±20rpx 摆动 */
@keyframes gi-wave-sway {
  from {
    -webkit-mask-position: -141rpx -14rpx;
    mask-position: -141rpx -14rpx;
  }

  to {
    -webkit-mask-position: -101rpx -14rpx;
    mask-position: -101rpx -14rpx;
  }
}

.gi__content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}

/* 标题 + 副标题的列容器：只定 top / 左右，组内流式排布
   （标题折行变高时副标题自动下移，不会互相压字） */
.gi__head {
  position: absolute;
  top: 126rpx;
  right: 40rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* 标题：20px Medium #0D0D0D，y=117（扣状态栏 63px → 126rpx）
   只定左边距、右边留白：英文标题变长时原地折行，不会顶出屏幕 */
.gi__title {
  color: #0d0d0d;
  // 与首页欢迎态（ai-welcome/visitor 的 welcome-visitor 根节点）同一套字体栈：
  // 思源黑体 Medium 优先，缺字回落到 PingFang SC，中英文混排字重才一致
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  font-size: 40rpx; // 20
  font-weight: 500;
  line-height: 58rpx; // 29
  letter-spacing: 0;
  white-space: pre-line;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 自我介绍副标题：紫 → 蓝 → 粉的渐变字（350:1052 自我介绍副标题） */
/* 副标题容器：逐行承载渐变字（与首页 welcome-visitor__intro 一致）
   align-items: flex-start 让每行按自身文字宽度收缩 —— 渐变才能「每行各自铺满」，
   整块渲染时渐变按容器宽度铺，第二行只落在蓝色区间，到不了设计稿末端的粉 */
.gi__subtitle {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 5rpx; // 标题行盒底 → 副标题顶（设计稿 y=148.5 − 63 → 与标题差 5rpx）

  // 字体与首页欢迎态第二、三行渐变副标题保持一致（welcome-visitor__intro-line）
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  font-size: 40rpx;
  font-weight: 500;
  line-height: 58rpx;
  letter-spacing: 0;
}

/* 单行渐变字：紫 → 蓝 → 粉，色值取首页欢迎态副标题（306:6467 文字截图采样），
   逐行入场：淡入 + 上浮，行间靠 animation-delay 错开（见模板里的 inline delay） */
.gi__subtitle-line {
  display: block;
  color: transparent;
  background-image: linear-gradient(
    90deg,
    #3d28cf 0%,
    #2199fd 52%,
    #b06ffb 80%,
    #d571ec 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* ===== 首帧「你好三一」招呼帧（与 /pages/index 的 welcome-visitor 欢迎态同一套视觉）=====
   Hey,SANI（SANI 渐变）→ 三一图标 → 渐变标语 + 两行灰色描述；
   坐标按设计稿量取（已扣掉 47 高状态栏，本页外层用安全区高度下移）：
   标题行盒 y≈241、图标 y≈305、标语 y≈460、两行描述到 y≈533。
   整组顶部定位而不是垂直居中：不同屏高下与设计稿比例一致，不会被拉高或压低 */
.gi__brand {
  position: absolute;
  top: 483rpx; // 标题行盒顶：设计稿 y≈241（×2）
  right: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

/* 306:2801 + 306:2782：24px Medium，两段连写无间隙 */
.gi__brand-title {
  display: flex;
  align-items: flex-start;
  font-size: 48rpx; // 24
  font-weight: 500;
  line-height: 70rpx; // 35
  letter-spacing: 0;
  white-space: nowrap;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 306:2801：Hey, → #0D0D0D */
.gi__brand-title-hey {
  color: #0d0d0d;
}

/* 306:2782：SANI → 紫 → 蓝 → 紫 → 粉的渐变字（水平） */
.gi__brand-title-sani {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* 306:2791：110×110 图标，阴影 0 3px 9px rgba(0,0,0,.14)；
   图片是透明 PNG，用 drop-shadow 才沿三角轮廓投影 */
.gi__brand-logo {
  width: 220rpx;
  height: 220rpx;
  margin-top: 58rpx; // 标题行盒底 → 图标顶 ≈ 29px
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 80ms both;
}

/* 文案组：标语 + 两行灰色描述，行间 2px */
.gi__brand-caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 89rpx; // 图标底 → 标语顶 ≈ 44.5px
  gap: 4rpx; // 2px
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 160ms both;
}

/* 306:2780：16px Medium，行盒 23px，与标题同一套渐变 */
.gi__brand-slogan {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 32rpx; // 16
  font-weight: 500;
  line-height: 46rpx; // 23
  text-align: center;
}

/* 306:2800：16px / 行高 24px，两行居中，#8E8E8E */
.gi__brand-desc {
  max-width: 480rpx; // 240px
  color: #8e8e8e;
  font-size: 32rpx; // 16
  font-weight: 500;
  line-height: 48rpx; // 24
  text-align: center;
}

/* 中心 SANI 图标：110×110，设计稿 (132,345) → top 582rpx */
.gi__logo {
  position: absolute;
  top: 582rpx;
  left: 50%;
  display: flex;
  width: 220rpx;
  height: 220rpx;
  margin-left: -110rpx;
  align-items: center;
  justify-content: center;
}

.gi__logo-img {
  width: 220rpx;
  height: 220rpx;
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}

.gi__layer {
  position: absolute;
  inset: 0;
}

/* ===== 气泡版式（350:964 选择身份）=====
   纵向渐变 + 1px 白描边 + 两层投影；球面高光用 ::before，彩色反光用 ::after */
.gi__bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid #ffffff;
  border-radius: 50%;
  background: linear-gradient(160deg, #def1fc 0%, #f1faff 100%);
  box-shadow: 0 2rpx 22rpx rgba(0, 0, 0, 0.1), 0 2rpx 196rpx rgba(0, 0, 0, 0.0755);
  color: #0d0d0d;
  text-align: center;
  animation: gi-pop 560ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  will-change: transform, opacity;
}

/* 球面高光：白色 100% → 26%，模糊 5 */
.gi__bubble::before {
  content: "";
  position: absolute;
  top: 7.4%;
  left: 14.5%;
  width: 72.3%;
  height: 24.1%;
  border-radius: 50%;
  background: linear-gradient(180deg, #ffffff 0%, rgba(255, 255, 255, 0.26) 100%);
  filter: blur(10rpx);
}

/* 球底的一抹彩光：粉 + 蓝，模拟设计稿里重叠的发光层 */
.gi__bubble::after {
  content: "";
  position: absolute;
  right: 12%;
  bottom: 6%;
  left: 12%;
  height: 26%;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgba(246, 147, 255, 0.55) 0%, rgba(112, 199, 255, 0.42) 60%, rgba(255, 255, 255, 0) 100%);
  filter: blur(18rpx);
  opacity: 0.7;
}

/* 装饰球：整体虚化、无投影，缓慢漂浮 */
.gi__bubble--ghost {
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: none;
  filter: blur(16rpx);
  animation: gi-pop 560ms cubic-bezier(0.22, 0.61, 0.36, 1) both, gi-drift 7s ease-in-out infinite;
}

.gi__bubble--ghost::after {
  display: none;
}

.gi__bubble--selected {
  transform: scale(0.94);
  filter: brightness(1.04);
}

/* 气泡文案：16px Medium，两行居中（设计稿 350:964 的 16px） */
.gi__bubble-text {
  position: relative;
  z-index: 1;
  padding: 0 10rpx;
  font-size: 32rpx; // 16
  font-weight: 500;
  line-height: 46rpx; // 23
  white-space: pre-line;
  word-break: break-word;
}

/* ===== 胶囊版式（350:1119 身份信息）=====
   设计稿填充是低透明度的紫粉蓝渐变（opacity 0.16）+ 1px 浅蓝描边 + 背景模糊。
   宽度不写死：中文与设计稿同宽，英文按 max-width 折行，胶囊变高而不是顶出屏幕 */
.gi__pill {
  position: absolute;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  /* 设计稿内边距 6/18；左右收到 32rpx，给中英文混排留一点余量，避免刚好卡在折行边界 */
  padding: 12rpx 32rpx;
  border: 1px solid rgba(204, 226, 252, 0.9);
  border-radius: 76rpx; // 38
  background:
    linear-gradient(
      135deg,
      rgba(61, 33, 205, 0.16) 0%,
      rgba(253, 144, 196, 0.16) 24%,
      rgba(193, 228, 255, 0.16) 42%,
      rgba(192, 103, 250, 0.14) 64%,
      rgba(123, 156, 255, 0.14) 80%,
      rgba(247, 207, 255, 0.16) 100%
    ),
    rgba(255, 255, 255, 0.72);
  box-shadow: 0 2rpx 22rpx rgba(0, 0, 0, 0.1), 0 6rpx 32rpx rgba(0, 159, 235, 0.1272);
  backdrop-filter: blur(16rpx);
  animation: gi-pop 560ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  will-change: transform, opacity;
}

.gi__pill:active,
.gi__pill--selected {
  background:
    linear-gradient(
      135deg,
      rgba(61, 33, 205, 0.22) 0%,
      rgba(253, 144, 196, 0.22) 24%,
      rgba(193, 228, 255, 0.22) 42%,
      rgba(192, 103, 250, 0.2) 64%,
      rgba(123, 156, 255, 0.2) 80%,
      rgba(247, 207, 255, 0.22) 100%
    ),
    rgba(255, 255, 255, 0.82);
  transform: scale(0.97);
}

.gi__pill-text {
  color: #0d0d0d;
  font-size: 28rpx; // 14
  font-weight: 500;
  line-height: 40rpx; // 20
  white-space: pre-line;
  word-break: break-word;
}

/* 底部提示：16px #8E8E8E 居中，设计稿 y=597 → 1194rpx */
.gi__hint {
  position: absolute;
  top: 1194rpx;
  right: 0;
  left: 0;
  padding: 0 40rpx;
  color: #8e8e8e;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
  text-align: center;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 160ms both;
}

/* ===== 英文版式：同样的位置，字号收一档 =====
   英文按字母计宽，20px 的标题与 16px 的气泡文案在中文版式里会折成更多行：
   标题 / 副标题收到 18px，气泡 / 胶囊文案收到 13px，保证与中文版视觉重量一致且不溢出 */
.gi--en .gi__title {
  font-size: 36rpx; // 18
  line-height: 52rpx;
}

.gi--en .gi__subtitle {
  font-size: 36rpx;
  line-height: 52rpx;
}

/* 品牌区：标语 / 描述按英文长度收一档，描述加宽避免多折一行 */
.gi--en .gi__brand-slogan {
  font-size: 30rpx;
  line-height: 44rpx;
}

.gi--en .gi__brand-desc {
  max-width: 560rpx;
  font-size: 28rpx;
  line-height: 42rpx;
}

.gi--en .gi__pill-text {
  font-size: 26rpx; // 13
  line-height: 38rpx;
}

.gi--en .gi__bubble-text {
  font-size: 28rpx; // 14
  line-height: 40rpx;
}

.gi--en .gi__hint {
  font-size: 30rpx; // 15
}

/* 淡入 + 上浮 12px（与首页欢迎态的入场手感一致） */
@keyframes gi-rise {
  from {
    opacity: 0;
    transform: translateY(24rpx);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 选项弹出：从 0.72 放大到 1 */
@keyframes gi-pop {
  from {
    opacity: 0;
    transform: scale(0.72);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 装饰球缓慢漂浮 */
@keyframes gi-drift {
  0%,
  100% {
    margin-top: 0;
  }

  50% {
    margin-top: -12rpx;
  }
}
</style>

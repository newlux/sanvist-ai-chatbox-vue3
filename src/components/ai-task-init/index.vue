<script setup lang="ts">
import type { WakeStep, WakeValidateResult } from "@/api/chat/types";
import type { FlowStep, FlowStepOption, FlowStepsParams } from "@/api/flow";
import type { SaniStageBubble } from "@/components/sani-logo-stage/types";
import type { VisitorRole } from "@/stores/modules/user";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl, validateWakeWord } from "@/api/chat";
import { getFlowSteps } from "@/api/flow";
import welcomeVoiceSrc from "@/assets/audio/voice/welcome-task.wav";
import brandLogo from "@/assets/img/sani-logo.gif";
import SaniLogoStage from "@/components/sani-logo-stage/index.vue";
import { usePlainTts } from "@/hooks/usePlainTts";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useUserStore } from "@/stores";
import { VISITOR_ROLE_ACCOUNTS } from "@/stores/modules/user";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission } from "@/utils/platform/mpaas";
import { setTaskIdentity } from "@/utils/task-identity";
import VoiceRecorder from "@/utils/voiceRecorder.js";

/**
 * 任务协同初始化页（Ardot 350:1052 SANI 自我介绍 / 350:964 选择身份 / 350:1119、1204、1288 调度员信息）。
 *
 * 实现与「作业指导初始化页」同一套骨架：唤醒帧 → 自我介绍 → 步骤页，步骤的标题 / 提示 / 选项全部取
 * GET /flow/steps?module=TASK（本地不再写死任何身份，接口没下发就保持空），
 * 页面只负责按 stepCode 选版式与推进：
 *   入口即 HEY（自我介绍）→ IDENTITY（选择身份）→ IDENTITY_DETAIL（该角色的身份信息帧）
 *   → 说「开始体验」→ 进任务协同。
 *   首帧「你好三一」招呼页（WELCOME）已跳过，代码保留（回退可落到它），只是不作入口。
 *
 * 三个身份各自一帧（标题与所选身份一一对应，见 ROLE_DETAIL_PRESETS / ROLE_PRESET_KEYS）：
 *   - 工地调度员        DISPATCH-01  350:1119「搅拌车晚到，工地后续浇筑安排受到影响」
 *   - 商混站调度员      DISPATCH-02  350:1288「现场浇筑变慢，多辆搅拌车排队，混凝土面临初凝、退料风险」
 *   - 泵送公司调度主管  DISPATCH-03  350:1204「两个工地同时要泵车，当前只有一台可调」
 *
 * 两个接口各管一件事：
 *   - GET  /flow/steps?module=TASK：每一步的 title / hint / options（options 按 sortNo 升序）。
 *     点选身份后先用该选项的 hitValue 当 roleCode 再拉一次
 *     （/flow/steps?module=TASK&roleCode=DISPATCH-02），等它回来再换页：
 *     接口下发了 IDENTITY_DETAIL 就用接口的标题 + 胶囊，没下发则用上面三个预设帧；
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
 * 收尾：把身份写进 store（visitorRole）后进任务协同页（/pages/task/index）。
 */
defineOptions({ name: "AiTaskInit" });

const emit = defineEmits(["finish"]);

const logger = createLogger("task-init-page");
const { t, locale } = useI18n();
const userStore = useUserStore();
/**
 * 顶部状态栏高度：设计稿 375×812（含 54 高状态栏），自我介绍帧标题 y=117（节点 350:1052 /
 * 722:2492 这一帧里 Main Title 的位置）。本页所有 y 都是扣掉状态栏后的值（126rpx = 63px），
 * 必须靠这层 padding 把状态栏补回来；不注入时 var(--safe-top-px) 取 0，整页会比设计稿高出一个状态栏。
 */
const { safeAreaStyle } = useSafeArea();

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
/** 点选时命中态亮一下再切下一步，避免点下去没有反馈 */
const SELECT_DELAY_MS = 220;
/** 选完身份后等该身份数据的最长时间：接口慢就按本地预设帧先推进，不让选中态卡住 */
const ROLE_REFRESH_WAIT_MS = 600;
/**
 * 语音命中后的停留时长：与首页身份球（visitor.vue 的 IDENTITY_HIT_HOLD_MS）一致，
 * 先点亮命中的那一项（高亮玻璃 + 柔光外圈 + 呼吸），让用户看清「选中了哪个」再进下一步。
 */
const HIT_HOLD_MS = 900;

/* ===== 选项槽位：每一帧单独配置，帧与帧之间不共享坐标 =====
 * ⚠️ 调位置只改下面这几张表，样式里不用动；坐标都是内容区坐标（已扣状态栏），单位 rpx。
 *
 *   中心图标（所有帧共用）           → 由 CSS flex 上下左右居中，无需再给 top
 *   帧 1 · 选择身份（玻璃气泡）      → TASK_BUBBLES          ← 三颗球的 left / top / size
 *   帧 1 · 装饰虚化球                → GHOST_BUBBLES         ← 虚化球的 left / top / size
 *   帧 2 · 身份信息（胶囊）          → TASK_PILL_SLOTS       ← 三颗胶囊的 left / top / 宽
 *
 * 气泡由 components/sani-logo-stage 渲染（与首页 index 同一套结构）：
 * logo 在组件里用 CSS flex 居中；气泡 / 胶囊的表仍写「内容区绝对坐标」，原样落位。
 */

/** 图标容器（268rpx）的一半：气泡 / 胶囊都挂在这个容器里，坐标以容器左上为原点 */
const CORE_HALF = 134;
/** 图标容器在 750rpx 画布里居中时的左边缘：(750 − 268) / 2 = 241rpx */
const CORE_LEFT_IN_CANVAS = (750 - 268) / 2;

/**
 * 帧 1 · 选择身份：三颗 82.6px 的圆（164rpx），左右沿用设计稿，
 * 纵向与作业指导帧 1 同一套节奏（328 / 487 / 720rpx），两页首屏观感一致。
 * 槽位存「球心相对中心图标圆心的偏移」（cx / cy，rpx），size 是直径：球锚在图标圆心上，
 * 图标随屏高 flex 居中时球跟着走（cx = left + size/2 − 375，cy = top + size/2 − 758）。
 * ⚠️ 调球位改这里；第 n 行的球对应接口 sortNo=n 的选项。
 */
const TASK_BUBBLES = [
  { cx: 186, cy: -226, size: 164 }, // 第 1 颗（右上）
  { cx: -238, cy: -100, size: 164 }, // 第 2 颗（左中）
  { cx: 186, cy: 186, size: 164 }, // 第 3 颗（右下）
];
/**
 * 帧 1 的装饰虚化球：不参与交互，只补设计稿里的层次。
 * ⚠️ 调虚化球位置改这里（cx / cy 为球心相对图标圆心的偏移），删掉某一行即可去掉那颗
 */
const GHOST_BUBBLES = [
  { key: "dot-a", fill: ["#e7eaff", "#f0f2ff"], cx: -135, cy: -296, size: 60 },
  { key: "dot-b", fill: ["#e3f5ff", "#f1faff"], cx: 287, cy: -100, size: 52 },
  { key: "dot-c", fill: ["#def1fc", "#f1faff"], cx: -257, cy: 34, size: 44 },
];

/**
 * 帧 2 · 身份信息（胶囊）：槽位存「胶囊中心相对图标容器中心的偏移」（cx / cy，rpx），
 * 与 ai-welcome 身份信息胶囊（DETAIL_TAG_SLOTS 的 centerX/centerY）同一套口径：
 * 胶囊挂在与 logo 同尺寸、同样 flex 居中的容器里，屏高变化时跟着 logo 一起走。
 * cx / cy 由原设计稿内容区坐标（left/top，胶囊中心 = left + minWidth/2、top + 32）相对
 * 画布绝对圆心 (375, 758) 换算：cx = left + minWidth/2 − 375，cy = top + 32 − 758。
 *
 * 宽度：文案一律**单行**（.gi__pill / .gi__pill-text 都是 nowrap），胶囊宽度按文案自然宽度撑开，
 * minWidth 只是最小宽度（短文案不至于太扁），不再给 maxWidth —— 一旦有 maxWidth，
 * 超出就会折成两行，正是「仅一台可调」被折成「仅一台可 / 调」的原因。
 * 单行胶囊高 64rpx；⚠️ 调胶囊位置改这里
 */
const TASK_PILL_SLOTS = [
  { cx: -198, cy: -118, minWidth: 200 }, // 第 1 颗（左上）
  { cx: 200, cy: -69, minWidth: 200 }, // 第 2 颗（右中）
  { cx: -208, cy: 196, minWidth: 220 }, // 第 3 颗（左下）
];

/** 身份页标题里的称呼：游客态没有昵称时用设计稿的占位名 */
const visitorName = computed(() => String(userStore.username || "").trim() || t("task-init-guest"));

/**
 * 接口返回的步骤（GET /flow/steps?module=TASK）。
 * 身份球只渲染接口下发的 IDENTITY.options：本地不再写死「工地 / 泵送 / 商混」三个人设，
 * 接口没下发（或请求失败）时宁可不出现气泡，也不伪造身份数据。
 */
const flowSteps = ref<FlowStep[]>([]);
/**
 * 接口是否已经落地（成功或失败都算）。
 * 口播收尾要进下一步时靠它区分「IDENTITY 真的没下发内容」与「接口还没回来」——
 * 后者若直接按「无内容」顺延，会把整页跳过去。
 */
const flowReady = ref(false);
/**
 * 当前所在的 step：WELCOME / HEY / IDENTITY / IDENTITY_DETAIL / RECOMMEND。
 * 跳过首帧「你好三一」招呼页（WELCOME），入口直接是自我介绍帧（HEY）；
 * 招呼帧的模板与逻辑保留（回退时还能落到它），只是不再作为入口。
 */
const activeStep = ref(STEP_HEY);
/** 当前处于「已选中」反馈态的选项（hValue） */
const selectedKey = ref("");
/** 已选答案：stepCode → hValue（IDENTITY 的 hValue 就是 roleCode） */
const answers = ref<Record<string, string>>({});
/** 选中的身份：hValue 是拉 IDENTITY_DETAIL 用的 roleCode，label 用于兜底展示 */
const pickedRole = ref<{ hitValue: string; label: string } | null>(null);

/**
 * 三个调度身份各自的身份信息帧（Ardot 350:1119 工地调度员 / 350:1204 泵送公司调度主管 /
 * 350:1288 商混站调度员）：标题就是该角色碰到的调度难题，三颗胶囊是这一步的痛点，
 * 底部统一「可以和我说“开始体验”」。
 *
 * 接口带 roleCode 下发了 IDENTITY_DETAIL 时以接口为准（见 stepMap）；
 * 没下发就用这里按所选身份补出来，保证点完身份一定有对应的身份信息帧可看。
 */
const ROLE_DETAIL_PRESETS: Record<string, { titleKey: string; pillKeys: [string, string, string] }> = {
  SITE_DISPATCHER: {
    titleKey: "task-init-detail-site-title",
    pillKeys: ["task-init-detail-site-pill-1", "task-init-detail-site-pill-2", "task-init-detail-site-pill-3"],
  },
  PUMP_DISPATCHER: {
    titleKey: "task-init-detail-pump-title",
    pillKeys: ["task-init-detail-pump-pill-1", "task-init-detail-pump-pill-2", "task-init-detail-pump-pill-3"],
  },
  MIXING_DISPATCHER: {
    titleKey: "task-init-detail-mix-title",
    pillKeys: ["task-init-detail-mix-pill-1", "task-init-detail-mix-pill-2", "task-init-detail-mix-pill-3"],
  },
};

type RolePresetKey = keyof typeof ROLE_DETAIL_PRESETS;

/**
 * 接口身份码 → 预设帧。module=TASK 的 IDENTITY 选项 hitValue 是业务身份码：
 *   DISPATCH-01 工地调度员 / DISPATCH-02 商混站调度员 / DISPATCH-03 泵送公司调度主管。
 * 老的 SITE_DISPATCHER 这类写法继续兼容 —— 认不出预设时这一帧会被当成「没内容」跳过，
 * 点完身份直接飞出本页，所以映射必须覆盖接口实际下发的码。
 */
const ROLE_PRESET_KEYS: Record<string, RolePresetKey> = {
  "DISPATCH-01": "SITE_DISPATCHER",
  "DISPATCH-02": "MIXING_DISPATCHER",
  "DISPATCH-03": "PUMP_DISPATCHER",
  SITE_DISPATCHER: "SITE_DISPATCHER",
  MIXING_DISPATCHER: "MIXING_DISPATCHER",
  PUMP_DISPATCHER: "PUMP_DISPATCHER",
};

/** 身份码认不出时按 label 关键字兜底（后端新增 / 改名了身份也不至于整帧跳过） */
function presetKeyByLabel(label: string): RolePresetKey | null {
  const text = String(label || "");
  if (/泵送|pump/i.test(text)) return "PUMP_DISPATCHER";
  if (/商混|搅拌|mixing|concrete/i.test(text)) return "MIXING_DISPATCHER";
  if (/工地|site/i.test(text)) return "SITE_DISPATCHER";
  return null;
}

/** 所选身份对应的预设帧：先认身份码，再认 label */
function presetKeyOfRole(roleCode: string, label = ""): RolePresetKey | null {
  return ROLE_PRESET_KEYS[normalizeStep(roleCode)] || presetKeyByLabel(label);
}

/** 按所选身份合成身份信息帧；身份没有预设（后端新增）时返回 null，交给接口或直接收尾 */
const roleDetailStep = computed<FlowStep | null>(() => {
  const presetKey = presetKeyOfRole(pickedRole.value?.hitValue || "", pickedRole.value?.label || "");
  const preset = presetKey ? ROLE_DETAIL_PRESETS[presetKey] : null;
  if (!preset || !presetKey) return null;
  return {
    stepCode: STEP_IDENTITY_DETAIL,
    title: t(preset.titleKey),
    hint: t("task-init-hint-detail"),
    options: preset.pillKeys.map((key, index) => ({
      label: t(key),
      bubbleType: "STATIC",
      hitValue: `${presetKey}_PAIN_${index + 1}`,
      sortNo: index + 1,
    })),
  };
});
/**
 * 兜底话术轮次：未命中时随 fallbackRound 递增，按 fallbackTexts 顺序循环；
 * 有效选择（命中 / 点选 / 换页）后重置为 0。
 */
const fallbackRound = ref(0);
/** 按住说话中：页面停止播报、选项不可点 */
const isRecording = ref(false);
/** 松手后的识别 / 校验中：底部保持录音那套波纹，等接口回结果 */
const isChecking = ref(false);
/**
 * 未命中（语音没对上任何选项）：与首页 331:147「唤醒失败」一致，底部声纹切成红色，
 * 停留 MISS_RESET_MS 后自动淡回常态；重新按压 / 命中 / 换页都会提前撤掉。
 */
const isMissed = ref(false);
/** 用户已经用语音交互过：唤醒页不再因为「播报停了」自动往下走（等接口结果决定去向） */
let voiceInteracted = false;
/** 长按已进入录音：松手后补出来的 tap 要吞掉，不能当成「跳过唤醒页」 */
let holdFired = false;
/** 跳转中标记：收尾只执行一次 */
let navigating = false;

let introTimer: ReturnType<typeof setTimeout> | null = null;
let selectTimer: ReturnType<typeof setTimeout> | null = null;
/** 语音命中 → 停留后推进的延时器 */
let hitTimer: ReturnType<typeof setTimeout> | null = null;
/** 未命中红色 → 自动淡回常态的延时器 */
let missTimer: ReturnType<typeof setTimeout> | null = null;
/** 在途的 /flow/steps 请求：口播收尾要多等它一次，复用同一个 Promise 不重复发请求 */
let flowRequest: Promise<void> | null = null;

/** 英文文案比中文长，字号与行高单独收一档，避免气泡 / 胶囊被撑破 */
const isEnglish = computed(() => String(locale.value || "").toLowerCase().startsWith("en"));

/**
 * 语音播报：与首页 / 欢迎页共用同一套（usePlainTts → POST /speech/tts/stream），
 * 每一步出现时口播标题；播报期间底部三色带波浪流动，播完回到设计稿的静态基线。
 */
const introTts = usePlainTts(isEnglish.value ? "en" : "zh");
/** 模板里直接用：true 时底部波浪进入流动 + 摆动（与首页 speaking-wave 一致） */
const speaking = introTts.playing;

/** stepCode → step：全部来自接口；未知 stepCode 也留在表里（接口加了新步骤不白屏） */
const stepMap = computed<Record<string, FlowStep>>(() => {
  const map: Record<string, FlowStep> = {};
  flowSteps.value.forEach((step) => {
    const code = String(step?.stepCode || "").trim().toUpperCase();
    if (code) map[code] = step;
  });
  // 接口没下发 IDENTITY_DETAIL 时，用所选角色对应的身份信息帧补上（标题与角色一一匹配）
  if (!map[STEP_IDENTITY_DETAIL] && roleDetailStep.value) map[STEP_IDENTITY_DETAIL] = roleDetailStep.value;
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

/** 选项区底部相对画布中心的偏移（rpx）：气泡取 max(cy + size/2)，胶囊按单行 64rpx 高估取 max(cy) + 32 */
const optionAreaBottomOffset = computed(() => (currentLayout.value === "bubbles"
  ? Math.max(...TASK_BUBBLES.map(item => item.cy + item.size / 2))
  : Math.max(...TASK_PILL_SLOTS.map(item => item.cy)) + 32));

/**
 * 提示文字与选项区的固定间距（rpx，56px，取设计稿 350:964 最低那颗球底到 hint 顶）。
 * 选项变高时先保证这个间距，不被贴底基线压住。
 */
const HINT_GAP_RPX = 112;
/** 与首页欢迎页同一套贴底口径：bottom 192px（384rpx）+ 行盒 46rpx */
const HINT_BOTTOM_RPX = 384;
const HINT_LINE_RPX = 46;

/**
 * 提示文字定位：top = max(画布中心 + 选项区偏移 + 56px, 画布底部 − 430rpx)。
 * 用 CSS 的 50% / 100% 代替 JS 量高度，屏高变化时提示跟着 logo 一起走；
 * 偏移量用 vw（750rpx = 100vw）表达 —— 内联样式里的 rpx 在 calc/max 中不一定被运行时转换。
 */
const hintStyle = computed(() => {
  const followVw = (optionAreaBottomOffset.value + HINT_GAP_RPX) / 7.5;
  const bottomVw = (HINT_BOTTOM_RPX + HINT_LINE_RPX) / 7.5;
  return {
    top: `max(calc(50% + ${followVw}vw), calc(100% - ${bottomVw}vw))`,
    bottom: "auto",
  };
});

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

/** 换页：换页即视为一次有效选择，兜底轮次归零，未命中的红也一并撤掉 */
function switchTo(code: string) {
  if (activeStep.value === code) return;
  activeStep.value = code;
  fallbackRound.value = 0;
  selectedKey.value = "";
  clearMissed();
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
async function advanceToFirstStep() {
  clearIntroAdvance();
  if (isWelcomeStep.value) {
    enterIntroFrame();
    return;
  }
  if (!isWakeStep.value) return;
  // 口播结束早于接口返回时先等这一次请求：否则 IDENTITY 会被当成「没有内容」而整页顺延掉
  if (!flowReady.value) {
    await ensureFlowSteps();
    if (!isWakeStep.value) return;
  }
  goToStep(nextStepAfter(STEP_HEY), STEP_HEY);
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

/**
 * 交给 SaniLogoStage 的球列表：接口选项（按 TASK_BUBBLES 槽位）在前，装饰虚化球在后。
 * 这里只负责把文案 / 字号 / 颜色准备好；坐标换算、入场动画都在组件里做。
 * ⚠️ 位置数据来自 TASK_BUBBLES / GHOST_BUBBLES，不要在模板里改。
 */
const stageBubbles = computed<SaniStageBubble[]>(() => {
  // 只有气泡版式才出球；胶囊版式 / 无步骤时整块留空，只留中心图标
  if (!currentStep.value || currentLayout.value !== "bubbles") return [];
  const slotOf = (index: number) => TASK_BUBBLES[Math.min(index, TASK_BUBBLES.length - 1)];
  const roleBubbles: SaniStageBubble[] = currentOptions.value.map((item, index) => {
    const slot = slotOf(index);
    return {
      key: optionValue(item),
      label: wrapBubbleLabel(item.label),
      cx: slot.cx,
      cy: slot.cy,
      size: slot.size,
      fontSize: isEnglish.value ? 28 : 32,
      glass: true,
    };
  });
  const ghostBubbles: SaniStageBubble[] = GHOST_BUBBLES.map(item => ({
    key: item.key,
    label: "",
    cx: item.cx,
    cy: item.cy,
    size: item.size,
    fill: item.fill as [string, string],
  }));
  return [...roleBubbles, ...ghostBubbles];
});

/** 点在球上：把 key 换回接口选项，走与点击胶囊同一条推进逻辑 */
function onStageSelect(key: string) {
  const option = currentOptions.value.find(item => optionValue(item) === key);
  if (option) onOptionTap(option);
}

/**
 * 胶囊定位：文案单行、宽度随文案走（CSS nowrap + width: max-content），
 * 这里只给位置和最小宽度，不再给 maxWidth —— 绝对定位元素带 maxWidth 时超宽就折行，
 * 「仅一台可调」被折成「仅一台可 / 调」就是这么来的。
 * 胶囊挂在与 logo 同尺寸（268rpx）、同样 flex 居中的容器里，坐标以容器左上为原点：
 * 屏高变化时 CSS 自动重排，胶囊和 logo 一起走，不再依赖 JS 量高度。
 */
function pillStyle(item: { cx: number; cy: number; minWidth: number }, index = 0) {
  // 胶囊中心（按 minWidth 估）锚在图标容器中心 + (cx, cy)：左边缘 = 容器中心 + cx − minWidth/2
  const left = CORE_HALF + item.cx - item.minWidth / 2;
  const top = CORE_HALF + item.cy - 32; // 胶囊高 64rpx
  return {
    left: `${left}rpx`,
    top: `${top}rpx`,
    minWidth: `${item.minWidth}rpx`,
    "--holo-dx": `${-item.cx}rpx`,
    "--holo-dy": `${-item.cy}rpx`,
    "--holo-rx": item.cy < 0 ? "85deg" : "-85deg",
    "--holo-ry": item.cx > 0 ? "45deg" : "-45deg",
    "--holo-delay": `${index * 90}ms`,
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
/** 未命中的红色停留时长：与首页 WAKE_MISS_RESET_MS 一致，2s 后自动淡回常态 */
const MISS_RESET_MS = 2_000;

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
      enterMissed();
      return;
    }

    const result = await ensureRecorder().stop();
    if (seq !== recordSeq) return;
    if (!result?.success || result?.cancelled) {
      isChecking.value = false;
      // 用户主动划走取消不算未命中，不上红
      if (!result?.cancelled) {
        logger.warn("guide recorder stop failed", result?.error);
        enterMissed();
      }
      return;
    }

    const { tempFilePath, audioUrl, audioBase64, mimeType } = result.data || {};
    if (!tempFilePath && !audioUrl && !audioBase64) {
      isChecking.value = false;
      enterMissed();
      return;
    }

    const response = await withTimeout(requestRecognition({ filePath: tempFilePath, audioUrl, audioBase64, mimeType }), ASR_TIMEOUT_MS);
    if (seq !== recordSeq) return;
    const text = String(response?.text || "").trim();
    logger.info("guide asr result", { step, text });
    // 没识别出文字：等同未命中，底部切红让用户知道这次没被听懂
    if (!text) {
      isChecking.value = false;
      enterMissed();
      return;
    }
    // 身份信息帧说「开始体验」：直接进任务协同
    if (normalizeStep(step) === STEP_IDENTITY_DETAIL && isStartCommand(text)) {
      logger.info("task detail start command", { step, text });
      isChecking.value = false;
      fallbackRound.value = 0;
      finish();
      return;
    }
    await validateVoiceText(seq, text, step);
  }
  catch (error) {
    logger.warn("guide speech recognize failed", error);
    if (seq === recordSeq) {
      isChecking.value = false;
      enterMissed();
    }
  }
}

/**
 * 身份信息帧的收尾口令：这一帧的 CTA 是「开始体验」，后端 TASK 流程还没有这一步的意图，
 * 先在端上认；命中就直接进任务协同，不必等校验接口（接口失败也不会卡住）。
 */
const START_COMMANDS = ["开始体验", "开始", "体验", "start", "begin", "let's go", "go ahead"];

function isStartCommand(text: string) {
  // 去掉空白与标点后做包含判断，避免「开始体验。」「Start!」这类识别结果漏判
  const value = String(text || "").replace(/[\s，。,.!！?？、"'“”]/g, "").toLowerCase();
  if (!value) return false;
  return START_COMMANDS.some(word => value.includes(word.replace(/[\s']/g, "")));
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
    if (seq === recordSeq) {
      isChecking.value = false;
      enterMissed();
    }
  }
}

/** 红色淡回常态（重新按压 / 命中 / 换页 / 卸载时调用） */
function clearMissed() {
  if (missTimer) {
    clearTimeout(missTimer);
    missTimer = null;
  }
  isMissed.value = false;
}

/**
 * 未命中：底部声纹切成首页 331:147「唤醒失败」的红
 * （竖向 rgba(239,239,238,0) → #E02E2A），停留 MISS_RESET_MS 后自动淡回常态。
 * 页面内容不动，用户可重试或直接点选。
 */
function enterMissed() {
  isMissed.value = true;
  if (missTimer) clearTimeout(missTimer);
  missTimer = setTimeout(() => {
    missTimer = null;
    isMissed.value = false;
  }, MISS_RESET_MS);
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
 * - matched：带 hitValue 时先把命中的那一项点亮（选择特效，见 playHit）再推进，
 *   不带 hitValue 时读 currentStep 前进；
 * - 未命中：底部声纹切红（enterMissed），播报兜底话术，页面不动，
 *   fallbackRound +1，有效选择后归零。
 */
function applyValidateResult(result: WakeValidateResult | null | undefined, step: string) {
  const matched = Boolean(result?.matched ?? result?.success);
  const intent = normalizeStep(result?.intent);
  const localStep = normalizeStep(step);

  // 首帧招呼页：命中就进自我介绍帧；已在第一帧，BACK 无处可退直接忽略
  if (localStep === STEP_WELCOME) {
    if (matched && intent !== "BACK") {
      fallbackRound.value = 0;
      clearMissed();
      enterIntroFrame();
      return;
    }
    if (!matched) {
      enterMissed();
      speakFallback(result);
    }
    return;
  }

  if (matched && intent === "BACK") {
    fallbackRound.value = 0;
    clearMissed();
    const target = normalizeStep(result?.targetStep);
    if (!target) return;
    introTts.stop();
    goToStep(target, step);
    return;
  }

  if (!matched) {
    enterMissed();
    speakFallback(result);
    return;
  }

  clearMissed();
  const hitValue = String(result?.hitValue ?? "").trim();
  const code = normalizeStep(step);
  if (hitValue && stepMap.value[code]) {
    fallbackRound.value = 0;
    // 命中项先点亮再推进（同首页身份球的命中态），见 playHit
    playHit(code, hitValue, findOptionLabel(code, hitValue) || hitValue);
    return;
  }

  fallbackRound.value = 0;
  const next = normalizeStep(result?.currentStep)
    || normalizeStep(result?.targetStep)
    || nextStepAfter(step);
  goToStep(next, step);
}

/** 命中值是否真对得上这一步的某个选项（对不上就没有可点亮的项） */
function hasOptionValue(code: string, hitValue: string) {
  const options = Array.isArray(stepMap.value[code]?.options) ? stepMap.value[code].options : [];
  return options.some(option => optionValue(option) === hitValue);
}

/**
 * 语音命中的「选择特效」：与首页 index 的身份球（ai-welcome/visitor.vue 的 --active）同一套 ——
 * 命中的那一项先点亮（高亮玻璃填充 + 白色柔光外圈 + 1.08 倍呼吸），停留 HIT_HOLD_MS
 * 让用户看清「选中了哪个」，再按流程链推进，避免选中态一闪而过。
 * 停留期间又起录 / 换页 / 卸载：recordSeq 或当前 step 变了，这次命中的后续动作作废。
 */
function playHit(code: string, hitValue: string, label: string) {
  if (hitTimer) {
    clearTimeout(hitTimer);
    hitTimer = null;
  }
  // 命中值对不上任何选项：没有可点亮的项，直接推进，别让用户白等一个停顿
  if (!hasOptionValue(code, hitValue)) {
    void applySelection(code, hitValue, label);
    return;
  }
  selectedKey.value = hitValue;
  const seq = recordSeq;
  hitTimer = setTimeout(() => {
    hitTimer = null;
    if (seq !== recordSeq) return;
    if (normalizeStep(activeStep.value) !== normalizeStep(code)) return;
    // 同点选：选中态留到换页（switchTo）再清，避免入场动画重播一遍
    void applySelection(code, hitValue, label);
  }, HIT_HOLD_MS);
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
  // 用户开口了：撤掉「自我介绍播完自动进下一步」的计时器，以及上一次未命中的红
  clearIntroAdvance();
  clearMissed();
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
  if (hitTimer) {
    clearTimeout(hitTimer);
    hitTimer = null;
  }
  if (missTimer) {
    clearTimeout(missTimer);
    missTimer = null;
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

/**
 * 点击底部提示（gi__hint）：跳过语音命中，直接进入下一步。
 * 只在异常帧（身份信息帧 IDENTITY_DETAIL）响应 —— 它的提示是「可以和我说“开始体验”」，
 * 点一下等同「不说直接走」，直接收尾进任务协同；其余帧的提示不承接跳过动作。
 */
function onHintTap() {
  // 长按录音松手后补出来的 tap 不算点击
  if (holdFired) {
    holdFired = false;
    return;
  }
  if (isRecording.value || isChecking.value) return;
  if (normalizeStep(activeStep.value) !== STEP_IDENTITY_DETAIL) return;
  finish();
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
  // 异常帧（身份信息帧）的胶囊不可点击：只承接语音命中（playHit）与底部提示跳过，点选直接忽略
  if (normalizeStep(step.stepCode) === STEP_IDENTITY_DETAIL) return;
  // 点选也是一次有效选择：上一次未命中的红提前撤掉
  clearMissed();
  const hit = optionValue(item);
  if (!hit) return;
  selectedKey.value = hit;
  fallbackRound.value = 0;
  const code = normalizeStep(step.stepCode);
  const label = String(item.label || "").trim() || hit;
  selectTimer = setTimeout(() => {
    selectTimer = null;
    // 不要在这里清 selectedKey：清掉选中态会让球 / 胶囊退回入场动画
    // （SaniLogoStage 的 sani-stage-holo / 胶囊的 gi-bubble-holo，backwards 填充）重播一遍再换页。
    // 选中态统一由 switchTo 在换页时清，或 applySelection 兜底清。
    void applySelection(code, hit, label);
  }, SELECT_DELAY_MS);
}

/**
 * 记下这一步的答案并推进：
 * 点选与语音命中走同一条路；选中身份后进**该身份对应的身份信息帧**
 * （IDENTITY → IDENTITY_DETAIL，标题 / 胶囊由该身份的接口数据决定）。
 *
 * 身份信息帧（异常状况）是「终点前一步」：胶囊点选不可用（见 onOptionTap），
 * 语音命中痛点会点亮并推进进任务协同；「开始体验」语音口令（isStartCommand）与
 * 点击底部提示（onHintTap）也都能收尾。
 */
async function applySelection(stepCode: string, hitValue: string, label: string) {
  const code = normalizeStep(stepCode);
  if (code) answers.value = { ...answers.value, [code]: hitValue };
  const isIdentityStep = code === STEP_IDENTITY;
  if (isIdentityStep && hitValue) {
    pickedRole.value = { hitValue, label: label || hitValue };
  }

  // 带上 roleCode 拉这个身份的数据（/flow/steps?module=TASK&roleCode=xxx）：
  // 等接口回来再换页，身份帧首屏就是该身份的文案；接口慢（最多 ROLE_REFRESH_WAIT_MS）
  // 或没下发 IDENTITY_DETAIL 时，仍用本地预设帧兜底，不让选中态卡住。
  if (isIdentityStep) {
    await Promise.race([
      loadFlowSteps(),
      new Promise(resolve => setTimeout(resolve, ROLE_REFRESH_WAIT_MS)),
    ]);
  }

  // 身份信息帧（异常帧）也是终点前一步：语音命中痛点记录后直接进任务协同
  // （胶囊点选已在 onOptionTap 里禁用，这里只承接语音命中的推进）；
  // 「开始体验」语音口令（isStartCommand）与点击底部提示（onHintTap）也都能收尾。
  goToStep(nextStepAfter(code), code);
  // 换页时 switchTo 已经清过；这里兜住「next 仍是当前步」的情况，避免一直亮着、后续点不动
  selectedKey.value = "";
}

/** 任务协同的身份码只有落在本地 VisitorRole 里才能写进 store，其它码只记日志 */
const VISITOR_ROLE_CODES = new Set<string>(Object.keys(VISITOR_ROLE_ACCOUNTS));

/**
 * 收尾：把身份写进 store，随后进任务协同页——只由身份信息帧说「开始体验」走到这里
 * （胶囊点选 / 语音命中痛点只记录、不跳页）。
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
  const roleCode = normalizeStep(pickedRole.value?.hitValue || answers.value[STEP_IDENTITY] || "");
  applyVisitorRole(roleCode);
  // 记下这次选的身份（接口下发的身份码，如 DISPATCH-02）：
  // 任务协同页据此判断首屏是问「查异常」还是拉甘特图入口卡，跨页 / 独立窗口都要能取到 → 落本地存储
  setTaskIdentity(roleCode ? { code: roleCode, label: pickedRole.value?.label || roleCode } : null);
  // 身份信息帧说「开始体验」→ 正式进入任务协同。
  // 带上 from=init：任务协同页靠这个参数区分「引导流程进来」与「新建页面 / 宿主独立窗口直接进」——
  // 只有前者铺异常摘要卡，后者铺初始化「今天任务有哪些」拉到的甘特图入口卡
  emit("finish", "/pages/task/index?from=init");
}

/**
 * GET /flow/steps?module=TASK：标题 / 提示 / 选项全用接口值。
 * 首次只带 module（保证一定能拿到 IDENTITY 这一步来选择身份）；
 * 点选身份后补 roleCode 再拉一遍（见 applySelection，最多等 ROLE_REFRESH_WAIT_MS），
 * 拿该身份的数据，接口下发了 IDENTITY_DETAIL 就直接渲染接口文案 + 胶囊。
 * 接口没下发（或失败）时不再退回本地文案：身份球保持为空，只有框架文案（标题 / 提示）仍走 i18n。
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
      logger.warn("flow steps empty, identity bubbles stay empty (no local roles)");
      return;
    }
    flowSteps.value = usable;
  }
  catch (error) {
    logger.warn("failed to load task flow steps", error);
  }
  finally {
    // 请求落地（无论成败）：口播收尾不再等它
    flowReady.value = true;
  }
}

/** 首屏只发一次请求：口播收尾与 onMounted 抢着要数据时复用同一个 Promise */
function ensureFlowSteps() {
  if (!flowRequest) {
    flowRequest = loadFlowSteps().finally(() => {
      flowRequest = null;
    });
  }
  return flowRequest;
}

onMounted(() => {
  introShownAt = Date.now();
  navigating = false;
  voiceInteracted = false;
  void ensureFlowSteps();
  // 入口就是自我介绍帧：口播没起来（WebView 拦自动播放 / TTS 失败）也要能进下一步
  clearIntroAdvance();
  introTimer = setTimeout(advanceToFirstStep, INTRO_FALLBACK_MS);
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
    :style="safeAreaStyle"
    :class="{
      'gi--en': isEnglish,
      'gi--welcome': isWelcomeStep,
      'gi--speaking': speaking,
      'gi--recording': isRecording,
      'gi--checking': isChecking,
      'gi--missed': isMissed,
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
           Hey,SANI + 三一图标 + 渐变标语，说「你好三一」唤醒后进自我介绍。
           logo 由 .gi__brand 的 CSS flex 上下左右居中，标题 / 标语绕它摆放，两帧切换图标不跳 -->
      <view v-if="isWelcomeStep" class="gi__brand">
        <view class="gi__brand-core">
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

      <!-- 中心 SANI 图标 + 环绕气泡：完全对齐首页 index（ai-welcome/visitor.vue 1414-1480）那套结构，
           复用 components/sani-logo-stage —— 图标容器 134×134、图 110×110、球挂在容器内相对定位，
           入场同样是「全息升维翻展」+ 落位漂浮。
           ⚠️ 球的位置不在这里改：见脚本 TASK_BUBBLES / GHOST_BUBBLES；
           key 绑 activeStep：换帧时整块重建，入场动画才会重新播 -->
      <SaniLogoStage
        v-if="!isWelcomeStep"
        :key="`stage-${activeStep}-${currentLayout}`"
        :logo="brandLogo"
        :bubbles="stageBubbles"
        :selected-key="selectedKey"
        @select="onStageSelect"
      />

      <!-- 胶囊版式：身份信息；未知 stepCode 也走这里。
           胶囊挂在和 logo 同尺寸（268rpx）、同样 flex 居中的容器里，坐标为相对容器左上，
           屏高变化时和 logo 一起走（不再靠 JS 量高度） -->
      <view v-if="currentStep && currentLayout === 'pills'" :key="`pills-${activeStep}`" class="gi__layer">
        <view class="gi__layer-core">
          <view
            v-for="(item, index) in currentOptions"
            :key="`${optionValue(item)}-${index}`"
            class="gi__pill"
            :class="{ 'gi__pill--selected': selectedKey === optionValue(item) }"
            :style="pillStyle(TASK_PILL_SLOTS[index], index)"
            @tap.stop="onOptionTap(item)"
          >
            <text class="gi__pill-text">
              {{ item.label }}
            </text>
          </view>
        </view>
      </view>

      <!-- 底部提示：招呼帧与自我介绍帧按设计稿留白，其余步骤用接口 hint；
           top 跟着选项区底部走（选项高矮变化时间距不变），不再贴底定位 -->
      <text
        v-if="!isWelcomeStep && !isWakeStep && currentHint"
        :key="`hint-${activeStep}`"
        class="gi__hint"
        :style="hintStyle"
        @tap.stop="onHintTap"
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

/* ===== 底部光效：常态淡蓝水面，播报 / 按住说话换成波纹色带 =====
   参考首页 index 的底部语音波纹（ai-chat-input 的 voice-panel__wave / welcome-visitor__glow）：
   - __glow：贴底 120px 容器（比波形容器多留 2px 给遮罩模糊的出血），overflow hidden；
   - __glow-fade：**常态也是波形** —— 与 .gi__wave-band 同一套几何（top 130rpx / 106rpx 高）
     和同一张 voice-listening-wave-blur-mask.svg 波形遮罩，只把色带换成最淡的冷蓝，
     顶部透明接页面背景、底部 #BFDAF4，缓慢起伏；原来那条 62px 直边渐变已去掉
     （它起点是 #FAFAFA，落在步骤态冷色背景上会露一条硬边）；
   - __glow-voice：118px 波形容器，只靠外层 opacity 淡入淡出（避免 transition 和 keyframes 抢属性）；
   - __wave-band：11332:97 Rectangle 106 的水面，播报三色带、按住 / 校验竖直蓝水面。
   状态类是根节点上的 gi--speaking / gi--recording / gi--checking。 */
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
  height: 236rpx; // 与波形容器同高，::before 才能沿用同一套遮罩坐标
  opacity: 1;
  transition: opacity 240ms ease;
  pointer-events: none;
}

/* 常态水面：几何 / 遮罩参数与 .gi__wave-band 完全一致，只换渐变——
   顶部透明（贴着页面背景消失，没有硬边）→ 底部 #BFDAF4，7s 极缓起伏 */
.gi__glow-fade::before {
  position: absolute;
  top: 130rpx; // y759 − y694 = 65px，与语音色带同一条基准线
  left: 0;
  width: 750rpx; // 375px
  height: 106rpx; // 53px
  background-image: linear-gradient(
    180deg,
    rgba(250, 250, 250, 0) 0%,
    rgba(240, 245, 251, 0.55) 36%,
    #dfeaf7 64%,
    #cfe0f5 84%,
    #bfdaf4 100%
  );
  -webkit-mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  mask-image: url("@/assets/img/voice-listening-wave-blur-mask.svg");
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 990rpx 286rpx; // 遮罩画布 495×143 @2x
  mask-size: 990rpx 286rpx;
  -webkit-mask-position: -121rpx -14rpx; // 画布原点对齐页面 (−60.5, 752)
  mask-position: -121rpx -14rpx;
  animation: gi-wave-sway 7s ease-in-out infinite alternate;
  content: "";
  pointer-events: none;
  will-change: mask-position;
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

/* 已经看不见了，常态水面的起伏动画没必要继续占合成线程 */
.gi--speaking .gi__glow-fade::before,
.gi--recording .gi__glow-fade::before,
.gi--checking .gi__glow-fade::before {
  animation-play-state: paused;
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
.gi--speaking .gi__wave-band {
  animation:
    gi-wave-color-flow 5.6s linear infinite,
    gi-wave-sway 4.8s ease-in-out infinite alternate;
}

.gi--speaking .gi__wave-band--back {
  animation:
    gi-wave-color-flow 7.6s linear infinite reverse,
    gi-wave-sway 6s ease-in-out infinite alternate;
}

/* 按住说话 / 校验中：与首页「按住说话」面板（voice-panel__wave-band）一致 ——
   竖向 #EFEFEE → #0F7EEE 的水面，没有横向色差，改用「色彩上下涨落」+ 波形摆动。
   放在三色带规则之后，同特异度覆盖播报态那套 */
.gi--recording .gi__wave-band,
.gi--checking .gi__wave-band {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    gi-wave-drift 4.8s ease-in-out infinite alternate,
    gi-wave-sway 4.8s ease-in-out infinite alternate;
}

.gi--recording .gi__wave-band--back,
.gi--checking .gi__wave-band--back {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    gi-wave-drift 6s ease-in-out infinite alternate-reverse,
    gi-wave-sway 6s ease-in-out infinite alternate;
}

/* 竖向渐变的涨落：背景比容器高 60%，上下位移时水色在浅灰与深蓝之间呼吸 */
@keyframes gi-wave-drift {
  from {
    background-position: 0 0;
  }

  to {
    background-position: 0 100%;
  }
}

/* 语音未命中：底部声纹切红 —— 与首页 331:147「唤醒失败」同一条色带
   （Rectangle 106 375×107：竖向 rgba(239,239,238,0) 0% → #E02E2A 100%）。
   红期间不做色带横向流动 / 上下涨落，只保留波形摆动，保证红色一直压在最底下；
   规则放在播报 / 录音那几套之后，同特异度靠源码顺序覆盖。
   2s 后 isMissed 自动复位，色带靠 opacity 过渡淡回常态 */
.gi--missed .gi__glow-voice {
  opacity: 1;
}

.gi--missed .gi__glow-fade {
  opacity: 0;
}

.gi--missed .gi__glow-fade::before {
  animation-play-state: paused;
}

.gi--missed .gi__wave-band {
  background-image: linear-gradient(180deg, rgba(239, 239, 238, 0) 0%, #e02e2a 100%);
  background-size: 100% 100%;
  animation: gi-wave-sway 4.8s ease-in-out infinite alternate;
}

.gi--missed .gi__wave-band--back {
  background-image: linear-gradient(180deg, rgba(239, 239, 238, 0) 0%, #e02e2a 100%);
  background-size: 100% 100%;
  animation: gi-wave-sway 6s ease-in-out infinite alternate;
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
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 与 logo 同尺寸（220rpx）的定位锚：整块被 .gi__brand 的 CSS flex 居中，
   标题 / 标语绕它绝对摆放 —— 所以 logo 永远在页面上下左右正中央，
   且和步骤帧的 SaniLogoStage（同样 CSS 居中）落在同一个中心，两帧切换图标不跳 */
.gi__brand-core {
  position: relative;
  width: 220rpx;
  height: 220rpx;
}

/* 306:2801 + 306:2782：24px Medium，两段连写无间隙 */
.gi__brand-title {
  position: absolute;
  bottom: calc(100% + 58rpx); // 标题行盒底 → 图标顶 ≈ 29px
  left: 50%;
  display: flex;
  align-items: flex-start;
  transform: translateX(-50%);
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
  position: absolute;
  inset: 0;
  width: 220rpx;
  height: 220rpx;
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 80ms both;
}

/* 文案组：标语 + 两行灰色描述，行间 2px */
.gi__brand-caption {
  position: absolute;
  top: calc(100% + 89rpx); // 图标底 → 标语顶 ≈ 44.5px
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  transform: translateX(-50%);
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


.gi__layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* 和 logo 容器同尺寸、同样居中的定位容器：胶囊以它为原点绝对定位，屏高变化时跟着 logo 走 */
.gi__layer-core {
  position: relative;
  flex: none;
  width: 268rpx;
  height: 268rpx;
  pointer-events: none;
}


/* ===== 胶囊版式（350:1119 / 350:1204 / 350:1288 身份信息）=====
   与首页「老板身份信息」帧（welcome-visitor__detail-tag，1006:313 等）同一套处理：
   - 填充：紫粉蓝线性渐变，整体 16% 不透明（#3D21CD 0% → #C1E4FF 27.8% → #7B9CFF 50.9%
     → #C067FA 71.2% → #F7CFFF 85.8% → #FD90C4 100%），Figma 方向 3.66° → CSS 93.66deg
   - 描边：不画，只保留渐变填充（原 2px OUTSIDE 渐变描边的 ::before 已移除，与首页一致）
   - 投影：0 3 16 rgba(0,159,235,.127)；背景模糊 29px
   - 入场：方案 4「全息升维翻展」，从中心图标圆心翻折飞回自己的槽位
   - 宽度：文案单行、宽度随文案走（min-width 兜底短文案），不再按 max-width 折行 */
.gi__pill {
  /* 填充不透明度抽成变量：默认态是设计稿的 16%，
     命中态（--selected）抬到 34%，与首页身份球「高亮玻璃」同一套思路 */
  --pill-fill-alpha: 0.16;
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 64rpx; // 32px
  pointer-events: auto;
  /* 单行：宽度按文案自然撑开（绝对定位 + max-width 会 shrink-to-fit 成 min-width，进而折行） */
  width: max-content;
  white-space: nowrap;
  /* 设计稿内边距 6/18：单行时正好 12 + 40 + 12 = 64rpx */
  padding: 12rpx 36rpx;
  border-radius: 76rpx; // 38
  background-image: linear-gradient(
    93.66deg,
    rgba(61, 33, 205, var(--pill-fill-alpha)) 0%,
    rgba(193, 228, 255, var(--pill-fill-alpha)) 27.8%,
    rgba(123, 156, 255, var(--pill-fill-alpha)) 50.9%,
    rgba(192, 103, 250, var(--pill-fill-alpha)) 71.2%,
    rgba(247, 207, 255, var(--pill-fill-alpha)) 85.8%,
    rgba(253, 144, 196, var(--pill-fill-alpha)) 100%
  );
  /* 投影按首页 detail-tag：只留 0 3 16 那层冷蓝光，去掉黑色投影 */
  box-shadow: 0 6rpx 32rpx rgba(0, 159, 235, 0.127);
  -webkit-backdrop-filter: blur(58rpx); // 29px
  backdrop-filter: blur(58rpx);
  animation: gi-bubble-holo 1200ms cubic-bezier(0.16, 1, 0.3, 1) var(--holo-delay, 0ms) backwards;
  will-change: transform, opacity, filter;
}

/* 按住反馈：全息胶囊本身很轻，压一下 + 提亮就够，不改填充 */
.gi__pill:active {
  filter: brightness(1.08);
  transform: scale(0.97);
}

/* 命中 / 选中态：与首页 index 身份球（welcome-visitor__bubble--active）同一套 ——
   玻璃填充与描边一起提亮 + 白色柔光外圈 + 1.04 → 1.08 呼吸。语音命中停留 HIT_HOLD_MS，
   点选走同一套（停留 SELECT_DELAY_MS）；animation 覆盖入场 keyframes，两段不抢 transform */
.gi__pill--selected {
  --pill-fill-alpha: 0.34;
  z-index: 2;
  box-shadow:
    0 0 12rpx 2rpx rgba(255, 255, 255, 0.85),
    0 0 20rpx 4rpx rgba(158, 199, 255, 0.45),
    0 10rpx 24rpx rgba(88, 138, 220, 0.24);
  animation: gi-pill-pick 1.2s ease-in-out infinite;
}

/* 胶囊命中呼吸：与首页 welcome-bubble-pick 同一节奏 */
@keyframes gi-pill-pick {
  0%,
  100% {
    transform: scale(1.03);
  }

  50% {
    transform: scale(1.07);
  }
}

.gi__pill-text {
  color: #0d0d0d;
  font-size: 28rpx; // 14
  font-weight: 500;
  line-height: 40rpx; // 20
  text-align: center;
  /* 一律单行：不换行、不折词；接口 label 里带 \n 也按空格显示，避免把胶囊撑成两行 */
  white-space: nowrap;
}

/* 方案 4「全息升维翻展」：与首页欢迎页的身份球 / 开始体验胶囊同一套关键帧，
   起始帧贴在图标圆心（--holo-dx/dy 由模板按槽位算好），60% 处先亮到 1.2 再回落 */
@keyframes gi-bubble-holo {
  0% {
    transform: translate(var(--holo-dx, 0), var(--holo-dy, 0)) rotateX(var(--holo-rx, 85deg))
      rotateY(var(--holo-ry, 45deg)) scale(0);
    opacity: 0;
    filter: brightness(2);
  }

  60% {
    opacity: 1;
    filter: brightness(1.2);
  }

  100% {
    transform: translate(0, 0) rotateX(0deg) rotateY(0deg) scale(1);
    opacity: 1;
    filter: brightness(1);
  }
}

/* 底部提示：16px / 23px #8E8E8E 居中。
   top 由 hintStyle 用 max(calc(50% + 选项区偏移), calc(100% − 430rpx)) 内联给，
   CSS 百分比自动跟随屏高，不再靠 JS 量视口；这里的 bottom 只是纯文案帧的兜底，
   位置与首页欢迎页的 bottom: 384rpx 一致 */
.gi__hint {
  position: absolute;
  right: 0;
  bottom: 384rpx; // 192px，与首页 welcome-visitor__choose-hint 同一条线
  left: 0;
  padding: 0 40rpx;
  color: #8e8e8e;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
  text-align: center;
  /* 与首页欢迎态 detail-hint 同一套：淡入上浮、延后 300ms */
  animation: gi-rise 480ms cubic-bezier(0.22, 0.61, 0.36, 1) 300ms both;
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
</style>

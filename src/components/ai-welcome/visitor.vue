<script setup lang="ts">
import type { WakeStep, WakeValidateResult } from "@/api/chat/types";
import type { FlowStep, FlowStepOption } from "@/api/flow";
import type { RoleOption } from "@/api/user-role/role-options";
import type { VisitorRole } from "@/stores";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { recognizeSpeechByBase64, recognizeSpeechByUpload, recognizeSpeechByUrl, validateWakeWord } from "@/api/chat";
import { getFlowSteps } from "@/api/flow";
import { getRoleOptions, getTodayAwakeningPrompt } from "@/api/user-role";
import brandLogo from "@/assets/img/header-island-logo.png";
import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY, VISITOR_ROLE_OPTIONS_CACHE_KEY } from "@/config";
import { REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { usePlainTts } from "@/hooks/usePlainTts";
import { DEFAULT_CHAT_SCOPE, useChatStore, useUserStore, VISITOR_ROLE_ACCOUNTS } from "@/stores";
import { createLogger } from "@/utils/logger";
import { ensureNativePermission } from "@/utils/platform/mpaas";
import { setGuestRole } from "@/utils/request";
import VoiceRecorder from "@/utils/voiceRecorder.js";

defineOptions({ name: "AiWelcomeVisitor" });
const logger = createLogger("visitor");
// 身份信息页命中「开始体验」后要按 role-select 页同样的方式进首页，需要身份 / 会话两个 store
const userStore = useUserStore();
const chatStore = useChatStore(DEFAULT_CHAT_SCOPE);

/**
 * 自我介绍文案：Ardot 306:6467（日常运营助手- SANI自我介绍）。
 * 设计稿为 20px Medium / 行高 29px / #0D0D0D 的三行左对齐文本（x=53、y=117、宽 297）。
 * 只在「长按录音 → 松手」的收尾态出现，同时把 Hey,SANI 与下方文案淡出。
 */
const INTRO_LINES = ["欢迎了解日常运营AI助手", "设备有事早知道，", "少跑现场少翻表"];
/** 行与行错开的入场延迟，三行依次浮出 */
const INTRO_STAGGER_MS = 120;
/** 等旧文案淡出（320ms）之后再浮字，形成「渐变 → 旧文字退 → 新文字进」的顺序 */
const INTRO_ENTER_DELAY_MS = 340;
/** 等首行站定后再开口，避免「声先到、字未现」 */
const INTRO_SPEAK_DELAY_MS = 900;

/** 文案是否已进入（控制淡入上浮） */
const introVisible = ref(false);
const introTts = usePlainTts();

let introEnterTimer: ReturnType<typeof setTimeout> | null = null;
let introSpeakTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 口播收尾后的身份选择稿：Ardot 722:2651「100号游客，请选择你的身份吧」。
 * 标题 722:2734：20px Medium / 行高 29px / #0D0D0D（x=53、y=117、宽 275）；
 * 底部提示 722:2744：16px / 行高 23px / #8E8E8E（x=102、y=597 居中）；
 * 中心图标 722:2652：134×134 @ (120,333)；身份玻璃球的数据源见 identityOptions。
 * 三行自我介绍播完就地过渡到这里，不跳页。
 */
/** 顶部标题，同时也是第二段口播的文本（下方提示只做视觉，不念） */
const CHOICE_TITLE = "100号游客，请选择你的身份吧";
const CHOICE_HINT = "可以和我说选择哪个身份";
/**
 * 身份选择页真正展示 / 播报的标题：优先取 GET /flow/steps 里 stepCode = IDENTITY 的 title，
 * 接口没回来或没有该步骤时沿用设计稿文案
 */
const identityTitle = ref(CHOICE_TITLE);
/** 等自我介绍三行退场之后再浮身份，保持「旧文字退 → 新文字进」的节奏 */
const CHOICE_ENTER_DELAY_MS = 420;
/** 气泡之间错开的入场延迟（动效方案 4 的原稿是 0.15 / 0.28 / 0.40s，取约 130ms 一档） */
const CHOICE_STAGGER_MS = 130;
/** 标题站定后再开口，接在自我介绍后面形成连续的两段口播 */
const CHOICE_SPEAK_DELAY_MS = 420;
/** 动效方案 4「全息升维翻展」：第一颗气泡的出场延迟（原稿 0.15s） */
const CHOICE_HOLO_DELAY_MS = 150;
/** 动效方案 4：气泡从图标中心 3D 翻折展开的时长（原稿 1.2s），落位后才接漂浮 */
const CHOICE_HOLO_DURATION_MS = 1200;
/** 中心图标容器（设计稿 x=120 y=333 134×134）在内容区的中心点，rpx：(374, 692) */
const CHOICE_CORE_X = 374;
const CHOICE_CORE_Y = 692;

interface ChoiceBubble {
  key: string;
  /** 身份球对应的后端角色码；装饰球留空 */
  roleCode?: string;
  /** 球内文案；装饰球为空 */
  label: string;
  /** 装饰球（722:2720 / 722:2717 / 722:2714 / 722:2665）的纵向渐变色 */
  fill?: [string, string];
  /**
   * 身份玻璃球标记（722:3064 / 1006:16 / 1006:3）：带内部虹彩与玻璃质感。
   * 三颗球默认用同一套色（即 1006:3 操作手那套）；只有被选中 / 命中时才切到
   * 722:3064 的高亮玻璃态，两套色值都写在样式表里（见 .welcome-visitor__bubble--role）
   */
  glass?: boolean;
  /** 设计稿坐标是 375×812（含 54 高状态栏），这里已扣掉状态栏并换成 rpx（1px = 2rpx） */
  x: number;
  y: number;
  size: number;
  fontSize: number;
}

/** 身份球在 722:2651 里的三个位置（坐标已扣 54 高状态栏并换算成 rpx），按角色码对位 */
const CHOICE_ROLE_SLOTS: Record<string, { x: number; y: number }> = {
  // 722:3064 老板：x=242 y=268 82×82
  OWNER: { x: 484, y: 428 },
  // 1006:16 设备管理员：x=39 y=337.4 82×82
  ADMIN: { x: 78, y: 566.8 },
  // 1006:3 操作手：x=242 y=449 82×82
  OPERATOR: { x: 484, y: 790 },
};
/** 上面没覆盖到的角色码依次领剩下的位置，保证顺序稳定 */
const CHOICE_SLOT_ORDER = ["OWNER", "ADMIN", "OPERATOR"];
const CHOICE_ROLE_SIZE = 164; // 82px
const CHOICE_ROLE_FONT_SIZE = 32; // 16px

/** 装饰玻璃球 722:2720 (97,243)50 / 722:2717 (314,374)42 / 722:2714 (55,471)28 / 722:2665 (140,523)28 */
const CHOICE_DECO_BUBBLES: ChoiceBubble[] = [
  { key: "dot-a", label: "", fill: ["#e7eaff", "#f0f2ff"], x: 194, y: 378, size: 100, fontSize: 0 },
  { key: "dot-b", label: "", fill: ["#e3f5ff", "#f1faff"], x: 628, y: 640, size: 84, fontSize: 0 },
  { key: "dot-c", label: "", fill: ["#e7eaff", "#f0f2ff"], x: 110, y: 834, size: 56, fontSize: 0 },
  { key: "dot-d", label: "", fill: ["#def1fc", "#f1faff"], x: 280, y: 938, size: 56, fontSize: 0 },
];

/**
 * 接口没回来（或没有 IDENTITY 步骤）时的兜底身份：设计稿这三颗球的角色码与文案，
 * 顺序与 CHOICE_SLOT_ORDER 一致
 */
const CHOICE_FALLBACK_ROLES = [
  { roleCode: "OWNER", label: "老板" },
  { roleCode: "ADMIN", label: "设备管理员" },
  { roleCode: "OPERATOR", label: "操作手" },
];

/** 身份球里的角色名：超过 3 个字就断成两行（设计稿「设备 / 管理员」就是两行），球内排版不挤 */
function formatRoleLabel(name: string) {
  const text = String(name || "").trim();
  if (text.length <= 3) return text;
  const mid = Math.floor(text.length / 2);
  return `${text.slice(0, mid)}\n${text.slice(mid)}`;
}

/** 把 role 列表收敛成「roleCode → roleName」，供身份球取文案 */
function toRoleNameMap(roles: RoleOption[]) {
  const map: Record<string, string> = {};
  roles.forEach((role) => {
    if (role?.roleCode && role?.roleName) map[role.roleCode] = role.roleName;
  });
  return map;
}

/** 先读缓存：进过角色选择页 / 上次启动预取过，这里就能直接拿到 roleName，不用等接口 */
function readCachedRoleNames() {
  try {
    const cached = uni.getStorageSync(VISITOR_ROLE_OPTIONS_CACHE_KEY);
    if (!Array.isArray(cached)) return {};
    return toRoleNameMap(cached as RoleOption[]);
  }
  catch (error) {
    logger.warn("failed to read role options cache", error);
    return {};
  }
}

/** roleCode → roleName，来源：visitor_role_options_cache（缓存没有时用本次接口结果补） */
const roleNames = ref<Record<string, string>>(readCachedRoleNames());

/** GET /flow/steps 里 IDENTITY 步骤的选项，接口回来前为空 */
const identityOptions = ref<FlowStepOption[]>([]);

/**
 * 身份球的文案与角色码：以 IDENTITY.options 为数据源（label 展示、hitValue 即角色码），
 * 按 sortNo 升序排。接口没回来 / 没有该步骤时退回设计稿那三个角色，
 * 并用缓存里的 roleName 覆盖文案；缓存完全没有角色数据时就用设计稿文案，
 * 有数据但缺某个角色时那颗球不展示（避免点到不存在的角色）。
 */
const choiceRoleSources = computed(() => {
  const options = identityOptions.value
    .filter(option => String(option?.label || "").trim())
    .sort((a, b) => (Number(a.sortNo) || 0) - (Number(b.sortNo) || 0));
  if (options.length) {
    return options.map(option => ({
      roleCode: String(option.hitValue || "").trim().toUpperCase(),
      label: String(option.label).trim(),
    }));
  }
  const names = roleNames.value;
  const hasRoleData = Object.keys(names).length > 0;
  return CHOICE_FALLBACK_ROLES
    .filter(role => !hasRoleData || !!names[role.roleCode])
    .map(role => ({ roleCode: role.roleCode, label: names[role.roleCode] || role.label }));
});

/**
 * 身份球本体：按角色码优先落回设计稿里自己的位置，接口给了新角色时依次领剩余位置；
 * 位置池只有三个（设计稿只画了三颗球），多出来的不再渲染，避免球叠在一起。
 */
function buildChoiceRoleBubbles(): ChoiceBubble[] {
  const used = new Set<string>();
  const bubbles: ChoiceBubble[] = [];
  choiceRoleSources.value.forEach((source) => {
    const slot = CHOICE_SLOT_ORDER.includes(source.roleCode) && !used.has(source.roleCode)
      ? source.roleCode
      : CHOICE_SLOT_ORDER.find(code => !used.has(code));
    if (!slot) {
      logger.warn("identity bubbles exceed design slots", source.roleCode);
      return;
    }
    used.add(slot);
    bubbles.push({
      key: (source.roleCode || slot).toLowerCase(),
      roleCode: source.roleCode || undefined,
      label: formatRoleLabel(source.label),
      glass: true,
      x: CHOICE_ROLE_SLOTS[slot].x,
      y: CHOICE_ROLE_SLOTS[slot].y,
      size: CHOICE_ROLE_SIZE,
      fontSize: CHOICE_ROLE_FONT_SIZE,
    });
  });
  return bubbles;
}

/**
 * 动效方案 4「全息升维翻展」（Holo Flip）的入场参数：气泡从中心图标处以 3D 轴心
 * 翻折展开、飞回自己的位置，落位后不再位移。
 * - holoDx / holoDy：起点相对终点的偏移 = 图标中心 − 气泡中心（rpx），即气泡从圆心飞出
 * - holoRx / holoRy：翻起的起始倾角，按气泡相对图标的方位取，保证「翻折面」朝外，
 *   与方案稿里老板 85°/45°、设备管理员 -85°/-45°、操作手 85°/-45° 的取法一致
 * - style：模板直接绑定的静态样式（位置 / 尺寸 / 字号 / 翻折起点），
 *   逐项对应 722:2651 身份选择稿，避免在模板里堆表达式
 */
const CHOICE_BUBBLE_HOLO = computed(() => {
  return [...buildChoiceRoleBubbles(), ...CHOICE_DECO_BUBBLES].map((bubble, index) => {
    const centerX = bubble.x + bubble.size / 2;
    const centerY = bubble.y + bubble.size / 2;
    return {
      ...bubble,
      style: {
        left: `${bubble.x}rpx`,
        top: `${bubble.y}rpx`,
        width: `${bubble.size}rpx`,
        height: `${bubble.size}rpx`,
        fontSize: `${bubble.fontSize}rpx`,
        // 装饰球只有一层纵向渐变（722:2720 等）；身份玻璃球的分层渐变在样式表里拼
        backgroundImage: bubble.fill
          ? `linear-gradient(180deg, ${bubble.fill[0]} 0%, ${bubble.fill[1]} 100%)`
          : undefined,
        "--holo-dx": `${CHOICE_CORE_X - centerX}rpx`,
        "--holo-dy": `${CHOICE_CORE_Y - centerY}rpx`,
        "--holo-rx": centerY < CHOICE_CORE_Y ? "85deg" : "-85deg",
        "--holo-ry": centerX > CHOICE_CORE_X ? "45deg" : "-45deg",
        "--holo-delay": `${CHOICE_HOLO_DELAY_MS + index * CHOICE_STAGGER_MS}ms`,
      },
    };
  });
});

interface RoleDetailTag {
  key: string;
  /** 胶囊文案（设计稿 14px Medium #0D0D0D） */
  text: string;
  /** 相对 134×134 图标容器左上角的水平偏移（rpx） */
  left: number;
  /** 相对 134×134 图标容器左上角的纵向偏移（rpx） */
  top: number;
  /** 胶囊宽度（rpx） */
  width: number;
}

/** 胶囊 + 全息翻折入场参数 */
interface RoleDetailTagHolo extends RoleDetailTag {
  holoDx: number;
  holoDy: number;
  holoRx: string;
  holoRy: string;
}

/** 图标容器中心（268×268rpx 的一半），胶囊的翻折轴心与方位都以它为基准 */
const DETAIL_CORE_CENTER = 134;
/** 胶囊高 32px → 64rpx */
const DETAIL_TAG_HEIGHT = 64;
/** 胶囊字号 14px → 28rpx */
const DETAIL_TAG_FONT_SIZE = 28;
/** 胶囊左右内边距合计：设计稿文字左右各 18px → 72rpx；接口文案长度不定，宽度按「文字宽 + 内边距」估算 */
const DETAIL_TAG_PADDING = 72;

/**
 * Ardot 331:382「日常运营助手- 点开老板身份 看详细信息」里绕着中心图标的 6 个设备信息胶囊
 * （331:389 / 331:392 / 331:444 / 331:394 / 331:456 / 331:442）。
 * 位置池存的是「相对图标容器（设计稿 x=120 y=333 134×134）的中心点」，按 1px = 2rpx 换算：
 * 实际胶囊宽度由接口文案决定，用中心点 + 宽度反推 left，胶囊才会稳定地「绕着图标」居中，
 * 不会因为文案长短往一侧偏。图标在任意屏高下由 flex 居中，胶囊仍跟着图标。
 */
const DETAIL_TAG_SLOTS = [
  { centerX: -50, centerY: -10 },
  { centerX: 356, centerY: -10 },
  { centerX: 384, centerY: 142 },
  { centerX: -114, centerY: 174 },
  { centerX: 352, centerY: 300 },
  { centerX: -6, centerY: 344 },
];

/** 身份信息页的兜底胶囊文案（设计稿原文），接口没回来 / 没有该步骤时用它 */
const DETAIL_TAG_FALLBACK = [
  "38台体验设备",
  "4台混凝土泵车",
  "4台履带吊",
  "2个项目",
  "15台电动自卸车",
  "15台电动混凝土搅拌车",
];

/**
 * 身份信息页的气泡数据：GET /flow/steps?module=ASK&roleCode=xxx 里
 * stepCode = IDENTITY_DETAIL 的 options（身份选择页命中后按 data.hitValue 拉取）。
 */
const identityDetailOptions = ref<FlowStepOption[]>([]);
/** 当前这批详情 bubble 对应的角色码，点老板时用它判断要不要重新拉 */
let identityDetailRole = "";
/** 当前身份信息页对应的角色码：命中「开始体验」时按它进首页 */
let detailRoleCode: VisitorRole = "OWNER";

/** 后端角色码 → 本地 VisitorRole；不认识的码退回老板，避免 setVisitorRole 传空 */
function toVisitorRole(roleCode: string): VisitorRole {
  const code = String(roleCode || "").trim().toUpperCase();
  return (code in VISITOR_ROLE_ACCOUNTS ? code : "OWNER") as VisitorRole;
}

/** 胶囊宽度按文案估算：汉字 1em、半角 0.5em，再加左右内边距 */
function estimateDetailTagWidth(text: string) {
  const textWidth = Array.from(text).reduce(
    (sum, char) => sum + (/[\u0000-\u00ff]/.test(char) ? DETAIL_TAG_FONT_SIZE / 2 : DETAIL_TAG_FONT_SIZE),
    0,
  );
  return Math.round(textWidth + DETAIL_TAG_PADDING);
}

/**
 * 设备胶囊沿用身份选择页的方案 4「全息升维翻展」：从图标中心 3D 翻折展开后落位。
 * holoDx / holoDy = 图标容器中心 − 胶囊中心（相对图标容器的偏移，rpx）；
 * holoRx / holoRy 按胶囊在图标四周的方位取，保证翻折面朝外。
 * 文案按 sortNo 顺序取 IDENTITY_DETAIL.options，超过 6 条不再渲染（设计稿只有 6 个位置）。
 */
const ROLE_DETAIL_TAG_HOLO = computed<RoleDetailTagHolo[]>(() => {
  const options = identityDetailOptions.value;
  const labels = options.length
    ? options.map(option => String(option.label || "").trim()).filter(Boolean)
    : DETAIL_TAG_FALLBACK;
  if (labels.length > DETAIL_TAG_SLOTS.length) {
    logger.warn("identity detail bubbles exceed design slots", labels.length);
  }
  return labels.slice(0, DETAIL_TAG_SLOTS.length).map((text, index) => {
    const slot = DETAIL_TAG_SLOTS[index];
    const width = estimateDetailTagWidth(text);
    return {
      key: `detail-tag-${index}`,
      text,
      left: Math.round(slot.centerX - width / 2),
      top: Math.round(slot.centerY - DETAIL_TAG_HEIGHT / 2),
      width,
      holoDx: DETAIL_CORE_CENTER - slot.centerX,
      holoDy: DETAIL_CORE_CENTER - slot.centerY,
      holoRx: slot.centerY < DETAIL_CORE_CENTER ? "85deg" : "-85deg",
      holoRy: slot.centerX > DETAIL_CORE_CENTER ? "45deg" : "-45deg",
    };
  });
});

/** 详情页标题 331:391：x=53 y=117 180×29，20px / 行高 29px / Medium / #0D0D0D */
const ROLE_DETAIL_TITLE = "以下为老板身份信息";
/**
 * 详情页真正展示 / 播报的标题：优先取 IDENTITY_DETAIL.title，
 * 接口没回来 / 没有该步骤时用设计稿句式兜底（见 buildDetailTitle）
 */
const identityDetailTitle = ref(ROLE_DETAIL_TITLE);
/** 等 IDENTITY_DETAIL.title 的最长时间：接口太慢就先念兜底标题，别让页面一直不出声 */
const DETAIL_TITLE_WAIT_MS = 3000;
/** 详情标题等标题落位之后再开口 */
const DETAIL_SPEAK_DELAY_MS = 320;
/** 详情标题那句口播的计时器 */
let detailSpeakTimer: ReturnType<typeof setTimeout> | null = null;
/** 详情标题口播的会话序号：离开详情 / 跳走时自增，作废在途的「等数据 → 开口」 */
let detailSpeakSeq = 0;
/** 详情页底部提示 331:428：x=102 y=597 176×23，16px / 行高 23px / Medium / #8E8E8E */
const ROLE_DETAIL_HINT = "可以和我说“开始体验”";
/** 等身份选择稿淡出（260ms）之后再浮出详情，避免两套标题在同一位置叠加 */
const DETAIL_ENTER_DELAY_MS = 280;
/** 胶囊之间错开的入场延迟，与身份球保持同一节奏 */
const DETAIL_TAG_STAGGER_MS = CHOICE_STAGGER_MS;
/** 第一颗胶囊的出场延迟，与身份球一致 */
const DETAIL_HOLO_DELAY_MS = CHOICE_HOLO_DELAY_MS;

/**
 * 口播文本：展示文案按行排版，交给 TTS 前按行补句读拼成一段话。
 * 第一行是完整的介绍句，用句号收住 —— TTS 才会在这里做句末停顿，
 * 不会把「欢迎了解日常运营AI助手」和后面的口号一口气连读；
 * 后两行是连读的口号，用逗号衔接，避免读成一字一顿。
 */
function buildIntroSpeechText() {
  const lines = INTRO_LINES
    .map(line => line.trim().replace(/[，,。.]$/, ""))
    .filter(Boolean);
  if (!lines.length) return "";
  const [head, ...rest] = lines;
  return rest.length ? `${head}。${rest.join("，")}。` : `${head}。`;
}

/**
 * 无手势时部分 WebView 会拦截音频自动播放：这段语音没播起来，就在用户第一次触摸时补播一次；
 * 已经播出过（started）不再重播。监听挂在 document 上，不介入页面本身的长按手势。
 */
let introGestureRetry: (() => void) | null = null;
/** 补播的触发时机：移动端首触，PC 预览用 click 兜底 */
const INTRO_GESTURE_EVENTS = ["touchstart", "click"] as const;

function disarmVoiceRetry() {
  const handler = introGestureRetry;
  if (!handler) return;
  introGestureRetry = null;
  INTRO_GESTURE_EVENTS.forEach(name => document.removeEventListener(name, handler));
}

/** 给刚发起的一段口播挂上「首触补播」，text 与本次 speak 的内容一致 */
function armVoiceRetry(text: string) {
  disarmVoiceRetry();
  const handler = () => {
    disarmVoiceRetry();
    if (introTts.started.value) return;
    introTts.speak(text);
  };
  introGestureRetry = handler;
  INTRO_GESTURE_EVENTS.forEach(name => document.addEventListener(name, handler, { once: true, passive: true }));
}

/** 收尾态入场：文案逐行浮出 + 同步口播（不跳转页面，只在当前起始页过渡） */
function startIntro() {
  introEnterTimer = setTimeout(() => {
    introEnterTimer = null;
    introVisible.value = true;
  }, INTRO_ENTER_DELAY_MS);
  introSpeakTimer = setTimeout(() => {
    introSpeakTimer = null;
    const text = buildIntroSpeechText();
    introTts.speak(text);
    armVoiceRetry(text);
  }, INTRO_SPEAK_DELAY_MS);
}

/** 收尾态复位：文案退回隐藏、口播停止、身份选择态收起（从角色选择页返回时回到起始态） */
function resetIntro() {
  if (introEnterTimer) {
    clearTimeout(introEnterTimer);
    introEnterTimer = null;
  }
  if (introSpeakTimer) {
    clearTimeout(introSpeakTimer);
    introSpeakTimer = null;
  }
  if (choiceEnterTimer) {
    clearTimeout(choiceEnterTimer);
    choiceEnterTimer = null;
  }
  if (choiceSpeakTimer) {
    clearTimeout(choiceSpeakTimer);
    choiceSpeakTimer = null;
  }
  if (detailEnterTimer) {
    clearTimeout(detailEnterTimer);
    detailEnterTimer = null;
  }
  if (detailSpeakTimer) {
    clearTimeout(detailSpeakTimer);
    detailSpeakTimer = null;
  }
  if (identityHitTimer) {
    clearTimeout(identityHitTimer);
    identityHitTimer = null;
  }
  disarmVoiceRetry();
  introTts.stop();
  introVisible.value = false;
  choiceVisible.value = false;
  isChoosing.value = false;
  chooseOut.value = false;
  isRoleDetail.value = false;
  detailVisible.value = false;
  selectedBubbleKey.value = "";
  // 唤醒校验相关也一并复位，回到「起始态 • 未唤醒」的观感
  isChecking.value = false;
  isFinishing.value = false;
  // 作废在途的详情标题口播
  detailSpeakSeq += 1;
  clearWakeMissed();
}

/**
 * 整页长按：按住 280ms 进入「录音态」（底部渐变切深色）并真的开始录音，松手后停录并送识别；
 * 同时底部沿用这套蓝渐变与波浪、文案换成本次自我介绍并口播，口播播完就地过渡到「身份选择」态。
 * 识别结果这一版只打日志 —— 后续要拿这段话再调一次接口，由接口决定是否能进入下一步。
 */
const HOLD_START_MS = 280;
/** 长按判定前手指位移超过这个距离视为滑动，不进入录音态 */
const HOLD_MOVE_PX = 12;
/** 识别接口兜底超时：上传的 timeout 在个别容器里不生效 */
const ASR_TIMEOUT_MS = 30_000;
/**
 * 口播兜底时长：正常流程是「播完才过渡」，这个只针对压根没播起来的情况
 * （自动播放被 WebView 拦掉、TTS 合成失败），到点直接过渡到身份选择态。
 */
const INTRO_SPEECH_FAILSAFE_MS = 5000;

/** 按住中：底部渐变切到录音态配色 */
const isRecording = ref(false);
/** 松手后的收尾态：底部沿用录音态的蓝渐变 + 波浪，文案换成本次自我介绍 */
const isFinishing = ref(false);
/** 松手后的「唤醒校验中」：底部保持按住那套蓝波纹，等 /speech/wake/validate 回结果 */
const isChecking = ref(false);
/** 唤醒未命中：底部渐变换成 331:147「唤醒失败」的红，停在起始页等用户重试 */
const isWakeMissed = ref(false);
/** 口播收尾后的身份选择态：标题 + 身份气泡 + 底部提示，仍在同一页内 */
const isChoosing = ref(false);
/**
 * 底部是否回到「常态」那一缕淡蓝：只要还在播报 / 按住录音 / 校验中 / 未命中红，
 * 就交给对应的色带（--finishing / --recording / --checking / --missed），这几样都停了才淡回常态。
 * 身份选择页与身份信息页共用同一套判定：详情页没有播报、没有长按时同样是常态视觉。
 */
const isGlowIdle = computed(
  () => isFinishing.value && !isRecording.value && !isChecking.value && !isWakeMissed.value && !introTts.playing.value,
);
/** 身份选择内容是否已浮出（控制淡入上浮） */
const choiceVisible = ref(false);
/**
 * 当前被选中 / 命中的身份球 key。
 * 三颗玻璃球默认长一样（1006:3 操作手那套配色）；只有选中的那颗切到 722:3064 的高亮玻璃态，
 * 按压时也走同一套高亮（样式表里的 :active）。
 */
const selectedBubbleKey = ref("");
/** 点老板后身份球原地淡出（淡出后不再可点），图标不参与任何位移 */
const chooseOut = ref(false);
/** 老板身份详情态：Ardot 331:382，标题 + 6 个设备胶囊 + 提示 + 底部极光 */
const isRoleDetail = ref(false);
/** 详情内容是否已浮出（控制淡入上浮） */
const detailVisible = ref(false);
/**
 * 语音命中某个身份球后的停留时长：先点亮命中的那颗球（高亮玻璃 + 放大光晕 + 呼吸），
 * 让用户看清「选中了哪个」，停顿一下再进身份信息页，避免选中态一闪而过。
 */
const IDENTITY_HIT_HOLD_MS = 900;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let speechFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
let choiceEnterTimer: ReturnType<typeof setTimeout> | null = null;
let choiceSpeakTimer: ReturnType<typeof setTimeout> | null = null;
let detailEnterTimer: ReturnType<typeof setTimeout> | null = null;
/** 命中身份球 → 进详情页的延时器 */
let identityHitTimer: ReturnType<typeof setTimeout> | null = null;
/** 跳转中标记：避免重复触发 openRoleSelect / startExperience，也用来掐掉跳转前的待播口播 */
let navigating = false;
let holdStartX = 0;
let holdStartY = 0;

function readPoint(e: any) {
  const point = e?.touches?.[0] || e?.changedTouches?.[0] || e;
  return { x: Number(point?.clientX ?? 0), y: Number(point?.clientY ?? 0) };
}

function clearHoldTimer() {
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = null;
}

function clearSpeechFailsafe() {
  if (!speechFailsafeTimer) return;
  clearTimeout(speechFailsafeTimer);
  speechFailsafeTimer = null;
}

/* ---------------- 长按录音：按住真的录，松手走一次语音识别 ---------------- */

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

let recorder: RecorderLike | null = null;
/** 录音会话序号：松手 / 取消 / 卸载后，旧的异步回调一律作废 */
let recordSeq = 0;
/**
 * 当前这次按压的启动过程。松手时可能还在申请权限 / 启动录音器，
 * 所以要把它留着等 —— 否则「第一次按（带权限弹窗）就松手」会一次识别都发不出去。
 */
let recordJob: { seq: number; start: Promise<RecorderResult | null>; step: WakeStep } | null = null;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs = ASR_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`request timeout after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 进入录音态时开始录。
 * 这一步的任何失败都只记日志、不打断引导流程：本次识别结果暂不使用，
 * 麦克风没授权 / 录音器起不来时页面该走的流程照走。
 */
function startRecording() {
  const seq = ++recordSeq;
  // 校验接口按阶段区分：起始页说唤醒词（HEY）、身份选择页说身份（IDENTITY）、
  // 身份信息页说「开始体验」（START）
  const step: WakeStep = isRoleDetail.value ? "START" : isChoosing.value ? "IDENTITY" : "HEY";
  const start = (async () => {
    const granted = await ensureNativePermission("record_audio");
    if (seq !== recordSeq) return null;
    if (!granted) {
      logger.warn("mic permission denied, skip visitor recording");
      return null;
    }
    const result = await ensureRecorder().start({ sampleRate: 16000, timeSlice: 1000 });
    if (seq !== recordSeq) return result;
    if (!result?.success) logger.warn("visitor recorder start failed", result?.error);
    return result;
  })().catch((error) => {
    logger.warn("visitor recorder start failed", error);
    return null;
  });
  recordJob = { seq, start, step };
}

/** 唤醒校验超时：超过就按未命中处理，别让页面一直停在「校验中」 */
const WAKE_VALIDATE_TIMEOUT_MS = 8000;
/** 未命中的红色停留时长：2s 后自动淡回常态（色带本身带 opacity 过渡，撤类即淡出） */
const WAKE_MISS_RESET_MS = 2000;
/** 红色自动淡回常态的计时器 */
let wakeMissedTimer: ReturnType<typeof setTimeout> | null = null;

function clearWakeMissedTimer() {
  if (!wakeMissedTimer) return;
  clearTimeout(wakeMissedTimer);
  wakeMissedTimer = null;
}

/** 回到常态：撤掉「未命中」的红与计时器（自动淡回 / 下一次按压 / 取消 / 从角色页返回时调用） */
function clearWakeMissed() {
  clearWakeMissedTimer();
  isWakeMissed.value = false;
}

/**
 * 校验命中：
 * - 起始页 → 进入欢迎流程（Ardot 306:6467 → 306:6468）：标题淡出、底部粉色三色带、
 *   自我介绍浮出并口播，播完过渡到身份选择态；
 * - 身份选择页 / 身份信息页（就地录音）→ 页面内容一律不动，只把底部从录音态收回常态
 *   （是否常态由 isGlowIdle 按「播报 / 录音 / 校验 / 未命中」自动判定）。
 */
function enterWelcome() {
  if (!isChecking.value) return;
  if (isChoosing.value) {
    isChecking.value = false;
    return;
  }
  isChecking.value = false;
  isFinishing.value = true;
  startIntro();
  armSpeechFailsafe();
  // 自我介绍口播的同时把 ASK 流程步骤拉回来，身份选择页的标题与气泡都用它
  void loadIdentityFlow();
}

/**
 * GET /flow/steps?module=ASK，取 stepCode = IDENTITY 的 title 作为身份选择页标题、
 * options 作为身份气泡的数据源（label 展示、hitValue 是角色码、sortNo 定顺序）。
 * 口播刚开始就发起，等身份选择页浮出时基本已经回来了；
 * 失败 / 没有该步骤就沿用设计稿文案（CHOICE_TITLE）与设计稿里的三个身份。
 */
async function loadIdentityFlow() {
  try {
    const data = await getFlowSteps({ module: "ASK" });
    const step = (data?.steps || []).find((item: FlowStep) => item.stepCode === "IDENTITY");
    if (!step) return;
    const title = String(step.title || "").trim();
    if (title) identityTitle.value = title;
    if (Array.isArray(step.options) && step.options.length) identityOptions.value = step.options;
  }
  catch (error) {
    logger.warn("failed to load flow steps", error);
  }
}

/** 接口没给 IDENTITY_DETAIL.title 时的兜底标题：沿用设计稿句式，角色名取缓存 */
function buildDetailTitle(roleCode: string) {
  if (!roleCode || roleCode === "OWNER") return ROLE_DETAIL_TITLE;
  const name = roleNames.value[roleCode];
  return name ? `以下为${name}身份信息` : ROLE_DETAIL_TITLE;
}

/**
 * 身份信息页的标题 + 气泡：GET /flow/steps?module=ASK&roleCode=xxx，
 * 取 stepCode = IDENTITY_DETAIL 的 title 与 options（按 sortNo 升序）。
 * 触发点：身份选择页 /speech/wake/validate 命中后带 data.hitValue 拉一次（拉完自动进详情页）；
 * 点身份球时若手上不是这个角色这批数据，再补拉一次。
 * 失败 / 没有该步骤就沿用设计稿标题与 6 条胶囊文案。
 */
async function loadIdentityDetail(roleCode: string) {
  const code = String(roleCode || "").trim().toUpperCase();
  if (!code) return;
  if (identityDetailRole === code && identityDetailOptions.value.length) return;
  // 请求发出前先把兜底标题放上去：自动跳进详情页时不会先显示上一个角色的标题
  identityDetailTitle.value = buildDetailTitle(code);
  try {
    const data = await getFlowSteps({ module: "ASK", roleCode: code });
    const step = (data?.steps || []).find((item: FlowStep) => item.stepCode === "IDENTITY_DETAIL");
    const title = String(step?.title || "").trim();
    if (title) identityDetailTitle.value = title;
    const options = Array.isArray(step?.options)
      ? step.options
          .filter(option => String(option?.label || "").trim())
          .sort((a, b) => (Number(a.sortNo) || 0) - (Number(b.sortNo) || 0))
      : [];
    if (!options.length) {
      logger.warn("identity detail step has no options", code);
      return;
    }
    identityDetailRole = code;
    identityDetailOptions.value = options;
  }
  catch (error) {
    logger.warn("failed to load identity detail steps", error);
  }
}

/**
 * 未命中：不进欢迎流程，底部渐变切成 331:147「唤醒失败」的红色
 * （Rectangle 106 375×107：竖向 rgba(239,239,238,0) → #E02E2A），
 * 停留 WAKE_MISS_RESET_MS 后自动淡回常态（撤掉类名，色带靠 opacity 过渡淡出）。
 * 身份选择页里长按录音的情况，红淡回后恢复到口播结束时的常态底光，页面其余内容不动。
 */
function enterWakeMissed() {
  if (!isChecking.value) return;
  isChecking.value = false;
  isWakeMissed.value = true;
  clearWakeMissedTimer();
  wakeMissedTimer = setTimeout(() => {
    wakeMissedTimer = null;
    // 红撤掉之后 isGlowIdle 自动接回常态底光（选择页 / 身份信息页一致）
    isWakeMissed.value = false;
  }, WAKE_MISS_RESET_MS);
}

/**
 * 松手：停录 → 语音识别 → 唤醒 / 热词校验。
 * 只有校验返回 matched = true 才过渡到欢迎页；
 * 录音失败、没识别出文字、接口异常都按未命中处理（底部切红），并留在起始页。
 */
async function stopRecordingAndRecognize() {
  const job = recordJob;
  recordJob = null;
  if (!job) {
    enterWakeMissed();
    return;
  }
  const { seq, start, step } = job;

  try {
    const started = await start;
    if (seq !== recordSeq) return;
    if (!started?.success) {
      enterWakeMissed();
      return;
    }

    const result = await ensureRecorder().stop();
    if (seq !== recordSeq) return;
    if (!result?.success) {
      if (!result?.cancelled) logger.warn("visitor recorder stop failed", result?.error);
      enterWakeMissed();
      return;
    }

    const { tempFilePath, audioUrl, audioBase64, mimeType } = result.data || {};
    if (!tempFilePath && !audioUrl && !audioBase64) {
      logger.warn("visitor recorder returned no audio");
      enterWakeMissed();
      return;
    }

    const response = await withTimeout(requestRecognition({ filePath: tempFilePath, audioUrl, audioBase64, mimeType }));
    if (seq !== recordSeq) return;
    const text = String(response?.text || "").trim();
    logger.info("visitor asr result", { text });
    if (!text) {
      enterWakeMissed();
      return;
    }
    // 识别文本回传「唤醒 / 热词校验」，命中与否由后端热词表决定，结果决定去向
    await validateWakeText(seq, text, step);
  }
  catch (error) {
    logger.warn("visitor speech recognize failed", error);
    if (seq === recordSeq) enterWakeMissed();
  }
}

/**
 * 命中判定：matched = true 且 intent 不是 BACK。
 * BACK 是「返回上一步」的导航意图，由 handleWakeBack 单独处理（不按命中推进流程）。
 */
function isWakeHit(result?: WakeValidateResult | null) {
  return !!result?.matched && String(result.intent || "").trim().toUpperCase() !== "BACK";
}

/**
 * 语音回退（matched = true 且 intent = BACK），按 targetStep 决定退到哪一屏：
 * - 身份信息页：IDENTITY → 「请选择你的身份吧」，HEY → 起始页；
 * - 身份选择页：HEY → 起始页。
 * 其它 targetStep 不做处理（留在当前页，也不闪「未命中」的红）。
 */
function handleWakeBack(targetStep: string) {
  logger.info("visitor wake back", {
    targetStep,
    isRoleDetail: isRoleDetail.value,
    isChoosing: isChoosing.value,
  });
  // 松手后的校验态收掉，底部交给常态 / 播报判定
  isChecking.value = false;
  if (isRoleDetail.value) {
    if (targetStep === "IDENTITY") backToChoosing();
    else if (targetStep === "HEY") resetIntro();
    return;
  }
  if (isChoosing.value && targetStep === "HEY") resetIntro();
}

/**
 * 回退到「请选择你的身份吧」：详情层收起、身份气泡淡入回来，
 * 再按首次进入选择态同一套节奏把引导语念一遍。
 */
function backToChoosing() {
  if (!isRoleDetail.value) return;
  introTts.stop();
  disarmVoiceRetry();
  // 在途的详情标题口播一律作废，别退回来还在念上一屏
  detailSpeakSeq += 1;
  if (detailSpeakTimer) {
    clearTimeout(detailSpeakTimer);
    detailSpeakTimer = null;
  }
  if (detailEnterTimer) {
    clearTimeout(detailEnterTimer);
    detailEnterTimer = null;
  }
  isRoleDetail.value = false;
  detailVisible.value = false;
  chooseOut.value = false;
  selectedBubbleKey.value = "";
  if (choiceSpeakTimer) clearTimeout(choiceSpeakTimer);
  choiceSpeakTimer = setTimeout(() => {
    choiceSpeakTimer = null;
    if (!isChoosing.value || isRoleDetail.value) return;
    introTts.speak(identityTitle.value);
    armVoiceRetry(identityTitle.value);
  }, CHOICE_SPEAK_DELAY_MS);
}

/**
 * 身份信息页命中「开始体验」：与 role-select 页点「开始体验」保持同一套动作——
 * 清空当前会话 → 记录身份（Pinia + 请求头）→ 预取今日觉醒内容 → 跳首页 demo 模式。
 */
async function startExperience(role: VisitorRole) {
  if (navigating) return;
  navigating = true;
  // 即将离开这一屏：兜底计时器、待播口播与手势补播监听一并收掉
  isChecking.value = false;
  clearSpeechFailsafe();
  if (choiceSpeakTimer) {
    clearTimeout(choiceSpeakTimer);
    choiceSpeakTimer = null;
  }
  if (detailSpeakTimer) {
    clearTimeout(detailSpeakTimer);
    detailSpeakTimer = null;
  }
  // 作废还在等 IDENTITY_DETAIL.title 的那次口播，别在首页把详情标题念出来
  detailSpeakSeq += 1;
  introTts.stop();
  disarmVoiceRetry();
  try {
    chatStore.resetConversation();
    userStore.setAwakeningPrompt(null);
    userStore.setVisitorRole(role);
    setGuestRole(role);
    // 设置身份后立刻预取今日觉醒内容，进入首页即可直接展示
    const result = await getTodayAwakeningPrompt();
    userStore.setAwakeningPrompt(result ?? null);
    uni.redirectTo({ url: "/pages/index/index?mode=demo" });
  }
  catch (error) {
    logger.warn("failed to prefetch awakening prompt", error);
    // 预取失败仍允许进入首页，首页会兜底重试
    userStore.setAwakeningPrompt(null);
    uni.redirectTo({ url: "/pages/index/index?mode=demo" });
  }
  finally {
    navigating = false;
  }
}

/**
 * 唤醒 / 热词校验（语雀 2.2）：长按录音识别出的文本，按「模块 ASK + 当前阶段」
 * POST 到 /speech/wake/validate，后端比对热词表后回 matched / hitValue / intent 等。
 * - 阶段 HEY：起始页说的唤醒词；
 * - 阶段 IDENTITY：身份选择页里长按说的身份；
 * - 阶段 START：身份信息页里长按说的「开始体验」。
 * 命中（matched = true 且 intent 不是 BACK）：起始页进欢迎流程、身份选择页按 data.hitValue
 * 拉 IDENTITY_DETAIL 并进入身份信息页、身份信息页按 role-select 页「开始体验」进首页；
 * 回退（matched = true 且 intent = BACK）：按 data.targetStep 退回上一屏（见 handleWakeBack）；
 * 否则底部渐变切红。
 */
async function validateWakeText(seq: number, text: string, step: WakeStep) {
  try {
    // 校验接口卡住时按未命中处理，避免一直停在「校验中」
    const result = await withTimeout(
      validateWakeWord({ module: "ASK", step, text }),
      WAKE_VALIDATE_TIMEOUT_MS,
    );
    // 期间又按了一次 / 取消 / 卸载：这次结果作废
    if (seq !== recordSeq) return;
    logger.info("visitor wake validate result", {
      step,
      matched: result?.matched,
      hitWord: result?.hitWord,
      hitValue: result?.hitValue,
      intent: result?.intent,
      targetStep: result?.targetStep,
      fallbackText: result?.fallbackText,
      fallbackTexts: result?.fallbackTexts,
    });
    // 命中回退：matched = true 且 intent = BACK，按 targetStep 退回上一屏
    if (result?.matched && String(result.intent || "").trim().toUpperCase() === "BACK") {
      handleWakeBack(String(result.targetStep || "").trim().toUpperCase());
      return;
    }
    if (!isWakeHit(result)) {
      enterWakeMissed();
      return;
    }
    // 身份信息页命中「开始体验」：与角色选择页的开始体验一致，直接进首页
    if (step === "START") {
      void startExperience(detailRoleCode);
      return;
    }
    const hitRole = String(result?.hitValue || "").trim().toUpperCase();
    // 身份选择页命中某个身份：先把命中的那颗球点亮（高亮玻璃 + 放大光晕 + 呼吸），
    // 停留一下让用户看清「选中了哪个」，再按 data.hitValue 拉 IDENTITY_DETAIL 进「身份信息」页；
    // 先置详情态再 enterWelcome，底部才保留详情页那套极光
    if (step === "IDENTITY" && isChoosing.value && hitRole) {
      selectedBubbleKey.value = hitRole.toLowerCase();
      if (identityHitTimer) clearTimeout(identityHitTimer);
      identityHitTimer = setTimeout(() => {
        identityHitTimer = null;
        // 停留期间又按了一次录音 / 离开页面：这次命中的后续动作作废
        if (seq !== recordSeq) return;
        enterRoleDetail(hitRole);
        enterWelcome();
      }, IDENTITY_HIT_HOLD_MS);
      return;
    }
    enterWelcome();
  }
  catch (error) {
    logger.warn("visitor wake validate failed", error);
    if (seq === recordSeq) enterWakeMissed();
  }
}

/** 手势被打断 / 页面卸载：作废本次会话并丢掉麦克风，不再发识别 */
function cancelRecording() {
  recordSeq += 1;
  recordJob = null;
  try {
    recorder?.cancel();
  }
  catch (error) {
    logger.warn("visitor recorder cancel failed", error);
  }
}

/**
 * 按住：任意位置长按 280ms 起录音（起始页 / 身份选择页 / 身份信息页共用同一套录音管线）。
 * 身份选择页与身份信息页长按都是「就地录音」——标题 / 气泡 / 胶囊 / 提示一律不动，
 * 只让底部换成与起始页完全一致的按住态蓝渐变；松手后照旧走识别 + 唤醒校验。
 */
function onHoldStart(e: any) {
  if (isRecording.value) return;
  // 自我介绍播放中（还没到选择态）不长按，避免和口播打架
  if (isFinishing.value && !isChoosing.value) return;
  // 新的按压：撤掉上一次「未命中」的红，重新开始
  clearWakeMissed();
  const point = readPoint(e);
  holdStartX = point.x;
  holdStartY = point.y;
  clearHoldTimer();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    // 这 280ms 里上一次的唤醒校验已经命中并进了欢迎流程，就别再起一段录音
    if (isFinishing.value && !isChoosing.value) return;
    // 置为录音态后底部自动从常态切成录音蓝渐变（见 isGlowIdle）
    isRecording.value = true;
    // 长按开始即打断当前语音播报，别让「请选择你的身份吧」/ 身份信息标题盖住录音
    introTts.stop();
    disarmVoiceRetry();
    isChecking.value = false;
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

/**
 * 松手：停录并送一次识别 + 唤醒校验，**结果回来才决定去向**。
 * - 校验中（--checking）：底部沿用录音态的蓝渐变与波浪，页面文案不动；
 * - 命中 → enterWelcome()：标题淡出、自我介绍浮出并口播，播完过渡到身份选择态；
 * - 未命中 → enterWakeMissed()：底部渐变切红（331:147），留在起始页。
 * 未进入录音态的短按不做任何事（页面上已没有可点的按钮）。
 */
function onHoldEnd() {
  clearHoldTimer();
  if (!isRecording.value) return;
  isRecording.value = false;
  isChecking.value = true;
  void stopRecordingAndRecognize();
}

/**
 * 唯一会主动推进流程的兜底：口播一直没起来（自动播放被拦 / 合成失败）时，
 * 到 INTRO_SPEECH_FAILSAFE_MS 仍未出声就直接过渡到身份选择态；
 * 已经出过声就什么都不做，交给 watch 等它播完。
 */
function armSpeechFailsafe() {
  clearSpeechFailsafe();
  speechFailsafeTimer = setTimeout(() => {
    speechFailsafeTimer = null;
    if (introTts.started.value) return;
    logger.warn("自我介绍口播未起播，兜底过渡到身份选择态");
    enterChoosing();
  }, INTRO_SPEECH_FAILSAFE_MS);
}

/**
 * 口播播完（playing 由 true 变 false）后推进流程：自我介绍播完 → 过渡到身份选择态。
 * 底部是否淡回常态不在这里管，交给 isGlowIdle 按「播报 / 录音 / 校验 / 未命中」自动判定，
 * 身份选择页与身份信息页口径一致。
 */
watch(
  () => introTts.playing.value,
  (playing) => {
    if (playing || !introTts.started.value) return;
    if (isChoosing.value) return;
    if (isFinishing.value) enterChoosing();
  },
);

/**
 * 口播收尾：不跳页，就地过渡到身份选择稿（Ardot 306:6468）。
 * 三行自我介绍退场 → 标题与身份气泡错峰浮出 → 标题站定后把「请选择你的身份吧」念出来，
 * 和自我介绍连成一段连续的口播（底部提示只做视觉，不念）。
 */
function enterChoosing() {
  if (isChoosing.value) return;
  // 先置标记再 stop：stop 会把 playing 打回 false，watch 可能再进来一次
  isChoosing.value = true;
  clearSpeechFailsafe();
  disarmVoiceRetry();
  introTts.stop();
  introVisible.value = false;
  if (choiceEnterTimer) clearTimeout(choiceEnterTimer);
  choiceEnterTimer = setTimeout(() => {
    choiceEnterTimer = null;
    choiceVisible.value = true;
    if (choiceSpeakTimer) clearTimeout(choiceSpeakTimer);
    choiceSpeakTimer = setTimeout(() => {
      choiceSpeakTimer = null;
      introTts.speak(identityTitle.value);
      armVoiceRetry(identityTitle.value);
    }, CHOICE_SPEAK_DELAY_MS);
  }, CHOICE_ENTER_DELAY_MS);
}

/**
 * 进「身份信息」页（Ardot 331:382）：身份球原地淡出、图标不动，
 * 标题 / 6 个设备信息胶囊 / 底部提示错峰浮出，底部光效换成粉紫蓝极光。
 * 两个入口共用：点身份球（roleCode = OWNER，其余身份仍走角色选择页）、
 * 身份选择页语音命中（roleCode = data.hitValue，命中后自动进入）。
 */
function enterRoleDetail(roleCode = "OWNER") {
  if (isRoleDetail.value) return;
  const code = String(roleCode || "").trim().toUpperCase() || "OWNER";
  // 记下当前详情页的角色：这一页长按说「开始体验」，命中后按它进首页
  detailRoleCode = toVisitorRole(code);
  // 手上的详情数据不是这个角色就先补拉一次，拉回来之前用兜底标题 / 6 条胶囊，不空屏
  const job = identityDetailRole === code && identityDetailOptions.value.length
    ? Promise.resolve()
    : loadIdentityDetail(code);
  // 「请选择你的身份吧」还没念完就进来了：先收口播，别让上一段声音盖住这一屏
  introTts.stop();
  disarmVoiceRetry();
  chooseOut.value = true;
  isRoleDetail.value = true;
  if (detailEnterTimer) clearTimeout(detailEnterTimer);
  detailEnterTimer = setTimeout(() => {
    detailEnterTimer = null;
    detailVisible.value = true;
  }, DETAIL_ENTER_DELAY_MS);
  // 详情页标题（IDENTITY_DETAIL.title）要念出来：数据回来得早就等数据，最多等 DETAIL_TITLE_WAIT_MS
  void speakDetailTitle(job);
}

/**
 * 详情页标题口播：等 IDENTITY_DETAIL.title 回来（含超时兜底）再念，
 * 否则会先把兜底那句「以下为老板身份信息」念出去。
 */
async function speakDetailTitle(job: Promise<void>) {
  // 会话序号：期间退出详情 / 命中开始体验跳走时自增，这次等数据 + 口播一律作废
  const seq = ++detailSpeakSeq;
  if (detailSpeakTimer) {
    clearTimeout(detailSpeakTimer);
    detailSpeakTimer = null;
  }
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    waitTimer = setTimeout(resolve, DETAIL_TITLE_WAIT_MS);
  });
  await Promise.race([job.catch(() => {}), timeout]);
  if (waitTimer) clearTimeout(waitTimer);
  if (seq !== detailSpeakSeq || !isRoleDetail.value) return;
  detailSpeakTimer = setTimeout(() => {
    detailSpeakTimer = null;
    if (seq !== detailSpeakSeq || !isRoleDetail.value) return;
    const text = identityDetailTitle.value;
    introTts.speak(text);
    armVoiceRetry(text);
  }, DETAIL_SPEAK_DELAY_MS);
}

/** 点身份气泡：老板留在本页看设备信息，其余身份仍进「明细 + 开始体验」的角色选择页 */
function onChooseBubble(bubble: ChoiceBubble) {
  if (!bubble.label) return;
  // 长按已经进入录音 / 校验：松手那一下不算点选，避免误跳
  if (isRecording.value || isChecking.value) return;
  // 命中哪颗就点亮哪颗：只有选中的球切到高亮玻璃态
  selectedBubbleKey.value = bubble.key;
  if (bubble.roleCode === "OWNER") {
    enterRoleDetail("OWNER");
    return;
  }
  openRoleSelect();
}

/** 触摸被系统打断（来电、手势返回等）：丢掉这次录音并复位，不跳转 */
function onHoldCancel() {
  clearHoldTimer();
  clearSpeechFailsafe();
  cancelRecording();
  isRecording.value = false;
  isFinishing.value = false;
  resetIntro();
}

onBeforeUnmount(() => {
  clearHoldTimer();
  clearSpeechFailsafe();
  cancelRecording();
  if (introEnterTimer) clearTimeout(introEnterTimer);
  if (introSpeakTimer) clearTimeout(introSpeakTimer);
  if (choiceEnterTimer) clearTimeout(choiceEnterTimer);
  if (choiceSpeakTimer) clearTimeout(choiceSpeakTimer);
  if (detailEnterTimer) clearTimeout(detailEnterTimer);
  if (detailSpeakTimer) clearTimeout(detailSpeakTimer);
  if (identityHitTimer) clearTimeout(identityHitTimer);
  clearWakeMissedTimer();
  disarmVoiceRetry();
});
// 欢迎页挂载即预取角色选项并缓存，进入角色选择页时直接使用，避免页面加载闪动
onMounted(async () => {
  try {
    uni.removeStorageSync(LISTEN_REPORT_DATE_KEY);
    uni.removeStorageSync(LISTEN_REPORT_CURRENT_DATE_KEY);
    uni.removeStorageSync(REPORT_VOICE_STORAGE_KEY);
    uni.removeStorageSync(REPORT_STYLE_STORAGE_KEY);
  } catch (error) {
    logger.warn("failed to clear visitor experience state", error);
  }

  try {
    const result = await getRoleOptions();
    const roles = result?.roles ?? [];
    if (roles.length) {
      uni.setStorageSync(VISITOR_ROLE_OPTIONS_CACHE_KEY, roles);
      // 手上的结果直接喂给身份球，不用等下次读缓存
      roleNames.value = toRoleNameMap(roles);
    }
  } catch (error) {
    logger.warn("failed to prefetch role options", error);
  }
});

/** 点身份气泡后进「老板 / 操作手」明细与开始体验页 */
function openRoleSelect() {
  if (navigating) return;
  navigating = true;
  // 离开起始页：兜底计时器、待播口播与手势补播监听一并收掉，避免在角色选择页背后继续说话
  clearSpeechFailsafe();
  if (choiceSpeakTimer) {
    clearTimeout(choiceSpeakTimer);
    choiceSpeakTimer = null;
  }
  if (detailSpeakTimer) {
    clearTimeout(detailSpeakTimer);
    detailSpeakTimer = null;
  }
  detailSpeakSeq += 1;
  introTts.stop();
  disarmVoiceRetry();
  uni.navigateTo({
    url: "/pages/role-select/index",
    complete: () => {
      // 从角色页返回时回到起始态：彩色渐变收起、自我介绍与身份气泡隐藏
      navigating = false;
      isFinishing.value = false;
      resetIntro();
    },
  });
}
</script>

<template>
  <!-- 游客欢迎页：Ardot 306:2777「起始态 • 未唤醒」（375×812，D 方案全白主题）
       状态栏由宿主绘制（父级 safe-area padding），设计稿里的 54 高状态栏只作示意
       整页任意位置长按 280ms 进入录音态；松手切到 306:6388 的自我介绍态（沿用录音态的底部渐变 + 文字 + 口播），
       口播播完就地过渡到 306:6468 的身份选择态（标题 + 身份气泡 + 底部提示），全程不跳页 -->
  <view
    class="welcome-visitor"
    :class="{
      'welcome-visitor--recording': isRecording,
      'welcome-visitor--checking': isChecking,
      'welcome-visitor--missed': isWakeMissed,
      'welcome-visitor--finishing': isFinishing,
      'welcome-visitor--glow-idle': isGlowIdle,
    }"
    @touchstart="onHoldStart"
    @touchmove="onHoldMove"
    @touchend="onHoldEnd"
    @touchcancel="onHoldCancel"
    @mousedown="onHoldStart"
    @mouseup="onHoldEnd"
  >
    <!-- 自我介绍文案：Ardot 306:6467，长按录音松手后三行依次淡入上浮（不跳转，只在本页过渡） -->
    <view class="welcome-visitor__intro" :class="{ 'welcome-visitor__intro--in': introVisible }">
      <text
        v-for="(line, index) in INTRO_LINES"
        :key="line"
        class="welcome-visitor__intro-line"
        :style="{ transitionDelay: `${index * INTRO_STAGGER_MS}ms` }"
      >{{ line }}</text>
    </view>

    <!-- 身份选择态：Ardot 722:2651「100号游客，请选择你的身份吧」，口播播完就地过渡过来 -->
    <view
      v-if="isChoosing"
      class="welcome-visitor__choose"
      :class="{ 'welcome-visitor__choose--in': choiceVisible, 'welcome-visitor__choose--out': chooseOut }"
    >
      <!-- 标题 722:2734：x=53 y=117 275×29，20px/29 Medium #0D0D0D；
           文案取 GET /flow/steps 里 IDENTITY 步的 title，取不到才用设计稿文案 -->
      <text class="welcome-visitor__choose-title">{{ identityTitle }}</text>
      <!-- 身份玻璃球 722:3064 / 1006:16 / 1006:3 + 装饰球 722:2720 / 722:2717 / 722:2714 / 722:2665
           入场用动效方案 4「全息升维翻展」：从图标中心 3D 翻折展开后落位 -->
      <view
        v-for="bubble in CHOICE_BUBBLE_HOLO"
        :key="bubble.key"
        class="welcome-visitor__bubble"
        :class="{
          'welcome-visitor__bubble--role': bubble.label,
          'welcome-visitor__bubble--ghost': !bubble.label,
          'welcome-visitor__bubble--active': selectedBubbleKey === bubble.key,
        }"
        :style="bubble.style"
        @tap.stop="onChooseBubble(bubble)"
      >
        <!-- 玻璃球内部虹彩（722:3064 的 Mask group）：
             Ellipse 62 / 61 / 60 三团模糊色斑 → Ellipse 58 薄雾 → Vector 80 球面高光 → Vector 81 深蓝细条 -->
        <template v-if="bubble.glass">
          <view class="welcome-visitor__bubble-iris welcome-visitor__bubble-iris--magenta" />
          <view class="welcome-visitor__bubble-iris welcome-visitor__bubble-iris--cyan" />
          <view class="welcome-visitor__bubble-iris welcome-visitor__bubble-iris--indigo" />
          <view class="welcome-visitor__bubble-veil" />
          <view class="welcome-visitor__bubble-sheen" />
          <view class="welcome-visitor__bubble-stripe" />
        </template>
        <text v-if="bubble.label" class="welcome-visitor__bubble-text">{{ bubble.label }}</text>
      </view>
      <!-- 底部提示 722:2744：x=102 y=597 176×23，16px/23 Medium #8E8E8E 居中 -->
      <text class="welcome-visitor__choose-hint">{{ CHOICE_HINT }}</text>
    </view>

    <!-- 老板身份详情：Ardot 331:382「点开老板身份 看详细信息」。
         标题与底部提示按设计稿贴边定位；6 个设备胶囊挂在图标容器上（见下方 logo 内），
         图标本身沿用身份选择态的位置，不做任何位移或动画 -->
    <view
      v-if="isRoleDetail"
      class="welcome-visitor__detail"
      :class="{ 'welcome-visitor__detail--in': detailVisible }"
    >
      <!-- 标题 331:391：x=53 y=117 180×29，20px/29 Medium #0D0D0D；
           文案取 GET /flow/steps 里 IDENTITY_DETAIL 步的 title，取不到才用设计稿文案 -->
      <text class="welcome-visitor__detail-title">{{ identityDetailTitle }}</text>
      <!-- 底部提示 331:428：x=102 y=597 176×23，16px/23 Medium #8E8E8E 居中 -->
      <text class="welcome-visitor__detail-hint">{{ ROLE_DETAIL_HINT }}</text>
    </view>

    <!-- 底部光效：常态贴底一缕淡蓝渐变（约 62px）；
         按住 / 播报身份 / 身份选择 / 老板详情都沿用首页「按住说话」面板那套
         粉蓝渐变波浪（双层波形色带），整页只保留这一套底部观感 -->
    <view class="welcome-visitor__glow">
      <view class="welcome-visitor__glow-fade" />
      <view class="welcome-visitor__glow-voice">
        <view class="welcome-visitor__glow-voice-wave">
          <view class="welcome-visitor__glow-voice-band welcome-visitor__glow-voice-band--back" />
          <view class="welcome-visitor__glow-voice-band" />
        </view>
      </view>
    </view>

    <view class="welcome-visitor__content">
      <!-- 主视觉组：标题 + Logo -->
      <view class="welcome-visitor__hero">
        <!-- 标题行 Hey,SANI：306:2801（Hey, 纯色）+ 306:2782（SANI 渐变），两段连写无间隙 -->
        <view class="welcome-visitor__title">
          <text class="welcome-visitor__title-hey">Hey,</text>
          <text class="welcome-visitor__title-brand">SANI</text>
        </view>
        <!-- 主视觉：306:2783 容器 134×134 / 306:2791 图 110×110（居中，投影 0 3 9 rgba(0,0,0,.14)）
             收尾态只淡出上下文案，图标本体与位置都不动 -->
        <view class="welcome-visitor__logo">
          <image class="welcome-visitor__logo-img" :src="brandLogo" mode="aspectFit" />
          <!-- 老板身份详情胶囊 331:389 / 331:392 / 331:444 / 331:394 / 331:456 / 331:442：
               挂在图标容器上做绝对定位（偏移由模板按设计稿注入），保证任意屏高下
               胶囊始终绕着图标，图标自身不动；入场与身份球同款方案 4 全息翻折 -->
          <template v-if="isRoleDetail">
            <view
              v-for="(tag, index) in ROLE_DETAIL_TAG_HOLO"
              :key="tag.key"
              class="welcome-visitor__detail-tag"
              :class="{ 'welcome-visitor__detail-tag--in': detailVisible }"
              :style="{
                left: `${tag.left}rpx`,
                top: `${tag.top}rpx`,
                width: `${tag.width}rpx`,
                '--holo-dx': `${tag.holoDx}rpx`,
                '--holo-dy': `${tag.holoDy}rpx`,
                '--holo-rx': tag.holoRx,
                '--holo-ry': tag.holoRy,
                '--holo-delay': `${DETAIL_HOLO_DELAY_MS + index * DETAIL_TAG_STAGGER_MS}ms`,
              }"
            >
              <text class="welcome-visitor__detail-tag-text">{{ tag.text }}</text>
            </view>
          </template>
        </view>
      </view>

      <!-- 文案组：306:2780 副标题 + 306:2800 描述两行（收尾态淡出） -->
      <view class="welcome-visitor__caption">
        <text class="welcome-visitor__slogan">随时，为你而在</text>
        <view class="welcome-visitor__desc">
          <text class="welcome-visitor__desc-line">你的三一设备伙伴。</text>
          <text class="welcome-visitor__desc-line">把问题交给我，把时间留给工作。</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.welcome-visitor {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  // 设计稿 306:2781 Rectangle 51：fills 最上层为不透明 #FAFAFA（下面两层渐变被完全遮住）
  background: #fafafa;
  color: #0d0d0d;
  font-family: "Source Han Sans CN", "PingFang SC", sans-serif;
  // 整页承担长按录音，长按期间不允许选中文字 / 拖出系统菜单
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

/* 身份选择稿的画板底色不做单独处理：维持和起始页同一块 #FAFAFA，
   这样底部那层常态渐变（#FAFAFA → #BFDAF4）接得上，不会在渐变起点出现一条硬边 */

/* ===== 底部光效：常态贴底一缕淡蓝（62px）；
   按住 / 收尾态换成首页「按住说话」面板那套粉蓝渐变波浪（118px），各层自己贴底定位 ===== */
.welcome-visitor__glow {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  // 按波形容器高度（118px）取值，多留一点余量给遮罩模糊的出血
  height: 240rpx; // 120px
  overflow: hidden;
  pointer-events: none;
}

/* 主渐变：#FAFAFA → #BFDAF4，曲线按反馈图逐段采样，避免上半段过早显色 */
.welcome-visitor__glow-fade {
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
  // 唤醒 / 收尾时这缕淡蓝要让位给波浪，过渡压短，切换更跟手
  transition: opacity 200ms ease;
}

/*
 * 按住 / 收尾态：复用首页「按住说话」弹出面板的底部渐变（ai-chat-input 的 voice-panel__wave），
 * 只取波形色带本身，面板上方那块粉色柔光（11332:104 Rectangle 104）不要：
 * - band：11332:97 Rectangle 106，375×53 的三色带（#EBB4E9 → #56ABFA → #9795E8），
 *   被 voice-listening-wave-blur-mask.svg 的波形遮罩裁出软边
 * - 动效：色带镜像周期横向流动 + 遮罩左右摆动（轮廓起伏），后层更慢且反向
 * 外层只负责淡入淡出，避免 opacity 过渡和 keyframes 抢同一个属性。
 */
.welcome-visitor__glow-voice {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx; // 118px：波形容器高度
  opacity: 0;
  // 唤醒（按下 / 松手）/ 校验 / 未命中都靠这条过渡切换，压短让渐变色立刻到位
  transition: opacity 140ms ease;
  pointer-events: none;
  will-change: opacity;
}

/* 按住 / 唤醒校验中 / 收尾态 / 未命中：底部都换成这套波纹色带 */
.welcome-visitor--recording .welcome-visitor__glow-voice,
.welcome-visitor--checking .welcome-visitor__glow-voice,
.welcome-visitor--missed .welcome-visitor__glow-voice,
.welcome-visitor--finishing .welcome-visitor__glow-voice {
  opacity: 1;
}

/* 常态那缕淡蓝在按住后让位，换成面板里的粉白底色 */
.welcome-visitor--recording .welcome-visitor__glow-fade,
.welcome-visitor--checking .welcome-visitor__glow-fade,
.welcome-visitor--missed .welcome-visitor__glow-fade,
.welcome-visitor--finishing .welcome-visitor__glow-fade {
  opacity: 0;
}

/* 身份选择态口播播完：底部淡回常态——波纹色带淡出、常态那缕淡蓝淡回。
   与上面的 --finishing 规则特异度相同，靠源码顺序覆盖，必须放在它们之后 */
.welcome-visitor--glow-idle .welcome-visitor__glow-voice {
  opacity: 0;
}

.welcome-visitor--glow-idle .welcome-visitor__glow-fade {
  opacity: 1;
}

/* 已经看不见了，别让三色带的无限动画继续占合成线程 */
.welcome-visitor--glow-idle .welcome-visitor__glow-voice-band {
  animation-play-state: paused;
}

/* 11332:91 Frame 45：波浪容器，贴底 118px */
.welcome-visitor__glow-voice-wave {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 236rpx; // 118px
}

/* 11332:97 Rectangle 106：三色带本体。
   为了「横向流动不露边、不跳色」，把色带做成镜像周期——0 → 50% 是设计稿色带，
   50% → 100% 是它的镜像，首尾同为 #EBB4E9；背景宽取两个窗口宽，位移一个周期即无缝循环 */
.welcome-visitor__glow-voice-band {
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

/* 后层波浪：轮廓相同、透明度更低、流动更慢且反向，叠出液面的层次感 */
.welcome-visitor__glow-voice-band--back {
  opacity: 0.4;
  transform: translateY(8rpx);
}

/* 动画只在按住 / 收尾态跑：常态下不占合成线程。
   收尾态（松手后播报身份）用三色带横向流动 + 波形摆动 */
.welcome-visitor--finishing .welcome-visitor__glow-voice-band {
  animation:
    welcome-voice-wave-color-flow 5.6s linear infinite,
    welcome-voice-wave-sway 4.8s ease-in-out infinite alternate;
}

.welcome-visitor--finishing .welcome-visitor__glow-voice-band--back {
  animation:
    welcome-voice-wave-color-flow 7.6s linear infinite reverse,
    welcome-voice-wave-sway 6s ease-in-out infinite alternate;
}

/* 按住 / 唤醒校验中：竖向 #EFEFEE → #0F7EEE 的水面。色带没有横向色差了，
   流动改成「色彩上下涨落」——同一个波形遮罩继续摆动，观感与收尾态一致 */
.welcome-visitor--recording .welcome-visitor__glow-voice-band,
.welcome-visitor--checking .welcome-visitor__glow-voice-band {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    welcome-voice-wave-drift 4.8s ease-in-out infinite alternate,
    welcome-voice-wave-sway 4.8s ease-in-out infinite alternate;
}

.welcome-visitor--recording .welcome-visitor__glow-voice-band--back,
.welcome-visitor--checking .welcome-visitor__glow-voice-band--back {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    welcome-voice-wave-drift 6s ease-in-out infinite alternate-reverse,
    welcome-voice-wave-sway 6s ease-in-out infinite alternate;
}

/* 唤醒未命中：底部渐变换成 331:147「唤醒失败」的红
   （Rectangle 106 375×107：竖向 rgba(239,239,238,0) 0% → #E02E2A 100%）。
   波纹形态与按住态一致，颜色不做上下涨落，保证红色一直压在最底下 */
.welcome-visitor--missed .welcome-visitor__glow-voice-band {
  background-image: linear-gradient(180deg, rgba(239, 239, 238, 0) 0%, #e02e2a 100%);
  background-size: 100% 100%;
  animation: welcome-voice-wave-sway 4.8s ease-in-out infinite alternate;
}

.welcome-visitor--missed .welcome-visitor__glow-voice-band--back {
  background-image: linear-gradient(180deg, rgba(239, 239, 238, 0) 0%, #e02e2a 100%);
  background-size: 100% 100%;
  animation: welcome-voice-wave-sway 6s ease-in-out infinite alternate;
}

/* 色带横向流动：位移一个背景周期（1500rpx），首尾同色，循环无缝 */
@keyframes welcome-voice-wave-color-flow {
  from {
    background-position: 0 0;
  }

  to {
    background-position: 1500rpx 0;
  }
}

/* 竖向渐变的涨落：背景比容器高 60%，上下移动时水色在「浅灰」和「深蓝」之间呼吸 */
@keyframes welcome-voice-wave-drift {
  from {
    background-position: 0 0;
  }

  to {
    background-position: 0 100%;
  }
}

/* 波形轮廓缓慢起伏：基准 mask-position 为 (−121rpx, −14rpx)，±20rpx 摆动 */
@keyframes welcome-voice-wave-sway {
  from {
    -webkit-mask-position: -141rpx -14rpx;
    mask-position: -141rpx -14rpx;
  }

  to {
    -webkit-mask-position: -101rpx -14rpx;
    mask-position: -101rpx -14rpx;
  }
}

/* 306:6467 主文案：20px Medium / 行高 29px（设计稿 AUTO 行高，三行共 87px）/ #0D0D0D；
   设计稿 x=53、y=117、宽 297，页面内容区已扣掉 54 高状态栏，所以 top = 117 - 54 = 63px */
.welcome-visitor__intro {
  position: absolute;
  top: 126rpx; // 63px
  left: 106rpx; // 53px
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: 594rpx; // 297px
  color: #0d0d0d;
  font-size: 40rpx; // 20px
  font-weight: 500; // Source Han Sans CN Medium
  line-height: 58rpx; // 29px
  letter-spacing: 0;
  text-align: left;
  // 每行按自身文字宽度收缩，字色渐变才能逐行铺满（见下面的 :nth-child 规则）
  align-items: flex-start;
  // 整页承担长按录音，文案不参与命中，避免挡住手势
  pointer-events: none;
}

/* 逐行入场：淡入 + 上浮 12px，行间靠 transition-delay 错开 */
.welcome-visitor__intro-line {
  display: block;
  opacity: 0;
  transform: translateY(24rpx); // 12px
  transition: opacity 520ms ease, transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: opacity, transform;
}

.welcome-visitor__intro--in .welcome-visitor__intro-line {
  opacity: 1;
  transform: translateY(0);
}

/* 首行保持 #0D0D0D；第二、三行是设计稿里的字色渐变（紫 → 蓝 → 粉），
   按各自行宽 0 → 100% 铺开，取色自 306:6467 的文字截图 */
.welcome-visitor__intro-line:nth-child(n + 2) {
  background-image: linear-gradient(
    90deg,
    #3d28cf 0%,
    #2199fd 52%,
    #b06ffb 80%,
    #d571ec 100%
  );
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
}

/* ===== 身份选择态：Ardot 722:2651「100号游客，请选择你的身份吧」 =====
   标题回到自我介绍的位置（y=117 → 扣掉 54 状态栏后 63px），
   中心图标周围浮出玻璃质感的身份气泡，底部提示换成「可以和我说选择哪个身份」 */
.welcome-visitor__choose {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  // 动效方案 4 的 3D 空间透视（原稿 800px），灭点对准中心图标：
  // 设计稿图标中心 (187, 346) → 内容区 692rpx，气泡才会「朝屏幕内翻折」
  perspective: 1600rpx; // 800px
  perspective-origin: 50% 692rpx;
}

/* 标题 331:310：文本框 x=53 y=117 275×29，20px / 行高 29px / Medium / #0D0D0D，左对齐。
   设计稿文本框宽 275，实际字宽约 280，单行溢出（截图里也是单行铺到 x≈333），
   所以宽度取设计值 550rpx 并禁止折行 */
.welcome-visitor__choose-title {
  position: absolute;
  top: 126rpx; // y=117 − 54 状态栏 = 63px
  left: 106rpx; // x=53
  width: 550rpx; // 275px
  color: #0d0d0d;
  font-size: 40rpx; // 20px
  font-weight: 500; // Source Han Sans CN Medium
  line-height: 58rpx; // 29px
  text-align: left;
  white-space: nowrap;
  opacity: 0;
  transform: translateY(24rpx); // 12px
  transition: opacity 520ms ease, transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: opacity, transform;
}

.welcome-visitor__choose--in .welcome-visitor__choose-title {
  opacity: 1;
  transform: translateY(0);
}

/* 球体容器（身份玻璃球 + 装饰球共用）：位置 / 尺寸 / 字号由模板按 722:2651 注入，
   这里只放排版、裁剪与入场动画的兜底状态 */
.welcome-visitor__bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 50%;
  color: #0d0d0d;
  font-weight: 500;
  text-align: center;
  opacity: 0;
  transform: scale(0.62);
  // 入场动效（全息翻折）走 keyframes，这里只留一份「未入场」的兜底状态
  will-change: transform, opacity;
  // 翻折瞬间的高光提亮：原稿是彩色 drop-shadow，这里收白，避免引入设计稿外的色值
  --holo-glow: brightness(2);
  --holo-glow-dim: brightness(1.2);
  --holo-glow-off: brightness(1);
}

/* 身份玻璃球（722:3064 老板 / 1006:16 设备管理员 / 1006:3 操作手），82×82，自下而上五层：
   ① Ellipse 59 底色 + 1px 渐变描边（见下方 --glass-* 两组色值）
   ② Ellipse 62/61/60 虹彩色斑：#F693FF / #70C7FF / #5B70CB（见 .welcome-visitor__bubble-iris）
   ③ Ellipse 58 薄雾 + INNER_SHADOW 5 7 6 6 rgba(255,255,255,.25)
   ④ Vector 80 球面高光：白 100% → 26%
   ⑤ Vector 81 深蓝细条：#2F3DD4 60%
   设计稿里 722:3064 老板画的是「选中态」：三颗球默认统一用 1006:3 操作手那套淡色，
   只有被选中 / 按下的那颗才切到 722:3064 的高亮玻璃（见下一条 --active 规则） */
.welcome-visitor__bubble--role {
  // 默认态 = 1006:3 操作手那套：Ellipse 59 #DFF0FF 36% / Ellipse 58 #B9DCFF 41% / 描边 #E7EDFA → #CCE2FC
  --glass-fill: rgba(223, 240, 255, 0.36); // Ellipse 59
  --glass-inner: rgba(185, 220, 255, 0.41); // Ellipse 58
  --glass-stroke-a: #e7edfa; // Ellipse 59 stroke
  --glass-stroke-b: #cce2fc;

  // Ellipse 59 底色
  background-image: linear-gradient(180deg, var(--glass-fill) 0%, var(--glass-fill) 100%);
  // DROP_SHADOW 0 −20px 12px 6px rgba(218,233,252,0.34)，向上打冷光
  box-shadow: 0 -40rpx 24rpx 12rpx rgba(218, 233, 252, 0.34);
}

/* 选中 / 命中态 = 722:3064 老板：Ellipse 59 #D1E9FF 79% / Ellipse 58 #B9DCFF 66% / 描边 #D1DFFF → #BBDAFF
   :active 覆盖按住的那一下，--active 留给业务侧「选中」；
   默认三颗球长得完全一样，只有被点亮的那颗才用这套高亮玻璃 */
.welcome-visitor__bubble--role.welcome-visitor__bubble--active,
.welcome-visitor__bubble--role:active {
  --glass-fill: rgba(209, 233, 255, 0.79); // Ellipse 59
  --glass-inner: rgba(185, 220, 255, 0.66); // Ellipse 58
  --glass-stroke-a: #d1dfff; // Ellipse 59 stroke
  --glass-stroke-b: #bbdaff;
}

/* Ellipse 58 内层薄雾：压在彩斑之上，把虹彩调成设计稿里那种奶白玻璃感
   填充色随选中态切换 + INNER_SHADOW inset 5px 7px 6px 6px rgba(255,255,255,0.25) */
.welcome-visitor__bubble-veil {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--glass-inner, transparent);
  box-shadow: inset 10rpx 14rpx 12rpx 12rpx rgba(255, 255, 255, 0.25);
  pointer-events: none;
}

/* Ellipse 59 的 1px 描边渐变（左上 → 右下）：用 ::before 只画那一圈，
   直接用 border-box 铺渐变会把整个圆涂成不透明的描边色，盖掉底色 */
.welcome-visitor__bubble--role::before {
  position: absolute;
  inset: 0;
  padding: 1px; // 描边 1px
  border-radius: 50%;
  background-image: linear-gradient(
    135deg,
    var(--glass-stroke-a, transparent) 0%,
    var(--glass-stroke-b, transparent) 100%
  );
  // 双线性遮罩相减，只保留 1px 环（圆内透出底色）
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  content: "";
  pointer-events: none;
}

/* 虹彩色斑（722:3064 的 Mask group 内 Ellipse 62 / 61 / 60）：
   设计稿的彩斑与高光都压在球体**左半边**（左上 → 左下），斜向 40.65° */
.welcome-visitor__bubble-iris {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

// Ellipse 62：#F693FF，56.11×40.81 @ (17.4, −5)，LAYER_BLUR 16
.welcome-visitor__bubble-iris--magenta {
  top: -10rpx;
  left: -21.3rpx;
  width: 112.2rpx;
  height: 81.6rpx;
  background: #f693ff;
  filter: blur(32rpx);
  transform: rotate(40.65deg);
}

// Ellipse 61：#70C7FF，45.43×32.33 @ (17.6, 0.26)，LAYER_BLUR 10
.welcome-visitor__bubble-iris--cyan {
  top: 0.5rpx;
  left: 4.7rpx;
  width: 90.9rpx;
  height: 64.7rpx;
  background: #70c7ff;
  filter: blur(20rpx);
  transform: rotate(40.65deg);
}

// Ellipse 60：#5B70CB，38.72×11.01 @ (17.35, 3.68)，LAYER_BLUR 7
.welcome-visitor__bubble-iris--indigo {
  top: 7.4rpx;
  left: 18.7rpx;
  width: 77.4rpx;
  height: 22rpx;
  background: #5b70cb;
  filter: blur(14rpx);
  transform: rotate(40.65deg);
}

/* Vector 80 球面高光：69.55×17.99 @ (11.6, 49.37)，15°，白 100% → 26%，LAYER_BLUR 5
   压在球体左下的底缘，是整颗球最亮的那团柔光 */
.welcome-visitor__bubble-sheen {
  position: absolute;
  top: 98.7rpx;
  left: 23.2rpx;
  width: 139.1rpx;
  height: 36rpx;
  border-radius: 50%;
  background-image: linear-gradient(180deg, #ffffff 0%, rgba(255, 255, 255, 0.263) 100%);
  filter: blur(10rpx);
  transform: rotate(15deg);
  pointer-events: none;
}

/* Vector 81 深蓝细条：52.82×12 @ (−44.78, 66.42)，17.83°，#2F3DD4 60% 不透明，LAYER_BLUR 7
   贴球体左下缘，只露出一小条，压出冷蓝的底边 */
.welcome-visitor__bubble-stripe {
  position: absolute;
  top: 132.8rpx;
  left: -89.6rpx;
  width: 105.6rpx;
  height: 24rpx;
  border-radius: 50%;
  background-image: linear-gradient(180deg, #2f3dd4 0%, rgba(47, 61, 212, 0.263) 100%);
  opacity: 0.6;
  filter: blur(14rpx);
  transform: rotate(17.83deg);
  pointer-events: none;
}

/* 装饰玻璃球（722:2720 / 722:2717 / 722:2714 / 722:2665）：
   设计稿为 1px、60% 白描边 + LAYER_BLUR 8 的整体虚化，且没有投影 */
.welcome-visitor__bubble--ghost {
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: none;
  filter: blur(16rpx); // 8px
  // 翻折动画会覆盖 filter，虚化值必须跟着一起带上，否则装饰球会被「擦亮」
  --holo-glow: blur(16rpx) brightness(2);
  --holo-glow-dim: blur(16rpx) brightness(1.2);
  --holo-glow-off: blur(16rpx);
}

/* 装饰球球面高光（各球内的 Vector 80）：占球体 72.3% × 24.1%、起点约 (14.5%, 7.4%)，
   填充白色 100% → 26%，LAYER_BLUR 5 → blur(10rpx) */
.welcome-visitor__bubble--ghost::after {
  position: absolute;
  top: 7.4%;
  left: 14.5%;
  width: 72.3%;
  height: 24.1%;
  border-radius: 50%;
  background-image: linear-gradient(180deg, #ffffff 0%, rgba(255, 255, 255, 0.263) 100%);
  filter: blur(10rpx); // 5px
  content: "";
}

/* 气泡文字：722:3076 / 1006:17 / 1006:5 均为 16px / 行高 23px / Medium / #0D0D0D */
.welcome-visitor__bubble-text {
  position: relative;
  z-index: 1;
  line-height: 46rpx; // 23px
  white-space: pre-line;
}

/* 每颗球的漂浮周期错开，避免整屏一起上下动 */
.welcome-visitor__bubble:nth-child(2n) {
  --float-duration: 8.6s;
}

.welcome-visitor__bubble:nth-child(3n) {
  --float-duration: 9.8s;
}

/* 入场（动效方案 4「全息升维翻展」）+ 落位后漂浮：
   - 第一段：从图标中心 3D 翻折展开，backwards 让延迟期间停在 0% 帧（不可见）；
   - 第二段：延迟 = 第一段结束，两段首尾相接，不会同时抢 transform；
   - 用 backwards 而不是 both，动画结束后样式交回 CSS，
     这样「点老板后原地淡出」的 opacity / filter 过渡仍然生效 */
.welcome-visitor__choose--in .welcome-visitor__bubble {
  opacity: 1;
  transform: translateY(0) scale(1);
  animation:
    welcome-bubble-holo 1200ms cubic-bezier(0.16, 1, 0.3, 1) var(--holo-delay, 0ms) backwards,
    welcome-bubble-float var(--float-duration, 7.6s) ease-in-out calc(var(--holo-delay, 0ms) + 1200ms) infinite alternate;
}

/* 浮出之后才可点：避免过渡期间点到还看不见的气泡 */
.welcome-visitor__choose--in .welcome-visitor__bubble--role {
  pointer-events: auto;
}

/* 漂浮动画占着 transform，按下反馈改用亮度，两套动效不打架 */
.welcome-visitor__choose--in .welcome-visitor__bubble--role:active {
  filter: brightness(0.96);
}

/* 命中 / 选中的那颗球：放大 + 白色柔光外圈 + 轻微呼吸。
   语音命中后要停一会儿才进身份信息页，这段动效就是让用户看清「选中了哪个身份」；
   复合选择器压过上面的漂浮动画，避免两条 animation 抢 transform（选中后不再漂浮） */
.welcome-visitor__choose--in .welcome-visitor__bubble--role.welcome-visitor__bubble--active {
  z-index: 2;
  filter: none;
  animation: welcome-bubble-pick 1.2s ease-in-out infinite;
  box-shadow:
    0 0 12rpx 2rpx rgba(255, 255, 255, 0.8),
    0 0 20rpx 4rpx rgba(158, 199, 255, 0.35),
    0 10rpx 24rpx rgba(88, 138, 220, 0.24);
}

/* 选中呼吸：8% 的放大起步（接着漂浮的落位，看不出跳变）+ 上下轻浮 */
@keyframes welcome-bubble-pick {
  0%,
  100% {
    transform: translateY(0) scale(1.08);
  }

  50% {
    transform: translateY(-8rpx) scale(1.15);
  }
}

/* 动效方案 4「全息升维翻展」：气泡以图标中心为轴心 3D 翻折展开成饱满球体。
   起始帧贴在图标圆心（--holo-dx/--holo-dy 由模板按设计稿坐标算好），
   60% 处先亮到 1.2 再回落到 1，做出全息扫描的高光扫过感 */
@keyframes welcome-bubble-holo {
  0% {
    transform: translate(var(--holo-dx, 0), var(--holo-dy, 0)) rotateX(var(--holo-rx, 85deg))
      rotateY(var(--holo-ry, 45deg)) scale(0);
    opacity: 0;
    filter: var(--holo-glow, brightness(2));
  }

  60% {
    opacity: 1;
    filter: var(--holo-glow-dim, brightness(1.2));
  }

  100% {
    transform: translate(0, 0) rotateX(0deg) rotateY(0deg) scale(1);
    opacity: 1;
    filter: var(--holo-glow-off, brightness(1));
  }
}

/* 漂浮只动 5px，direction: alternate 让它自己上下折返 */
@keyframes welcome-bubble-float {
  0% {
    transform: translate3d(0, 0, 0);
  }

  100% {
    transform: translate3d(0, -10rpx, 0);
  }
}

/* 16px Medium / #8E8E8E：设计稿 y=597（内容区 758 高）→ 距底 192px */
.welcome-visitor__choose-hint {
  position: absolute;
  right: 0;
  bottom: 384rpx; // 192px
  left: 0;
  color: #8e8e8e;
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 46rpx; // 23px
  text-align: center;
  opacity: 0;
  transform: translateY(16rpx);
  transition: opacity 480ms ease 300ms, transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1) 300ms;
}

.welcome-visitor__choose--in .welcome-visitor__choose-hint {
  opacity: 1;
  transform: translateY(0);
}

/* ===== 老板身份详情：Ardot 331:382「点开老板身份 看详细信息」 =====
   设计稿仍是 375×812：标题 (53,117)、中心图标容器 (120,333) 134×134、
   6 个设备信息胶囊绕图标散点排布、底部提示 (102,597)。
   图标沿用身份选择态的尺寸与位置——进入详情后不做任何位移、缩放或动画；
   胶囊入场与底部光效都与身份选择页保持一致（方案 4 全息翻折 + 粉蓝渐变波浪） */
.welcome-visitor__detail {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}

/* 标题 331:391：x=53 y=117 180×29，20px / 行高 29px / Medium / #0D0D0D；
   宽度取设计稿左边界到右边界（297px），接口 title 比设计稿长时允许折行 */
.welcome-visitor__detail-title {
  position: absolute;
  top: 126rpx; // y=117 − 54 状态栏 = 63px
  left: 106rpx; // x=53
  width: 594rpx; // 297px
  color: #0d0d0d;
  font-size: 40rpx; // 20px
  font-weight: 500; // Source Han Sans CN Medium
  line-height: 58rpx; // 29px
  text-align: left;
  opacity: 0;
  transform: translateY(24rpx); // 12px
  transition: opacity 520ms ease, transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: opacity, transform;
}

/* 底部提示 331:428：x=102 y=597 176×23，16px / 行高 23px / Medium / #8E8E8E 居中 */
.welcome-visitor__detail-hint {
  position: absolute;
  right: 0;
  bottom: 384rpx; // 距底 192px（y=597 + 23 高）
  left: 0;
  color: #8e8e8e;
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 46rpx; // 23px
  text-align: center;
  opacity: 0;
  transform: translateY(16rpx);
  transition: opacity 480ms ease 300ms, transform 480ms cubic-bezier(0.22, 0.61, 0.36, 1) 300ms;
}

.welcome-visitor__detail--in .welcome-visitor__detail-title {
  opacity: 1;
  transform: translateY(0);
}

.welcome-visitor__detail--in .welcome-visitor__detail-hint {
  opacity: 1;
  transform: translateY(0);
}

/* 设备信息胶囊（1006:313 / 1006:346 / 1006:277 / 1006:350 / 1006:291 / 1006:293）：
   - 填充：线性渐变，整体 16% 不透明（#3D21CD 0% → #C1E4FF 27.8% → #7B9CFF 50.9%
     → #C067FA 71.2% → #F7CFFF 85.8% → #FD90C4 100%）；Figma 渐变方向 3.66°，换成 CSS 93.66deg
   - 描边：按需求去掉，只保留渐变填充（原 2px OUTSIDE 渐变描边的 ::before 已移除）
   - 投影：DROP_SHADOW 0 3 16 rgba(0,159,235,0.127)
   - 背景模糊：BACKGROUND_BLUR 29 → backdrop-filter blur(58rpx)
   - 圆角 38（76rpx，高度 32 → 药丸）、14px / 行高 20px / Medium / #0D0D0D，
     文字上下各 6、左右各 18（宽度 = 文字宽 + 72rpx，由模板按文案算出来注入）
   位置同样由模板注入：相对 134×134 图标容器的偏移，图标不动，胶囊绕着它翻折落位 */
.welcome-visitor__detail-tag {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 64rpx; // 32px
  border-radius: 76rpx; // 38px
  background-image: linear-gradient(
    93.66deg,
    rgba(61, 33, 205, 0.16) 0%,
    rgba(193, 228, 255, 0.16) 27.8%,
    rgba(123, 156, 255, 0.16) 50.9%,
    rgba(192, 103, 250, 0.16) 71.2%,
    rgba(247, 207, 255, 0.16) 85.8%,
    rgba(253, 144, 196, 0.16) 100%
  );
  box-shadow: 0 6rpx 32rpx rgba(0, 159, 235, 0.127); // 0 3 16
  -webkit-backdrop-filter: blur(58rpx); // 29px
  backdrop-filter: blur(58rpx);
  color: #0d0d0d;
  font-size: 28rpx; // 14px
  font-weight: 500; // Medium
  line-height: 40rpx; // 20px
  text-align: center;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

/* 与身份球同款方案 4「全息升维翻展」：从图标中心 3D 翻折展开，落位后保持设计稿的静止位置 */
.welcome-visitor__detail-tag--in {
  opacity: 1;
  transform: translateY(0);
  animation: welcome-bubble-holo 1200ms cubic-bezier(0.16, 1, 0.3, 1) var(--holo-delay, 0ms) backwards;
}

.welcome-visitor__detail-tag-text {
  display: block;
}

/* 进入详情：身份球与身份选择稿的文案原地淡出（淡出后不再可点），图标不受影响 */
.welcome-visitor__choose--out .welcome-visitor__choose-title,
.welcome-visitor__choose--out .welcome-visitor__choose-hint {
  opacity: 0;
  transition: opacity 260ms ease;
}

.welcome-visitor__choose--out .welcome-visitor__bubble {
  opacity: 0;
  transition: opacity 260ms ease;
  pointer-events: none;
  // 已经淡出画面，漂浮动画没必要继续占合成线程
  animation-play-state: paused;
}

/* 老板详情沿用身份选择页那套底部光效（录音态的粉蓝渐变波浪，见 .welcome-visitor__glow-voice），
   不再单独画 331:398 的极光——底部观感整页统一 */

/* 内容区：设计稿是绝对定位，这里用居中 + 块内精确间距，保证小屏（折叠屏）不溢出 */
.welcome-visitor__content {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  // 去掉底部「开始体验」按钮后补回等高留白，主视觉位置与加按钮时一致
  padding-bottom: 212rpx; // 按钮 104rpx + 内边距 32rpx + 外边距 76rpx
  gap: 78rpx; // 39px：Logo 底 → 副标题顶
  min-height: 0;
  overflow-y: auto;
}

/* 标题 + Logo 组：间距 5px */
.welcome-visitor__hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx; // 5px
}

/* 标题行：24px Medium，行盒 35px */
.welcome-visitor__title {
  display: flex;
  align-items: flex-start;
  font-size: 48rpx; // 24px
  font-weight: 500; // Medium
  line-height: 70rpx; // 35px
  white-space: nowrap;
}

/* 306:2801：Hey, → #0D0D0D */
.welcome-visitor__title-hey {
  color: #0d0d0d;
}

/* 306:2782：SANI → 渐变文字（#3D21CD → #1999FE → #C067FA → #FD90C4，水平） */
.welcome-visitor__title-brand {
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/*
 * 收尾态（自我介绍）：Hey,SANI 与下方文案淡出，但保留占位 ——
 * 位置不动才能保证中间那个图标不跟着跳。
 */
.welcome-visitor__title,
.welcome-visitor__caption {
  transition: opacity 320ms ease;
}

.welcome-visitor--finishing .welcome-visitor__title,
.welcome-visitor--finishing .welcome-visitor__caption {
  opacity: 0;
  visibility: hidden;
  transition: opacity 320ms ease, visibility 0s linear 320ms;
}

/* 306:2783：134×134 容器，图 110×110 居中（内边距 12）。
   老板详情态的 6 个胶囊以它为定位参照（设计稿图标原点 120,333），
   所以这里必须是 relative，且 padding 不影响绝对定位的基准点；
   perspective 让胶囊的 3D 翻折以图标中心为灭点（800px → 1600rpx），
   与身份选择页的气泡入场保持同一套空间关系 */
.welcome-visitor__logo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 268rpx; // 134px
  height: 268rpx;
  padding: 24rpx; // 12px
  perspective: 1600rpx; // 800px
  perspective-origin: 50% 50%;
}

.welcome-visitor__logo-img {
  width: 220rpx; // 110px
  height: 220rpx;
  // 设计稿阴影 0 3px 9px rgba(0,0,0,.14)：图片是透明 PNG，
  // 用 drop-shadow 才能沿三角轮廓投影（box-shadow 会沿 110×110 方框铺开，出现方形光晕）
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}

/* 副标题 + 描述组：间距 2px */
.welcome-visitor__caption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx; // 2px
}

/* 306:2780：16px Medium，行盒 23px，同一套渐变文字 */
.welcome-visitor__slogan {
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 46rpx; // 23px
  text-align: center;
  background-image: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 48.72%,
    #c067fa 75.995%,
    #fd90c4 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* 306:2800：16px / 行高 24px，两行居中，#8E8E8E */
.welcome-visitor__desc {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 480rpx; // 240px
  font-size: 32rpx; // 16px
  font-weight: 500;
  line-height: 48rpx; // 24px
  text-align: center;
  color: #8e8e8e;
}

.welcome-visitor__desc-line {
  display: block;
  width: 100%;
  text-align: center;
}
</style>

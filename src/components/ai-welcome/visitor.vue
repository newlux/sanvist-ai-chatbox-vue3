<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { getRoleOptions } from "@/api/user-role";
import brandLogo from "@/assets/img/header-island-logo.png";
import { LISTEN_REPORT_CURRENT_DATE_KEY, LISTEN_REPORT_DATE_KEY, VISITOR_ROLE_OPTIONS_CACHE_KEY } from "@/config";
import { REPORT_STYLE_STORAGE_KEY } from "@/config/report-styles";
import { REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { usePlainTts } from "@/hooks/usePlainTts";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "AiWelcomeVisitor" });
const logger = createLogger("visitor");

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
 * 口播收尾后的身份选择稿：Ardot 306:6468「日常运营助手- SANI 自我介绍」。
 * 标题 20px Medium / #0D0D0D（x=53、y=117、宽 275），底部提示 16px / #8E8E8E（y=597 居中）。
 * 三行自我介绍播完就地过渡到这里，不跳页。
 */
/** 顶部标题，同时也是第二段口播的文本（下方提示只做视觉，不念） */
const CHOICE_TITLE = "100号游客，请选择你的身份吧";
const CHOICE_HINT = "可以和我说选择哪个身份";
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
  /** 身份名；留空表示设计稿里的装饰玻璃球（不可点） */
  label: string;
  /** 球体纵向渐变：设计稿各 Ellipse 的起止色 */
  fill: [string, string];
  /** 设计稿坐标是 375×812（含 54 高状态栏），这里已扣掉状态栏并换成 rpx（1px = 2rpx） */
  x: number;
  y: number;
  size: number;
  fontSize: number;
}

/**
 * Ardot 331:288「100号游客，请选择你的身份吧」里绕着中心图标的球体，逐个对齐设计稿：
 * - 老板 331:330：x=252.5 y=243 80×80，渐变 #C5EAFF → #DFF4FF
 * - 设备管理员 331:334：x=34 y=317 70×70，渐变 #DEF1FC → #F1FAFF
 * - 操作手 331:314：x=264 y=449 68×68，渐变 #DEF1FC → #F1FAFF
 * - 装饰球 331:342 (97,243)50 / 331:356 (314,374)42 / 331:322 (55,471)28 / 331:311 (140,523)28
 * 坐标已扣掉 54 高状态栏（y − 54），并统一换算成 rpx。
 */
const CHOICE_BUBBLES: ChoiceBubble[] = [
  { key: "owner", label: "老板", fill: ["#c5eaff", "#dff4ff"], x: 505, y: 378, size: 160, fontSize: 40 },
  { key: "admin", label: "设备\n管理员", fill: ["#def1fc", "#f1faff"], x: 68, y: 526, size: 140, fontSize: 32 },
  { key: "operator", label: "操作手", fill: ["#def1fc", "#f1faff"], x: 528, y: 790, size: 136, fontSize: 32 },
  { key: "dot-a", label: "", fill: ["#e7eaff", "#f0f2ff"], x: 194, y: 378, size: 100, fontSize: 0 },
  { key: "dot-b", label: "", fill: ["#e3f5ff", "#f1faff"], x: 628, y: 640, size: 84, fontSize: 0 },
  { key: "dot-c", label: "", fill: ["#e7eaff", "#f0f2ff"], x: 110, y: 834, size: 56, fontSize: 0 },
  { key: "dot-d", label: "", fill: ["#def1fc", "#f1faff"], x: 280, y: 938, size: 56, fontSize: 0 },
];

/**
 * 动效方案 4「全息升维翻展」（Holo Flip）的入场参数：气泡从中心图标处以 3D 轴心
 * 翻折展开、飞回自己的位置，落位后不再位移。
 * - holoDx / holoDy：起点相对终点的偏移 = 图标中心 − 气泡中心（rpx），即气泡从圆心飞出
 * - holoRx / holoRy：翻起的起始倾角，按气泡相对图标的方位取，保证「翻折面」朝外，
 *   与方案稿里老板 85°/45°、设备管理员 -85°/-45°、操作手 85°/-45° 的取法一致
 */
const CHOICE_BUBBLE_HOLO = CHOICE_BUBBLES.map((bubble) => {
  const centerX = bubble.x + bubble.size / 2;
  const centerY = bubble.y + bubble.size / 2;
  return {
    ...bubble,
    holoDx: CHOICE_CORE_X - centerX,
    holoDy: CHOICE_CORE_Y - centerY,
    holoRx: centerY < CHOICE_CORE_Y ? "85deg" : "-85deg",
    holoRy: centerX > CHOICE_CORE_X ? "45deg" : "-45deg",
  };
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

/**
 * Ardot 331:382「日常运营助手- 点开老板身份 看详细信息」里绕着中心图标的 6 个设备信息胶囊：
 * - 38台体验设备 331:389：x=34 y=312 122×32
 * - 4台混凝土泵车 331:392：x=234 y=312 128×32
 * - 4台履带吊 331:444：x=262 y=388 100×32
 * - 2个项目 331:394：x=20 y=404 86×32
 * - 15台电动自卸车 331:456：x=228 y=467 136×32
 * - 15台电动混凝土搅拌车 331:442：x=28 y=489 178×32
 * 存的是「相对图标容器（设计稿 x=120 y=333 134×134）」的偏移，设计稿坐标减图标原点后按 1px = 2rpx 换算：
 * 这样图标在任意屏高下由 flex 居中时，胶囊仍保持与图标的相对位置（图标本身不动）。
 */
const ROLE_DETAIL_TAGS: RoleDetailTag[] = [
  { key: "device-total", text: "38台体验设备", left: -172, top: -42, width: 244 },
  { key: "pump-truck", text: "4台混凝土泵车", left: 228, top: -42, width: 256 },
  { key: "crawler-crane", text: "4台履带吊", left: 284, top: 110, width: 200 },
  { key: "project", text: "2个项目", left: -200, top: 142, width: 172 },
  { key: "dump-truck", text: "15台电动自卸车", left: 216, top: 268, width: 272 },
  { key: "mixer-truck", text: "15台电动混凝土搅拌车", left: -184, top: 312, width: 356 },
];

/**
 * 设备胶囊沿用身份选择页的方案 4「全息升维翻展」：从图标中心 3D 翻折展开后落位。
 * holoDx / holoDy = 图标容器中心 − 胶囊中心（相对图标容器的偏移，rpx）；
 * holoRx / holoRy 按胶囊在图标四周的方位取，保证翻折面朝外。
 */
const DETAIL_CORE_CENTER = 134; // 图标容器 268×268rpx 的一半
const DETAIL_TAG_HEIGHT = 64; // 胶囊高 32px → 64rpx
const ROLE_DETAIL_TAG_HOLO = ROLE_DETAIL_TAGS.map((tag) => {
  const centerX = tag.left + tag.width / 2;
  const centerY = tag.top + DETAIL_TAG_HEIGHT / 2;
  return {
    ...tag,
    holoDx: DETAIL_CORE_CENTER - centerX,
    holoDy: DETAIL_CORE_CENTER - centerY,
    holoRx: centerY < DETAIL_CORE_CENTER ? "85deg" : "-85deg",
    holoRy: centerX > DETAIL_CORE_CENTER ? "45deg" : "-45deg",
  };
});

/** 详情页标题 331:391：x=53 y=117 180×29，20px / 行高 29px / Medium / #0D0D0D */
const ROLE_DETAIL_TITLE = "以下为老板身份信息";
/** 详情页底部提示 331:428：x=102 y=597 176×23，16px / 行高 23px / Medium / #8E8E8E */
const ROLE_DETAIL_HINT = "可以和我说“开始体验”";
/** 等身份选择稿淡出（260ms）之后再浮出详情，避免两套标题在同一位置叠加 */
const DETAIL_ENTER_DELAY_MS = 280;
/** 胶囊之间错开的入场延迟，与身份球保持同一节奏 */
const DETAIL_TAG_STAGGER_MS = CHOICE_STAGGER_MS;
/** 第一颗胶囊的出场延迟，与身份球一致 */
const DETAIL_HOLO_DELAY_MS = CHOICE_HOLO_DELAY_MS;

/**
 * 口播文本：展示文案按行排版，交给 TTS 前补上句读拼成一句完整的话
 * （行末已有逗号的不会重复补）。
 */
function buildIntroSpeechText() {
  const merged = INTRO_LINES.map(line => line.trim()).join("，").replace(/[，,]+/g, "，");
  return `${merged}。`;
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
  disarmVoiceRetry();
  introTts.stop();
  introVisible.value = false;
  choiceVisible.value = false;
  isChoosing.value = false;
  chooseOut.value = false;
  isRoleDetail.value = false;
  detailVisible.value = false;
}

/**
 * 整页长按：按住 280ms 进入「录音态」（底部渐变切深色），松手后底部沿用这套蓝渐变与波浪、
 * 文案换成本次自我介绍并口播；口播播完就地过渡到「身份选择」态，不跳页。
 * 全程不调语音识别接口。
 */
const HOLD_START_MS = 280;
/** 长按判定前手指位移超过这个距离视为滑动，不进入录音态 */
const HOLD_MOVE_PX = 12;
/**
 * 口播兜底时长：正常流程是「播完才过渡」，这个只针对压根没播起来的情况
 * （自动播放被 WebView 拦掉、TTS 合成失败），到点直接过渡到身份选择态。
 */
const INTRO_SPEECH_FAILSAFE_MS = 5000;

/** 按住中：底部渐变切到录音态配色 */
const isRecording = ref(false);
/** 松手后的收尾态：底部沿用录音态的蓝渐变 + 波浪，文案换成本次自我介绍 */
const isFinishing = ref(false);
/** 口播收尾后的身份选择态：标题 + 身份气泡 + 底部提示，仍在同一页内 */
const isChoosing = ref(false);
/** 身份选择内容是否已浮出（控制淡入上浮） */
const choiceVisible = ref(false);
/** 点老板后身份球原地淡出（淡出后不再可点），图标不参与任何位移 */
const chooseOut = ref(false);
/** 老板身份详情态：Ardot 331:382，标题 + 6 个设备胶囊 + 提示 + 底部极光 */
const isRoleDetail = ref(false);
/** 详情内容是否已浮出（控制淡入上浮） */
const detailVisible = ref(false);

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let speechFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
let choiceEnterTimer: ReturnType<typeof setTimeout> | null = null;
let choiceSpeakTimer: ReturnType<typeof setTimeout> | null = null;
let detailEnterTimer: ReturnType<typeof setTimeout> | null = null;
/** 跳转中标记：避免重复触发 openRoleSelect */
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

function onHoldStart(e: any) {
  if (isRecording.value || isFinishing.value) return;
  const point = readPoint(e);
  holdStartX = point.x;
  holdStartY = point.y;
  clearHoldTimer();
  holdTimer = setTimeout(() => {
    holdTimer = null;
    isRecording.value = true;
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
 * 松手：底部沿用录音态的蓝渐变与波浪（不收），同时 Hey,SANI 与下方文案淡出、
 * 自我介绍文案浮出并口播。这里不再按固定时长跳转，停在起始页等口播放完再过渡到身份选择态。
 * 未进入录音态的短按不做任何事（页面上已没有可点的按钮）。
 */
function onHoldEnd() {
  clearHoldTimer();
  if (!isRecording.value) return;
  isRecording.value = false;
  isFinishing.value = true;
  startIntro();
  armSpeechFailsafe();
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

// 正常推进时机：口播播完（playing 由 true 变 false）再过渡到身份选择态
watch(
  () => introTts.playing.value,
  (playing) => {
    if (playing || !isFinishing.value || !introTts.started.value) return;
    enterChoosing();
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
      introTts.speak(CHOICE_TITLE);
      armVoiceRetry(CHOICE_TITLE);
    }, CHOICE_SPEAK_DELAY_MS);
  }, CHOICE_ENTER_DELAY_MS);
}

/**
 * 点老板：就地展开「老板身份详情」（Ardot 331:382）——身份球原地淡出、图标不动，
 * 标题 / 6 个设备信息胶囊 / 底部提示错峰浮出，底部光效换成粉紫蓝极光。
 */
function enterRoleDetail() {
  if (isRoleDetail.value) return;
  // 「请选择你的身份吧」还没念完就点了老板：先收口播，别让上一段声音盖住这一屏
  introTts.stop();
  disarmVoiceRetry();
  chooseOut.value = true;
  isRoleDetail.value = true;
  if (detailEnterTimer) clearTimeout(detailEnterTimer);
  detailEnterTimer = setTimeout(() => {
    detailEnterTimer = null;
    detailVisible.value = true;
  }, DETAIL_ENTER_DELAY_MS);
}

/** 点身份气泡：老板留在本页看设备信息，其余身份仍进「明细 + 开始体验」的角色选择页 */
function onChooseBubble(bubble: ChoiceBubble) {
  if (!bubble.label) return;
  if (bubble.key === "owner") {
    enterRoleDetail();
    return;
  }
  openRoleSelect();
}

/** 触摸被系统打断（来电、手势返回等）：直接复位，不跳转 */
function onHoldCancel() {
  clearHoldTimer();
  clearSpeechFailsafe();
  isRecording.value = false;
  isFinishing.value = false;
  resetIntro();
}

onBeforeUnmount(() => {
  clearHoldTimer();
  clearSpeechFailsafe();
  if (introEnterTimer) clearTimeout(introEnterTimer);
  if (introSpeakTimer) clearTimeout(introSpeakTimer);
  if (choiceEnterTimer) clearTimeout(choiceEnterTimer);
  if (choiceSpeakTimer) clearTimeout(choiceSpeakTimer);
  if (detailEnterTimer) clearTimeout(detailEnterTimer);
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
      'welcome-visitor--finishing': isFinishing,
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

    <!-- 身份选择态：Ardot 331:288「100号游客，请选择你的身份吧」，口播播完就地过渡过来 -->
    <view
      v-if="isChoosing"
      class="welcome-visitor__choose"
      :class="{ 'welcome-visitor__choose--in': choiceVisible, 'welcome-visitor__choose--out': chooseOut }"
    >
      <!-- 标题 331:310：x=53 y=117 275×29，20px/29 Medium #0D0D0D -->
      <text class="welcome-visitor__choose-title">{{ CHOICE_TITLE }}</text>
      <!-- 身份球 331:330 / 331:334 / 331:314 + 装饰球 331:342 / 331:356 / 331:322 / 331:311
           入场用动效方案 4「全息升维翻展」：从图标中心 3D 翻折展开后落位 -->
      <view
        v-for="(bubble, index) in CHOICE_BUBBLE_HOLO"
        :key="bubble.key"
        class="welcome-visitor__bubble"
        :class="{
          'welcome-visitor__bubble--role': bubble.label,
          'welcome-visitor__bubble--ghost': !bubble.label,
        }"
        :style="{
          left: `${bubble.x}rpx`,
          top: `${bubble.y}rpx`,
          width: `${bubble.size}rpx`,
          height: `${bubble.size}rpx`,
          fontSize: `${bubble.fontSize}rpx`,
          backgroundImage: `linear-gradient(180deg, ${bubble.fill[0]} 0%, ${bubble.fill[1]} 100%)`,
          '--holo-dx': `${bubble.holoDx}rpx`,
          '--holo-dy': `${bubble.holoDy}rpx`,
          '--holo-rx': bubble.holoRx,
          '--holo-ry': bubble.holoRy,
          '--holo-delay': `${CHOICE_HOLO_DELAY_MS + index * CHOICE_STAGGER_MS}ms`,
        }"
        @tap.stop="onChooseBubble(bubble)"
      >
        <text v-if="bubble.label" class="welcome-visitor__bubble-text">{{ bubble.label }}</text>
      </view>
      <!-- 底部提示 331:355：x=102 y=597 176×23，16px/23 Medium #8E8E8E 居中 -->
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
      <!-- 标题 331:391：x=53 y=117 180×29，20px/29 Medium #0D0D0D -->
      <text class="welcome-visitor__detail-title">{{ ROLE_DETAIL_TITLE }}</text>
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
  transition: opacity 320ms ease;
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
  transition: opacity 0.24s ease;
  pointer-events: none;
  will-change: opacity;
}

.welcome-visitor--recording .welcome-visitor__glow-voice,
.welcome-visitor--finishing .welcome-visitor__glow-voice {
  opacity: 1;
}

/* 常态那缕淡蓝在按住后让位，换成面板里的粉白底色 */
.welcome-visitor--recording .welcome-visitor__glow-fade,
.welcome-visitor--finishing .welcome-visitor__glow-fade {
  opacity: 0;
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

/* 按住态：竖向 #EFEFEE → #0F7EEE 的水面。色带没有横向色差了，
   流动改成「色彩上下涨落」——同一个波形遮罩继续摆动，观感与收尾态一致 */
.welcome-visitor--recording .welcome-visitor__glow-voice-band {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    welcome-voice-wave-drift 4.8s ease-in-out infinite alternate,
    welcome-voice-wave-sway 4.8s ease-in-out infinite alternate;
}

.welcome-visitor--recording .welcome-visitor__glow-voice-band--back {
  background-image: linear-gradient(180deg, #efefee 0%, #0f7eee 100%);
  background-size: 100% 160%;
  animation:
    welcome-voice-wave-drift 6s ease-in-out infinite alternate-reverse,
    welcome-voice-wave-sway 6s ease-in-out infinite alternate;
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

/* ===== 身份选择态：Ardot 331:288「100号游客，请选择你的身份吧」 =====
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

/* 身份球（331:330 / 331:334 / 331:314）：
   纵向渐变由模板按各球的 Ellipse 色值注入，这里只放共用的描边、投影与排版
   - 描边：Ellipse strokeWeight = 2，纯白
   - 投影：DROP_SHADOW 0 1 98 rgba(0,0,0,0.0755) → 0 2rpx 196rpx */
.welcome-visitor__bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 2rpx 196rpx rgba(0, 0, 0, 0.0755);
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

/* 装饰玻璃球（331:342 / 331:356 / 331:322 / 331:311）：
   设计稿为 1px、60% 白描边 + LAYER_BLUR 8 的整体虚化，且没有投影 */
.welcome-visitor__bubble--ghost {
  border-width: 1px;
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: none;
  filter: blur(16rpx); // 8px
  // 翻折动画会覆盖 filter，虚化值必须跟着一起带上，否则装饰球会被「擦亮」
  --holo-glow: blur(16rpx) brightness(2);
  --holo-glow-dim: blur(16rpx) brightness(1.2);
  --holo-glow-off: blur(16rpx);
}

/* 球面高光：设计稿内嵌 Vector，占球体 72.3% × 24.1%、起点约 (14.5%, 7.4%)，
   填充白色 100% → 26%，LAYER_BLUR 5 → blur(10rpx) */
.welcome-visitor__bubble::after {
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

.welcome-visitor__bubble-text {
  position: relative;
  z-index: 1;
  // 20px → 29px、16px → 23px，设计稿两个字号的行高比例一致
  line-height: 1.45;
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

/* 标题 331:391：x=53 y=117 180×29，20px / 行高 29px / Medium / #0D0D0D */
.welcome-visitor__detail-title {
  position: absolute;
  top: 126rpx; // y=117 − 54 状态栏 = 63px
  left: 106rpx; // x=53
  width: 360rpx; // 180px
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

/* 设备信息胶囊（331:389 / 331:392 / 331:444 / 331:394 / 331:456 / 331:442）：
   - 填充：纵向渐变 #DEF1FC 0% → #F1FAFF 100%
   - 描边：strokeWeight 2，纯白
   - 投影：DROP_SHADOW 0 1 98 rgba(0,0,0,0.0755)
   - 圆角 38（高度 32 → 药丸）、14px / 行高 20px / Medium / #0D0D0D
   宽度按设计稿固定（文字宽 + 左右 18 的内边距），文字在胶囊内居中；
   位置由模板注入：相对 134×134 图标容器的偏移，图标不动，胶囊绕着它翻折落位 */
.welcome-visitor__detail-tag {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 64rpx; // 32px
  border: 2px solid #ffffff;
  border-radius: 76rpx; // 38px
  background-image: linear-gradient(180deg, #def1fc 0%, #f1faff 100%);
  box-shadow: 0 2rpx 196rpx rgba(0, 0, 0, 0.0755);
  color: #0d0d0d;
  font-size: 28rpx; // 14px
  font-weight: 500;
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

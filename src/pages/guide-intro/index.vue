<script setup lang="ts">
import type { DeviceModelOption } from "@/api/user-role/device-models";
import type { OperatorRolesData } from "@/api/user-role/operator-roles";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getDeviceModels, getOperatorRoles } from "@/api/user-role";
import { OPERATOR_ROLE_KEYS, toOperatorRoleOption } from "@/api/user-role/operator-roles";
import brandLogo from "@/assets/img/header-island-logo.png";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";

/**
 * 作业指导助手 · SANI 引导页（Ardot 347:5095 / 347:5124 / 347:5220 / 347:5306）。
 *
 * 四张设计稿是**同一个页面**的四个动态态，按用户回答逐步推进：
 *   1. 自我介绍：标题 + 渐变副标题，中心 SANI 图标；
 *   2. 同类设备经验：「你以前开过履带吊吗？」三颗玻璃气泡 + 装饰虚化球；
 *   3. 选择体验的设备：四颗机型胶囊（数据取 /user/device-models，失败退回设计稿文案）；
 *   4. 当前机型经验：「你开过最新款 xxx 吗？」三颗经验胶囊。
 * 每态只有标题 / 选项 / 底部提示变化，图标位置与背景不动，切换时按「标题淡入 + 选项错峰弹出」过渡。
 *
 * 版面取设计稿 375×812（含 54 高状态栏）：所有 y 已扣掉状态栏，换算成 rpx（1px = 2rpx），
 * 外层再用安全区高度做偏移，保证刘海屏下标题仍落在设计稿位置。
 *
 * 结束时把机型写进 store（inputs.device_model），并按第四态答案选新老手讲解模式
 * （inputs.operator_role，见 api/user-role/operator-roles），随后进作业指导对话。
 */
defineOptions({ name: "GuideIntroPage" });

const logger = createLogger("guide-intro");
const userStore = useUserStore();

/** 设计稿的四个动态态 */
type Step = 1 | 2 | 3 | 4;
const step = ref<Step>(1);

/** 第一态停留时长：无操作时自动进入下一态（点屏幕可立即跳过） */
const INTRO_AUTO_NEXT_MS = 3200;
/** 选中态亮一下再切下一态，避免点下去没有反馈 */
const SELECT_DELAY_MS = 220;

let introTimer: ReturnType<typeof setTimeout> | null = null;
let selectTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前是否有选项处于「已选中」的反馈态 */
const selectedKey = ref("");

/** 机型列表：第三态的胶囊数据源 */
const deviceModels = ref<DeviceModelOption[]>([]);
/** 新老手讲解模式：第四态结束时按答案映射 */
const rolesData = ref<OperatorRolesData | null>(null);
/** 第三态选中的机型 */
const pickedModel = ref<DeviceModelOption | null>(null);

const INTRO_TITLE = "欢迎了解作业指导AI助手";
const INTRO_SUBTITLE = "师傅远在千里，\n经验近在车里";

/** 设计稿第三态的兜底机型（接口没数据时仍能走完流程） */
const FALLBACK_MODELS: DeviceModelOption[] = [
  { modelKey: "SCC4000A-8", modelName: "400吨燃油\n履带起重机\nSCC4000A-8" },
  { modelKey: "SCC3200T", modelName: "320吨智混\n履带起重机\nSCC3200T" },
  { modelKey: "pump-39", modelName: "39米智混泵车" },
  { modelKey: "pump-71", modelName: "71米智混泵车" },
];

/**
 * 设计稿只排了四颗胶囊（116×72 / 106×72 / 122×32 / 122×32），
 * 这里用「左 + 上 + 最小宽度」对齐；宽度略放宽是为了让中英混排不卡在折行边界。
 */
const DEVICE_SLOTS = [
  { left: 76, top: 470, width: 250 },
  { left: 456, top: 368, width: 230 },
  { left: 74, top: 848, width: 244 },
  { left: 456, top: 826, width: 244 },
];

/** 第三态机型：接口优先，接口没数据时退回设计稿的四台样机 */
const deviceOptions = computed(() => {
  const source = deviceModels.value.length ? deviceModels.value : FALLBACK_MODELS;
  return source.slice(0, DEVICE_SLOTS.length);
});

/** 第四态标题里的机型名：取第三态选中的机型，没有就用设计稿样机 */
const currentModelName = computed(() => pickedModel.value?.modelName || "SCC4000A-8");

/** 每态的标题、标题左边距（设计稿 x）、底部提示 */
const STEP_TEXT = computed<Record<Step, { title: string, titleLeft: number, hint: string }>>(() => ({
  1: { title: INTRO_TITLE, titleLeft: 106, hint: "" },
  2: { title: "你以前开过履带吊吗？", titleLeft: 104, hint: "可以和我说哪个更符合你的情况" },
  3: { title: "100号游客，先挑你的设备吧", titleLeft: 86, hint: "可以和我说你感兴趣的机型" },
  4: { title: `你开过最新款 ${currentModelName.value}吗？`, titleLeft: 74, hint: "可以和我说符合你的答案" },
}));

const stepText = computed(() => STEP_TEXT.value[step.value]);

/**
 * 第二态的气泡：三颗可点（80×80）+ 四颗装饰虚化球。
 * 坐标取设计稿 (x, y)，y 已扣掉 54 高状态栏后换算成 rpx；fill 为球体纵向渐变的起止色。
 */
interface OptionBubble {
  key: string;
  label: string;
  fill: [string, string];
  left: number;
  top: number;
  size: number;
  /** 装饰球：不可点、整体虚化 */
  ghost?: boolean;
}

const EXPERIENCE_BUBBLES: OptionBubble[] = [
  { key: "familiar", label: "开过\n比较熟悉", fill: ["#def1fc", "#f1faff"], left: 80, top: 504, size: 160 },
  { key: "getting-used", label: "开过\n还在熟悉", fill: ["#def1fc", "#f1faff"], left: 506, top: 378, size: 160 },
  { key: "never", label: "还没开过", fill: ["#def1fc", "#f1faff"], left: 420, top: 824, size: 160 },
  { key: "dot-a", label: "", fill: ["#e7eaff", "#f0f2ff"], left: 194, top: 378, size: 100, ghost: true },
  { key: "dot-b", label: "", fill: ["#e3f5ff", "#f1faff"], left: 594, top: 726, size: 84, ghost: true },
  { key: "dot-c", label: "", fill: ["#def1fc", "#f1faff"], left: 294, top: 904, size: 56, ghost: true },
  { key: "dot-d", label: "", fill: ["#e7eaff", "#f0f2ff"], left: 110, top: 834, size: 56, ghost: true },
];

/**
 * 第四态的经验胶囊：坐标取设计稿 (34,312) / (182,306) / (190,478)，
 * 文案按「是否操作过这款」决定新老手讲解模式。
 */
const EXPERIENCE_PILLS = [
  { key: OPERATOR_ROLE_KEYS.skilled, label: "操作过这款", left: 68, top: 516, width: 212 },
  { key: "know-not-operated", label: "了解一些，还没操作过", left: 364, top: 504, width: 352 },
  { key: "first-time", label: "第一次接触这款", left: 380, top: 848, width: 268 },
];

/** 气泡 / 胶囊的绝对定位样式（rpx） */
function bubbleStyle(item: OptionBubble) {
  return {
    left: `${item.left}rpx`,
    top: `${item.top}rpx`,
    width: `${item.size}rpx`,
    height: `${item.size}rpx`,
    background: `linear-gradient(160deg, ${item.fill[0]} 0%, ${item.fill[1]} 100%)`,
  };
}

function pillStyle(item: { left: number, top: number, width: number }) {
  return {
    left: `${item.left}rpx`,
    top: `${item.top}rpx`,
    width: `${item.width}rpx`,
  };
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
}

/** 切到下一态：选项先亮一下，再换标题与选项（各自重放入场动画） */
function nextStep(target: Step, key = "") {
  selectedKey.value = key;
  selectTimer = setTimeout(() => {
    selectTimer = null;
    selectedKey.value = "";
    step.value = target;
  }, key ? SELECT_DELAY_MS : 0);
}

/** 第一态：点屏幕跳过自我介绍 */
function onPageTap() {
  if (step.value === 1) {
    clearTimers();
    step.value = 2;
  }
}

/** 第二态：同类设备经验（仅用于推进流程，讲解模式由第四态决定） */
function onExperienceTap(item: OptionBubble) {
  if (item.ghost || selectedKey.value) return;
  nextStep(3, item.key);
}

/** 第三态：选机型，写进 store 供作业指导作为 device_model 透传 */
function onDeviceTap(item: DeviceModelOption) {
  if (selectedKey.value) return;
  pickedModel.value = item;
  userStore.setSelectedDeviceModelKey(item.modelKey);
  nextStep(4, item.modelKey);
}

/** 第四态：机型经验 → 新老手讲解模式 */
function onModelExperienceTap(key: string) {
  if (selectedKey.value) return;
  selectedKey.value = key;
  finish(key === OPERATOR_ROLE_KEYS.skilled ? OPERATOR_ROLE_KEYS.skilled : OPERATOR_ROLE_KEYS.novice);
}

/** 收尾：写讲解模式并进作业指导（与「讲解模式选择」页同一套 store 字段） */
function finish(roleKey: string) {
  const raw = roleKey === OPERATOR_ROLE_KEYS.skilled ? rolesData.value?.skilled_operator : rolesData.value?.novice_operator;
  userStore.setOperatorRole(toOperatorRoleOption(raw, roleKey));
  selectTimer = setTimeout(() => {
    selectTimer = null;
    uni.redirectTo({ url: "/pages/guide/index" });
  }, SELECT_DELAY_MS);
}

async function loadModels() {
  try {
    const data = await getDeviceModels();
    deviceModels.value = Array.isArray(data?.models) ? data.models : [];
    userStore.setDeviceModels(deviceModels.value);
  } catch (error) {
    logger.warn("failed to load device models", error);
    deviceModels.value = [];
  }
}

async function loadOperatorRoles() {
  try {
    rolesData.value = await getOperatorRoles();
  } catch (error) {
    // 接口异常不挡流程：toOperatorRoleOption 会退回设计稿文案
    logger.warn("failed to load operator roles", error);
    rolesData.value = null;
  }
}

onMounted(() => {
  void loadModels();
  void loadOperatorRoles();
  introTimer = setTimeout(() => {
    introTimer = null;
    if (step.value === 1) step.value = 2;
  }, INTRO_AUTO_NEXT_MS);
});

onBeforeUnmount(clearTimers);
</script>

<template>
  <view class="gi" @tap="onPageTap">
    <!-- 背景：设计稿 #F5FCFF → #FFF 的冷色渐变 + 右下角一抹粉紫 -->
    <view class="gi__bg" />
    <view class="gi__glow" />
    <view class="gi__glow gi__glow--pink" />

    <view class="gi__content">
      <!-- 标题：每态文案与左边距不同，切换时重放入场动画 -->
      <text
        :key="`title-${step}`"
        class="gi__title"
        :style="{ left: `${stepText.titleLeft}rpx` }"
      >
        {{ stepText.title }}
      </text>

      <!-- 第一态副标题：设计稿的紫 → 蓝 → 粉渐变字 -->
      <text v-if="step === 1" class="gi__subtitle">
        {{ INTRO_SUBTITLE }}
      </text>

      <!-- 中心 SANI 图标（四态位置一致） -->
      <view class="gi__logo">
        <image class="gi__logo-img" :src="brandLogo" mode="aspectFit" />
      </view>

      <!-- 第二态：同类设备经验气泡 -->
      <view v-if="step === 2" :key="`bubbles-${step}`" class="gi__layer">
        <view
          v-for="(item, index) in EXPERIENCE_BUBBLES"
          :key="item.key"
          class="gi__bubble"
          :class="{
            'gi__bubble--ghost': item.ghost,
            'gi__bubble--selected': selectedKey === item.key,
          }"
          :style="{ ...bubbleStyle(item), animationDelay: `${index * 90}ms` }"
          @tap.stop="onExperienceTap(item)"
        >
          <text v-if="item.label" class="gi__bubble-text">
            {{ item.label }}
          </text>
        </view>
      </view>

      <!-- 第三态：选择体验的设备 -->
      <view v-else-if="step === 3" :key="`devices-${step}`" class="gi__layer">
        <view
          v-for="(item, index) in deviceOptions"
          :key="item.modelKey"
          class="gi__pill"
          :class="{ 'gi__pill--selected': selectedKey === item.modelKey }"
          :style="{ ...pillStyle(DEVICE_SLOTS[index]), animationDelay: `${index * 90}ms` }"
          @tap.stop="onDeviceTap(item)"
        >
          <text class="gi__pill-text">
            {{ item.modelName }}
          </text>
        </view>
      </view>

      <!-- 第四态：当前机型经验 -->
      <view v-else-if="step === 4" :key="`exp-${step}`" class="gi__layer">
        <view
          v-for="(item, index) in EXPERIENCE_PILLS"
          :key="item.key"
          class="gi__pill"
          :class="{ 'gi__pill--selected': selectedKey === item.key }"
          :style="{ ...pillStyle(item), animationDelay: `${index * 90}ms` }"
          @tap.stop="onModelExperienceTap(item.key)"
        >
          <text class="gi__pill-text">
            {{ item.label }}
          </text>
        </view>
      </view>

      <!-- 底部提示：第一态没有 -->
      <text v-if="step !== 1" :key="`hint-${step}`" class="gi__hint">
        {{ stepText.hint }}
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

/* 底部彩色氛围：设计稿 347:5118 / 347:5147（紫 → 蓝 → 紫 → 粉，模糊 60） */
.gi__glow {
  position: absolute;
  right: -80rpx;
  bottom: -140rpx;
  left: -80rpx;
  z-index: 0;
  height: 300rpx;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    #295dc3 0%,
    #1999fe 34%,
    #fd90c4 68%,
    #c067fa 100%
  );
  filter: blur(100rpx);
  opacity: 0.72;
  /* 往上收淡：只留贴底一缕彩色，避免整页发灰（比盖一层白更柔和，不会露出分界线） */
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 62%);
  -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 1) 62%);
}

.gi__glow--pink {
  right: -160rpx;
  bottom: -220rpx;
  left: 28%;
  height: 280rpx;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, #fae4f3 45%, #c067fa 100%);
  filter: blur(130rpx);
  opacity: 0.4;
}

.gi__content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}

/* 标题：20px Medium #0D0D0D，y=117（扣状态栏 63px → 126rpx） */
.gi__title {
  position: absolute;
  top: 126rpx;
  max-width: 660rpx;
  color: #0d0d0d;
  font-size: 40rpx; // 20
  font-weight: 500;
  line-height: 58rpx; // 29
  white-space: pre-line;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 第一态副标题：紫 → 蓝 → 粉的渐变字（347:5095 的 722:2487） */
.gi__subtitle {
  position: absolute;
  top: 189rpx; // y=148.5
  left: 106rpx; // x=53
  color: transparent;
  font-size: 40rpx;
  font-weight: 500;
  line-height: 58rpx;
  white-space: pre-line;
  background: linear-gradient(90deg, #3d21cd 0%, #1999fe 49%, #c067fa 76%, #fd90c4 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: gi-rise 620ms cubic-bezier(0.22, 0.61, 0.36, 1) 120ms both;
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

/* ===== 第二态：玻璃气泡（347:5136 / 580:1548 / 580:1544）=====
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

.gi__bubble-text {
  position: relative;
  z-index: 1;
  font-size: 32rpx; // 16
  font-weight: 500;
  line-height: 46rpx; // 23
  white-space: pre-line;
}

/* ===== 第三 / 四态：机型与经验胶囊 =====
   设计稿填充是低透明度的紫粉蓝渐变（opacity 0.16）+ 1px 浅蓝描边 + 背景模糊 */
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

/* 底部提示：16px #8E8E8E 居中，设计稿 y=597 → 1086rpx */
.gi__hint {
  position: absolute;
  top: 1086rpx;
  right: 0;
  left: 0;
  color: #8e8e8e;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
  text-align: center;
  animation: gi-rise 520ms cubic-bezier(0.22, 0.61, 0.36, 1) 160ms both;
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

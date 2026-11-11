<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import closeRecordingIcon from "@/assets/img/icon-close-recording.svg";

/**
 * 语音提问底部条 —— 还原 Ardot「起始态 • 唤醒-智能体移动到顶部」(70:1614) 的 Voice Pill。
 *
 * 设计稿实测（px，1px = 2rpx）：
 * - 胶囊 70:1651：327×44，x=24，距页底 36，圆角 45
 * - 左按钮 70:1653：36×36，内边距 6 / 4，圆角 18，白色 × 线宽 2
 * - 声纹 77:1006：87×9.405，x=53，16 根 2px 白线，中心间距 5.8
 * - 计时 70:1652：14px / 行高 20 / #FFFFFF，x=262
 * - 右按钮 70:1657：36×36，圆角 18，#FFFFFF，箭头线宽 1.667 / #0D0D0D
 * - 声纹右端到计时左端留 122px 空白（设计稿如此，不自行铺满）
 */

defineOptions({
  name: "AiVoiceQueryBar",
});

const { t } = useI18n();

const props = defineProps({
  /** 实时音量 0~1（已平滑，由 useVoiceQuery 的音量采样给出）：驱动逐根竖线的律动幅度 */
  level: { type: Number, default: 0 },
  /** 已录秒数：右侧那枚 1s */
  seconds: { type: Number, default: 0 },
  /** 已发过 finish、在等定稿：按钮降透明度，避免重复点 */
  busy: { type: Boolean, default: false },
  holdToSend: { type: Boolean, default: false },
  cancelPending: { type: Boolean, default: false },
  /** 深色外观：设计稿只有浅色，这里仅给夜间模式兜底 */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "submit"): void;
}>();

/**
 * 声纹高度权重的取池（rpx）：数值取自设计稿那段声纹的高低起伏形态。
 * 每送进一个时间片就按顺序取一个值（循环），决定这一片"满音量时能长多高"——
 * 同一片在向右滚动的过程中形状固定，变的只是位置。
 */
const BAR_HEIGHTS = [
  10,
  18,
  26,
  36,
  22,
  14,
  30,
  40,
  26,
  16,
  12,
  22,
  34,
  20,
  12,
  8,
  14,
  26,
  38,
  24,
  14,
  10,
  20,
  32,
  18,
  10,
  8,
  14,
  24,
  16,
  10,
  6,
];

/* ===================== 声纹律动（先铺满，再向左滚）=====================
   两个阶段，都是每 WAVE_STEP_MS 往最右侧追加一个时间片：
   1) 填充期：只追加、不移除，既有片 index 不变 —— 整排不动，从左到右一根根长出来；
   2) 滚动期：铺满容器后，追加新片的同时把最左那片移出（shift），
      剩余片 index 全部 -1 → 整体向左平移一格：新片从右侧进来，图案从右往左流，
      左端移出容器被 overflow 裁掉，一直滚下去。
   每个时间片的高度只由「采样那一刻的音量」决定：
     height = 静音小线 + sqrt(level) × 1.2 × 该片的固定权重
   - 静音时 level=0 → 每片都是 BAR_IDLE_HEIGHT（6rpx）的小竖线，整排像均匀的小点；
   - 说话时按音量长高，不再有任何自发周期性跳动；
   - 权重由 BAR_HEIGHTS 轮取，保证同一片在滚动过程中形状不变（变化的是位置，不是形状），
     这才是「流动」而不是「原地闪烁」；
   - 位置用 translateX(index × 步进) 表达，并配同样时长的 transform 过渡，滚动是连续的。 */
/** 推进间隔：一格 70ms */
const WAVE_STEP_MS = 70;
/** 一格步进：线宽 4rpx + 间隙 4rpx */
const WAVE_STEP_RPX = 8;
/** 测不到容器宽度时的兜底格数（按约 320rpx 的可视宽度估） */
const DEFAULT_FILL_TARGET = 40;
/** 没有声音时每根线的高度：一条很小的竖线 */
const BAR_IDLE_HEIGHT = 6;
const BAR_MAX_HEIGHT = 42; // 容器高 44rpx，留 2rpx 余量，最高的线也不会顶出胶囊

interface WaveSlice {
  id: number;
  height: number;
}

/** 时间片按「越靠右越新」排：index 0 是最旧的一片，末尾是最新采样 */
const slices = ref<WaveSlice[]>([]);
/** 铺满容器需要多少片：挂载后按容器实际宽度算，测不到就用兜底值 */
const fillTarget = ref(DEFAULT_FILL_TARGET);
let sliceSeq = 0;
let scrolling = false;
let waveTimer: ReturnType<typeof setInterval> | null = null;

/** 量一次波形容器的可见宽度，换算成"铺满要几格"（多留一格，右边缘不留缝） */
function measureFillTarget() {
  const instance = getCurrentInstance();
  if (!instance) return;
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select(".voice-query__wave")
    .boundingClientRect((rect) => {
      const width = Number((rect as { width?: number } | null)?.width || 0);
      if (width <= 0) return;
      const step = uni.upx2px(WAVE_STEP_RPX);
      if (step <= 0) return;
      fillTarget.value = Math.max(1, Math.ceil(width / step) + 1);
      if (slices.value.length >= fillTarget.value) scrolling = true;
    })
    .exec();
}

function buildSlice(): WaveSlice {
  const level = Math.min(1, Math.max(0, props.level));
  const gain = Math.sqrt(level) * 1.2;
  const weight = BAR_HEIGHTS[sliceSeq % BAR_HEIGHTS.length] / BAR_MAX_HEIGHT;
  const height = Math.min(BAR_MAX_HEIGHT, BAR_IDLE_HEIGHT + gain * BAR_MAX_HEIGHT * weight);
  sliceSeq += 1;
  return { id: sliceSeq, height };
}

function pushSlice() {
  // 两阶段都往最右侧追加：填充期只长不理，滚动期再挤掉最左一片
  slices.value.push(buildSlice());
  if (!scrolling) {
    // 填充期：既有片 index 不变 → 整排不动，只是从左到右长出来
    if (slices.value.length >= fillTarget.value) scrolling = true;
    return;
  }
  // 滚动期：左侧移出一片，剩余片 index -1 → 整体向左平移一格，新片从右侧补进来
  if (slices.value.length > fillTarget.value) slices.value.shift();
}

onMounted(() => {
  measureFillTarget();
  pushSlice();
  waveTimer = setInterval(pushSlice, WAVE_STEP_MS);
});

onBeforeUnmount(() => {
  if (waveTimer) {
    clearInterval(waveTimer);
    waveTimer = null;
  }
});

// 每轮录音条重新挂载；记住本轮使用长按遮罩，松手后不再补出旧的点击录音光晕。
const useHoldBackdrop = props.holdToSend;
const secondsText = computed(() => `${props.seconds}s`);

/** 声纹区域与箭头共用发送出口；等待识别定稿时不重复提交。 */
function onSubmit() {
  if (props.busy || props.holdToSend) return;
  emit("submit");
}
</script>

<template>
  <!-- ===== 录音中底部半圆光晕：#0F7EEE 径向渐变，圆心在底部正中，向上收成半圆顶 =====
       单层纯渐变就够：靠 alpha 收边，不会像「模糊层 + overflow 裁」那样切出硬线 -->
  <view v-if="!useHoldBackdrop" class="voice-query__glow" :class="{ 'voice-query__glow--dark': dark }" aria-hidden="true" />

  <!-- ===== 胶囊后面的垫底渐隐 =====
       输入栏有一条不透明的底，正文滚到它后面就被挡住了；录音条只有一枚半透明胶囊，
       上一条回答滚到这里会整段透出来，看着就是「字被压住、突破了底部安全区」。
       这里铺一层页面底色，高度刚好盖到胶囊顶边（安全区 + 160rpx），
       层级压在消息列表之上、光晕（1000）与胶囊（1001）之下：底色只挡正文，不挡这些控件 -->
  <view class="voice-query__mask" :class="{ 'voice-query__mask--dark': dark }" aria-hidden="true" />

  <!-- 设计稿 70:1651 Voice Pill：327×44 / r45 / rgba(13,13,13,0.38) / 左右 24 距底 36 -->
  <view class="voice-query" :class="{ 'voice-query--dark': dark, 'voice-query--cancel-pending': holdToSend && cancelPending }">
    <!-- 设计稿 70:1653 Group 109：36×36 圆 + ×。
         改用导出的整圆图标 icon-close-recording.svg（36×36，白 33.6% 圆底 + 白色 ×），
         圆底随图一起进来，容器不再铺底色 -->
    <view class="voice-query__cancel" @tap="emit('cancel')">
      <image class="voice-query__cancel-img" :src="closeRecordingIcon" mode="aspectFit" />
    </view>

    <!-- 整段声纹与计时都可点发送；热区不随声纹的缩放动画缩小。 -->
    <view
      class="voice-query__send-area"
      :class="{ 'voice-query__send-area--busy': busy }"
      :aria-disabled="busy"
      @tap.stop="onSubmit"
    >
      <!-- 时间轴：每 70ms 从右侧送进一个新片，铺满后整条带子向左平移（见 pushSlice） -->
      <view class="voice-query__wave">
        <view
          v-for="(slice, index) in slices"
          :key="slice.id"
          class="voice-query__bar"
          :style="{
            height: `${slice.height}rpx`,
            transform: `translateX(${index * WAVE_STEP_RPX}rpx) translateY(-50%)`,
          }"
        />
      </view>
      <text class="voice-query__time">
        {{ secondsText }}
      </text>
    </view>

    <!-- 设计稿 70:1657 Group 110：36×36 白色圆 + 上箭头（点按结束录音） -->
    <view
      class="voice-query__submit"
      :class="{ 'voice-query__submit--busy': busy }"
      :aria-disabled="busy"
      @tap.stop="onSubmit"
    >
      <view class="voice-query__arrow">
        <view class="voice-query__arrow-head" />
        <view class="voice-query__arrow-stem" />
      </view>
    </view>
  </view>

  <!-- 胶囊下方的安全提示：输入栏换成录音条时原来那句提示会跟着一起消失，
       这里补回来，位置 / 字号 / 颜色与 .chat-input__footer 完全同口径 -->
  <text class="voice-query__hint">
    {{ t("ai-content-disclaimer") }}
  </text>
</template>

<style scoped lang="scss">
/* ===================== 录音中底部光晕 =====================
   色值用 #0F7EEE（rgb(15,126,238)），径向渐变：圆心在底部正中，
   从胶囊底下向四周衰减，抬头是一条大半径的圆弧 —— 不是线性渐变那样整条横平。

   形状要「很扁的弧」：水平半径给到 120%（比屏宽还宽），垂直半径 = 层高 230px，
   宽高比接近 2:1。屏幕可见的只是这个超大椭圆的顶部一小段，
   所以中间几乎是平的、两侧缓缓落到屏幕边上（不是小半圆那种碗形）。

   bottom: 0 而不是 safe-area：光晕要贴到屏幕最下沿，
   胶囊与提示语各自带 safe-area 上移，不受影响。 */
.voice-query__glow {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000; // 压在胶囊（1001）之下、内容之上
  height: 460rpx; // 230px，与椭圆的垂直半径一致
  background: radial-gradient(
    ellipse 75% 78% at 50% 100%,
    rgba(15, 126, 238, 0.4) 0%,
    rgba(15, 126, 238, 0.26) 30%,
    rgba(15, 126, 238, 0.12) 58%,
    rgba(15, 126, 238, 0.04) 82%,
    rgba(15, 126, 238, 0) 100%
  );
  pointer-events: none;
  animation: voice-query-glow-in 260ms ease-out both;
}

/* 深色外观：深底上要更亮一点才看得出，色值不变 */
.voice-query__glow--dark {
  background: radial-gradient(
    ellipse 120% 100% at 50% 100%,
    rgba(15, 126, 238, 0.56) 0%,
    rgba(15, 126, 238, 0.37) 30%,
    rgba(15, 126, 238, 0.17) 58%,
    rgba(15, 126, 238, 0.06) 82%,
    rgba(15, 126, 238, 0) 100%
  );
}

/* 与胶囊的散开动画同步浮现；静态终态与设计稿完全一致 */
@keyframes voice-query-glow-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* ===== 胶囊后面的垫底渐隐 =====
   高度 = 胶囊顶边（bottom 72rpx + 高 88rpx = 160rpx）再带上底部安全区，
   所以它盖住的正好是「胶囊那一条带」，不会往上多挡正文。
   上沿留一段透明过渡（40% 处才完全实色）：硬切一条白边会比透字更难看。
   层级 999：压在消息列表之上，光晕（1000）与胶囊 / 提示语（1001）之下，
   光晕仍然照常透出来，胶囊和提示语也照常可见。 */
.voice-query__mask {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 999;
  height: calc(env(safe-area-inset-bottom) + 160rpx);
  background: linear-gradient(180deg, rgb(250 250 250 / 0%) 0%, #fafafa 40%);
  pointer-events: none;
}

.voice-query__mask--dark {
  background: linear-gradient(180deg, rgb(26 26 26 / 0%) 0%, #1a1a1a 40%);
}

/* 设计稿 70:1651 Voice Pill
   327×44px → 654×88rpx；x=24（左右 48rpx）；距底 36px=72rpx；
   圆角 45px→90rpx（大于半高，视觉即胶囊）；
   底 rgba(13,13,13,0.38)：浅色稿的胶囊是中性灰（约 #A2A2A2），
   原来 0.279 压在蓝光上偏深，换成白光晕后要再压深一点才和稿子一致；
   padding 6 / 4 → 12rpx / 8rpx */
.voice-query {
  position: fixed;
  right: 48rpx;
  bottom: calc(72rpx + env(safe-area-inset-bottom));
  left: 48rpx;
  z-index: 1001;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 88rpx;
  padding: 8rpx 12rpx;
  border-radius: 90rpx;
  background: rgba(13, 13, 13, 0.38);
  // 入场：从中间向两边散开（clip-path 只裁视觉，不改布局），散开到位后内部元素再淡入，
  // 就是「点击说话 → 向两边散开 → 出现录音态」的节奏。
  // 容器不支持 clip-path 时直接显示完整胶囊，功能不受影响
  animation: voice-query-spread 320ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 起点约等于「点击说话」胶囊的宽度（60% 上下），向左右两侧各推开到满宽。
   clip-path 必须带 round 90rpx：不加 round 时，部分 WebView 会直接按矩形裁切、
   忽略元素自身的 border-radius，散开中/散开完的左右端头都是直角方块；
   补上 round 后两端始终是半圆，与展开态（编辑面板）的胶囊端头一致 */
@keyframes voice-query-spread {
  from {
    clip-path: inset(0 20% round 90rpx);
    opacity: 0.55;
  }

  to {
    clip-path: inset(0 0 round 90rpx);
    opacity: 1;
  }
}

/* 内部元素等胶囊散开之后再浮现（backwards 只在延迟期生效，播完不覆盖 --busy 的透明度） */
.voice-query__cancel,
.voice-query__wave,
.voice-query__time,
.voice-query__submit {
  animation: voice-query-part-in 200ms ease 140ms backwards;
}

@keyframes voice-query-part-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

/* 左按钮热区：设计稿 70:1653 的 36×36（72rpx）。
   圆底与 × 都在 icon-close-recording.svg 里（36×36 画布，圆 #FFFFFD 33.6% + 白 ×），
   所以这里不再铺背景，只保证尺寸与居中 */
.voice-query__cancel {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
}

/* 图标按 36px（72rpx）1:1 挂，与设计稿圆尺寸一致 */
.voice-query__cancel-img {
  width: 72rpx;
  height: 72rpx;
}

/* 声纹铺满左圆与计时之间的整条剩余空间（原来是固定 174rpx，右侧留一大段空白）。
   高度给足 44rpx：最高那根 40rpx，缩放后不裁切 */
.voice-query__send-area {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  height: 100%;
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
.voice-query__send-area--busy {
  opacity: 0.45;
  cursor: default;
}
.voice-query__wave {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  height: 44rpx;
  margin: 0 16rpx 0 22rpx;
  overflow: hidden; // 滚到最右边的片直接裁掉，右端不露头
}

/* 每根线绝对定位，横向位置 = index × 8rpx（行内 translateX 给），
   transition 与推进间隔同长：滚动期 index 整体 -1 时匀速左移，看上去是带子在向左流 */
.voice-query__bar {
  position: absolute;
  top: 50%;
  left: 0;
  width: 4rpx;
  border-radius: 4rpx;
  background: #ffffff;
  transition: transform 70ms linear, height 70ms linear;
}

/* 设计稿 70:1652：14px=28rpx / 行高 20px=40rpx / Regular / #FFFFFF。
   宽度不再写死 30rpx（那是设计稿个位数「4s」的量）：两位数「10s」会溢出、顶到右侧按钮上。
   改成 min-width + 右对齐 + 等宽数字：位数变多时向左长，和按钮的间距保持不变，个位数也不跳 */
.voice-query__time {
  flex: 0 0 auto;
  min-width: 48rpx;
  margin-right: 16rpx; // 计时右端 277 → 右圆 285，8px
  color: #ffffff;
  font-family:
    "Source Han Sans CN",
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 40rpx;
  text-align: right;
}

/* 设计稿 70:1657 / 70:1661：36×36 圆（72rpx），r18（36rpx），纯白不透明 */
.voice-query__submit {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: #ffffff;
}

.voice-query__submit--busy {
  opacity: 0.45;
}

/* 设计稿 70:1658：20×20（40rpx）箭头位，内部：chevron 11.667×5.833 + 竖线 11.667 */
.voice-query__arrow {
  position: relative;
  width: 40rpx;
  height: 40rpx;
}

/* chevron：11.667px 宽（23.33rpx）的包围盒 → 方框边长 16.5rpx，
   左上两条边描边 1.667px（3.33rpx），绕中心 rotate(45deg) 后向上成 ∧ */
.voice-query__arrow-head {
  position: absolute;
  top: 11.75rpx;
  left: 11.75rpx;
  box-sizing: border-box;
  width: 16.5rpx;
  height: 16.5rpx;
  border-top: 3.33rpx solid #0d0d0d;
  border-left: 3.33rpx solid #0d0d0d;
  transform: rotate(45deg);
}

/* 竖线：x=10px（中心 20rpx）、y=4.167px（8.33rpx）、高 11.667px（23.33rpx）、粗 1.667px（3.33rpx） */
.voice-query__arrow-stem {
  position: absolute;
  top: 8.33rpx;
  left: 18.34rpx;
  box-sizing: border-box;
  width: 3.33rpx;
  height: 23.33rpx;
  background: #0d0d0d;
}

/* ===== 胶囊下方的安全提示 =====
   口径与输入栏的 .chat-input__footer 保持一致（12px / #BABABA / 居中 / 文字底距页面底 15px），
   录音条替掉输入栏时这句提示不能跟着丢 */
.voice-query__hint {
  position: fixed;
  right: 0;
  bottom: calc(30rpx + env(safe-area-inset-bottom));
  left: 0;
  z-index: 1001;
  color: #bababa;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  text-align: center;
  pointer-events: none;
  animation: voice-query-part-in 200ms ease 140ms backwards;
}

/* 深色外观：设计稿无此态，仅夜间模式兜底（数值按同比例反色） */
.voice-query--dark {
  background: rgba(242, 242, 245, 0.16);
}

.voice-query--cancel-pending {
  background: rgba(13, 13, 13, 0.5);
}

.voice-query--dark .voice-query__bar {
  background: #f2f3f5;
}

.voice-query--dark .voice-query__time {
  color: #f2f3f5;
}

.voice-query--dark .voice-query__hint {
  color: rgba(242, 243, 245, 0.55);
}

.voice-query--dark .voice-query__submit {
  background: #f2f3f5;
}

.voice-query--dark .voice-query__arrow-head {
  border-color: #0d0d0d;
}

.voice-query--dark .voice-query__arrow-stem {
  background: #0d0d0d;
}
</style>

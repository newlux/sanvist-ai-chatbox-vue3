<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

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
  /** 实时音量 0~1（已平滑）：整体缩放声纹，基线高度仍是设计稿那 16 根 */
  level: { type: Number, default: 0 },
  /** 已录秒数：右侧那枚 1s */
  seconds: { type: Number, default: 0 },
  /** 已发过 finish、在等定稿：按钮降透明度，避免重复点 */
  busy: { type: Boolean, default: false },
  /** 深色外观：设计稿只有浅色，这里仅给夜间模式兜底 */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "submit"): void;
}>();

/**
 * 声纹每根线的基准高度（rpx）：按设计稿的高低起伏形态扩到 32 根，
 * 数量按「铺满左圆与计时之间的整条空间」来定，间距由 space-between 均分。
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

/**
 * 整体振幅：静息 0.55 倍（收着，留出「说话变高」的余量），音量拉满到 1.5 倍
 * （再高最高那根会顶出胶囊）。单根线自己还有一段 CSS 呼吸动画，两者相乘才是最终起伏 ——
 * 只靠整体缩放的话，矮线（4rpx 量级）上下变化不到 1px，肉眼看不出在动。
 */
const waveScale = computed(() => {
  const level = Math.min(1, Math.max(0, props.level));
  // 开平方压一下动态范围：正常说话的 RMS 只到 0.1~0.3，线性映射时整排幅度几乎不变
  const shaped = Math.sqrt(level);
  return (0.55 + shaped * 0.95).toFixed(3);
});

const secondsText = computed(() => `${props.seconds}s`);

/** 声纹区域与箭头共用发送出口；等待识别定稿时不重复提交。 */
function onSubmit() {
  if (props.busy) return;
  emit("submit");
}
</script>

<template>
  <!-- ===== 录音中底部半圆光晕：#0F7EEE 径向渐变，圆心在底部正中，向上收成半圆顶 =====
       单层纯渐变就够：靠 alpha 收边，不会像「模糊层 + overflow 裁」那样切出硬线 -->
  <view class="voice-query__glow" :class="{ 'voice-query__glow--dark': dark }" aria-hidden="true" />

  <!-- ===== 胶囊后面的垫底渐隐 =====
       输入栏有一条不透明的底，正文滚到它后面就被挡住了；录音条只有一枚半透明胶囊，
       上一条回答滚到这里会整段透出来，看着就是「字被压住、突破了底部安全区」。
       这里铺一层页面底色，高度刚好盖到胶囊顶边（安全区 + 160rpx），
       层级压在消息列表之上、光晕（1000）与胶囊（1001）之下：底色只挡正文，不挡这些控件 -->
  <view class="voice-query__mask" :class="{ 'voice-query__mask--dark': dark }" aria-hidden="true" />

  <!-- 设计稿 70:1651 Voice Pill：327×44 / r45 / rgba(13,13,13,0.38) / 左右 24 距底 36 -->
  <view class="voice-query" :class="{ 'voice-query--dark': dark }">
    <!-- 设计稿 70:1653 Group 109：36×36 浅色圆 + 深灰 ×（左内边距 6、上 4） -->
    <view class="voice-query__cancel" @tap="emit('cancel')">
      <view class="voice-query__cross" />
    </view>

    <!-- 整段声纹与计时都可点发送；热区不随声纹的缩放动画缩小。 -->
    <view
      class="voice-query__send-area"
      :class="{ 'voice-query__send-area--busy': busy }"
      :aria-disabled="busy"
      @tap.stop="onSubmit"
    >
      <view class="voice-query__wave" :style="{ '--wave-scale': waveScale }">
        <view
          v-for="(height, index) in BAR_HEIGHTS"
          :key="index"
          class="voice-query__bar"
          :style="{ '--bar-h': `${height}rpx`, '--bar-i': index }"
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

/* 设计稿 70:1653 / 70:1656：36×36 圆（72rpx），r18（36rpx），底 rgba(255,255,253,0.336) */
.voice-query__cancel {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: 36rpx;
  background: rgba(255, 255, 253, 0.336);
}

/* 设计稿 70:1654 / 70:1655：两条 16.97px（33.94rpx）长、2px（4rpx）粗的线交叉 90°。
   浅色稿的胶囊是中灰、X 落在更亮的浅灰圆上，用深灰才看得清（原来是白色，压在深色胶囊上） */
.voice-query__cross {
  position: relative;
  width: 33.94rpx;
  height: 33.94rpx;

  &::before,
  &::after {
    position: absolute;
    top: 50%;
    left: 0;
    width: 100%;
    height: 4rpx;
    margin-top: -2rpx;
    background: rgba(13, 13, 13, 0.6);
    content: "";
  }

  &::before {
    transform: rotate(45deg);
  }

  &::after {
    transform: rotate(-45deg);
  }
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
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  height: 44rpx;
  margin: 0 16rpx 0 22rpx;
  transform: scaleY(var(--wave-scale, 1)); // 整排跟随音量
  transform-origin: center center;
  transition: transform 90ms linear;
}

/* 每根线：宽度固定 4rpx，高度取 --bar-h，
   再叠一段带相位差的呼吸动画 —— 只靠整排缩放，矮线几乎看不出在动 */
.voice-query__bar {
  flex: 0 0 auto;
  width: 4rpx;
  height: var(--bar-h);
  border-radius: 4rpx;
  background: #ffffff;
  transform-origin: center center;
  animation: voice-bar-pulse 1s ease-in-out infinite alternate;
  animation-delay: calc(var(--bar-i) * -0.06s);
}

@keyframes voice-bar-pulse {
  from {
    transform: scaleY(0.45);
  }

  to {
    transform: scaleY(1);
  }
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

.voice-query--dark .voice-query__cancel {
  background: rgba(255, 255, 253, 0.2);
}

/* 深底 + 浅圆：X 换回白色 */
.voice-query--dark .voice-query__cross::before,
.voice-query--dark .voice-query__cross::after {
  background: #ffffff;
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

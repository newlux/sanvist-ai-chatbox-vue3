<script setup lang="ts">
import { computed } from "vue";

/**
 * 语音提问底部条 —— 1:1 还原 Ardot「起始态 • 唤醒-智能体移动到顶部」(70:1614) 的 Voice Pill。
 *
 * 设计稿实测（px，1px = 2rpx）：
 * - 胶囊 70:1651：327×44，x=24，距页底 36，圆角 45，底 rgba(13,13,13,0.279)
 * - 左按钮 70:1653：36×36，内边距 6 / 4，圆角 18，底 rgba(255,255,253,0.336)，白色 × 线宽 2
 * - 声纹 77:1006：87×9.405，x=53，16 根 2px 白线，中心间距 5.8
 * - 计时 70:1652：14px / 行高 20 / #FFFFFF，x=262
 * - 右按钮 70:1657：36×36，圆角 18，#FFFFFF，箭头线宽 1.667 / #0D0D0D
 * - 声纹右端到计时左端留 122px 空白（设计稿如此，不自行铺满）
 */

defineOptions({
  name: "AiVoiceQueryBar",
});

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
</script>

<template>
  <!-- ===== 录音中底部蓝光：设计稿 77:11564 Frame 86 =====
       容器 375×166，y=676（页面 812 高，下沿 842 → 溢出 30px，由 overflow 裁掉，对应设计稿 clipsContent） -->
  <view class="voice-query__glow" aria-hidden="true">
    <!-- 77:11569 Vector 87：449×195 @(-38,9)，#295DC3 → #0D7ABA，图层模糊 50 -->
    <view class="voice-query__glow-block" />
    <!-- 77:11567 Ellipse 75：434×341 @(-31,39)，#0F7EEE 0 → 40%，图层模糊 37 -->
    <view class="voice-query__glow-ellipse" />
  </view>

  <!-- 设计稿 70:1651 Voice Pill：327×44 / r45 / rgba(13,13,13,0.279) / 左右 24 距底 36 -->
  <view class="voice-query" :class="{ 'voice-query--dark': dark }">
    <!-- 设计稿 70:1653 Group 109：36×36 圆 + 白色 ×（左内边距 6、上 4） -->
    <view class="voice-query__cancel" @tap="emit('cancel')">
      <view class="voice-query__cross" />
    </view>

    <!-- 声纹：铺满左圆与计时之间的整条空间，单根呼吸 + 整排跟随音量 -->
    <view class="voice-query__wave" :style="{ '--wave-scale': waveScale }">
      <view
        v-for="(height, index) in BAR_HEIGHTS"
        :key="index"
        class="voice-query__bar"
        :style="{ '--bar-h': `${height}rpx`, '--bar-i': index }"
      />
    </view>

    <!-- 设计稿 70:1652：14px / 行高 20 / 白色 / Source Han Sans CN Regular -->
    <text class="voice-query__time">
      {{ secondsText }}
    </text>

    <!-- 设计稿 70:1657 Group 110：36×36 白色圆 + 上箭头（点按结束录音） -->
    <view
      class="voice-query__submit"
      :class="{ 'voice-query__submit--busy': busy }"
      @tap="emit('submit')"
    >
      <view class="voice-query__arrow">
        <view class="voice-query__arrow-head" />
        <view class="voice-query__arrow-stem" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ===================== 录音中底部蓝光：设计稿 77:11564 Frame 86 =====================
   容器 375×166 / y=676：下沿 842 超出页面 812 共 30px，靠 overflow 裁掉（设计稿 clipContent）。
   bottom 带上 safe-area：胶囊本身也随安全区上移，光晕必须同幅上移，
   否则「光晕顶边距胶囊底边 100px」这个设计关系会在全面屏上被拉断。 */
.voice-query__glow {
  position: fixed;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom) - 60rpx);
  left: 0;
  z-index: 1000; // 压在胶囊（1001）之下、内容之上
  height: 332rpx; // 166px
  overflow: hidden;
  pointer-events: none;
  animation: voice-query-glow-in 260ms ease-out both;
}

/* 77:11569 Vector 87：449×195 @(-38,9)，相对容器 left -38 / top 9
   gradientTransform 是单位阵（竖向那组是 [[0,1,0],[-1,0,1]]，可反推出单位阵=横向）→ 渐变自左向右；
   449→898rpx、195→390rpx、-38→-76rpx、9→18rpx */
.voice-query__glow-block {
  position: absolute;
  top: 18rpx;
  left: -76rpx;
  width: 898rpx;
  height: 390rpx;
  background: linear-gradient(90deg, #295dc3 0%, #0d7aba 100%);
  filter: blur(50px); // LAYER_BLUR radius 50（filter 只吃 px，不写 rpx）
}

/* 77:11567 Ellipse 75：434×341 @(-31,39)
   gradientTransform 反解出的方向是「自下而上」（stop0 透明在下方，stop1 40% 在上方）；
   434→868rpx、341→682rpx、-31→-62rpx、39→78rpx */
.voice-query__glow-ellipse {
  position: absolute;
  top: 78rpx;
  left: -62rpx;
  width: 868rpx;
  height: 682rpx;
  border-radius: 50%;
  background: linear-gradient(0deg, rgba(15, 126, 238, 0) 0%, rgba(15, 126, 238, 0.4) 100%);
  filter: blur(37px); // LAYER_BLUR radius 37
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

/* 设计稿 70:1651 Voice Pill
   327×44px → 654×88rpx；x=24（左右 48rpx）；距底 36px=72rpx；
   圆角 45px→90rpx（大于半高，视觉即胶囊）；底 rgba(13,13,13,0.279)；
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
  background: rgba(13, 13, 13, 0.279);
  // 入场：从中间向两边散开（clip-path 只裁视觉，不改布局），散开到位后内部元素再淡入，
  // 就是「点击说话 → 向两边散开 → 出现录音态」的节奏。
  // 容器不支持 clip-path 时直接显示完整胶囊，功能不受影响
  animation: voice-query-spread 320ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 起点约等于「点击说话」胶囊的宽度（60% 上下），向左右两侧各推开到满宽 */
@keyframes voice-query-spread {
  from {
    clip-path: inset(0 20%);
    opacity: 0.55;
  }

  to {
    clip-path: inset(0 0);
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

/* 设计稿 70:1654 / 70:1655：两条 16.97px（33.94rpx）长、2px（4rpx）粗的白线交叉 90° */
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
    background: #ffffff;
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

/* 深色外观：设计稿无此态，仅夜间模式兜底（数值按同比例反色） */
.voice-query--dark {
  background: rgba(242, 242, 245, 0.16);
}

.voice-query--dark .voice-query__cancel {
  background: rgba(255, 255, 253, 0.2);
}

.voice-query--dark .voice-query__bar {
  background: #f2f3f5;
}

.voice-query--dark .voice-query__time {
  color: #f2f3f5;
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

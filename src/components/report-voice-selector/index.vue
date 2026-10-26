<script setup lang="ts">
import type { ListenBroadcastStyle } from "@/api/listen-broadcast/types";
import type { ReportVoiceOption } from "@/config/report-voices";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
// 顶部工作胶囊里的三角图标：换成动态 GIF（原 header-status-logo.png 的动画版），
// 与听播播放页头部用同一张小图（22×22 展示）
import headerStatusLogo from "@/assets/img/sani-logo-sm.gif";
import minimizeIcon from "@/assets/img/min_icon.png";
import arrowLeftIcon from "@/assets/img/nav-arrow-left.svg";
import arrowRightIcon from "@/assets/img/nav-arrow-right.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";
import ReportStyleSelector from "@/components/report-style-selector/index.vue";
import ReportWaveform from "@/components/report-waveform/index.vue";
import { REPORT_VOICE_OPTIONS } from "@/config/report-voices";
import { useIframeMinimize } from "@/hooks/useIframeMinimize";
import { usePcMode } from "@/hooks/usePcMode";
import { useReportVoice } from "@/hooks/useReportVoice";

const emit = defineEmits<{
  confirm: [voice: ReportVoiceOption, style: ListenBroadcastStyle, moduleCodes: string[]];
  close: [];
}>();

const { t } = useI18n();

/** PC 端内嵌时顶栏右侧露出「最小化」，替换原来的空占位 */
const { canMinimize, onMinimize } = useIframeMinimize();
/** PC 端专用：把主视觉两侧的装饰声波替换成可点击的左右尖括号；APP / 移动端不渲染，仍是声波 */
const { isPc } = usePcMode();

// 报告听播音色交互：只在风格确认后一起保存，避免留下半完成配置
const { saveReportVoice } = useReportVoice();

// 两步流程：先选音色（voice），点「下一步」进「选择风格」（style）
const step = ref<"voice" | "style">("voice");
const confirmedVoiceCode = ref("");

// 设计稿 309:2117 左声波 17 根柱高（px）
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
// 设计稿 309:2155 右声波 17 根柱高（px）
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];
// 左右声波共用同一套横向渐变（309:2117 fills）：
// 0% #3D21CD → 48.72% #1999FE → 76% #C067FA → 100% #FD90C4
const waveGradient = [
  { color: "#3D21CD", offset: 0 },
  { color: "#1999FE", offset: 48.72 },
  { color: "#C067FA", offset: 76 },
  { color: "#FD90C4", offset: 100 },
];

const selectedIndex = ref(2);
const dragStartX = ref(0);
const dragDeltaX = ref(0);
const dragging = ref(false);
const selectedVoice = computed(() => REPORT_VOICE_OPTIONS[selectedIndex.value]);

// —— 试听播放：滑到哪个音色就播放哪个的 preview wav ——
// isPlaying 用于驱动左右声波的音波动画
const isPlaying = ref(false);
let previewAudio: ReturnType<typeof uni.createInnerAudioContext> | null = null;

function playPreview(index: number) {
  const voice = REPORT_VOICE_OPTIONS[index];
  if (!voice?.preview) return;
  if (!previewAudio) {
    previewAudio = uni.createInnerAudioContext();
    previewAudio.onPlay(() => {
      isPlaying.value = true;
    });
    previewAudio.onEnded(() => {
      isPlaying.value = false;
    });
    previewAudio.onStop(() => {
      isPlaying.value = false;
    });
    previewAudio.onError(() => {
      isPlaying.value = false;
    });
  }
  previewAudio.stop();
  previewAudio.src = voice.preview;
  previewAudio.play();
}

function stopPreview() {
  previewAudio?.stop();
  isPlaying.value = false;
}

onMounted(() => {
  // 初始滑到默认选中音色（Mia），静音也需要用户交互才可播，H5 下首次可能被拦截
  playPreview(selectedIndex.value);
});

onUnmounted(() => {
  previewAudio?.stop();
  isPlaying.value = false;
  previewAudio?.destroy();
  previewAudio = null;
});

// 滑动/点击切换音色后自动播放对应试听
watch(selectedIndex, (index) => {
  playPreview(index);
});

// 轮播 5 槽位 x/y 取设计稿：940:59(-29,517)/940:102(57,498)/940:72(247,497)/940:22(333,517)
const slotStyles = [
  { x: -29, y: 517, scale: 1, opacity: 0.92 },
  { x: 57, y: 498, scale: 1, opacity: 1 },
  { x: 153, y: 485, scale: 1, opacity: 1 },
  { x: 247, y: 498, scale: 1, opacity: 1 },
  { x: 333, y: 517, scale: 1, opacity: 0.92 },
];

const visibleVoices = computed(() => {
  return slotStyles.map((style, slot) => {
    const relative = slot - 2;
    const index = (selectedIndex.value + relative + REPORT_VOICE_OPTIONS.length) % REPORT_VOICE_OPTIONS.length;
    return { ...style, voice: REPORT_VOICE_OPTIONS[index], index };
  });
});

function selectVoice(index: number) {
  selectedIndex.value = index;
  dragDeltaX.value = 0;
}

/** PC 端专用：尖括号点击切换音色，绕回（环型）轮播。复用 endDrag 的 wrap 行为。 */
function stepVoice(step: number) {
  const total = REPORT_VOICE_OPTIONS.length;
  if (total < 2) return;
  selectedIndex.value = (selectedIndex.value + step + total) % total;
  dragDeltaX.value = 0;
}

function startDrag(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch) return;
  dragging.value = true;
  dragStartX.value = touch.clientX;
  dragDeltaX.value = 0;
}

function moveDrag(event: TouchEvent) {
  if (!dragging.value) return;
  const touch = event.touches[0];
  if (!touch) return;
  dragDeltaX.value = touch.clientX - dragStartX.value;
}

function endDrag() {
  if (!dragging.value) return;
  if (Math.abs(dragDeltaX.value) >= 30) {
    const direction = dragDeltaX.value < 0 ? 1 : -1;
    selectedIndex.value = (selectedIndex.value + direction + REPORT_VOICE_OPTIONS.length) % REPORT_VOICE_OPTIONS.length;
  }
  dragging.value = false;
  dragDeltaX.value = 0;
}

// 下一步只进入风格选择；确认前不持久化，用户退出后仍会回到完整配置流程。
function confirmVoice() {
  const voice = selectedVoice.value;
  if (!voice) return;
  confirmedVoiceCode.value = voice.id;
  stopPreview();
  step.value = "style";
}

// 选择风格完成：风格由子组件保存，音色在此时提交，二者共同构成有效的报告配置。
function onStyleConfirm(style: ListenBroadcastStyle, moduleCodes: string[]) {
  const voice = selectedVoice.value;
  if (!voice) return;
  saveReportVoice(voice);
  emit("confirm", voice, style, moduleCodes);
}

// 风格页点关闭：退回到音色选择步骤（不离开，不改状态）
function onStyleBack() {
  step.value = "voice";
}

function closeSelector() {
  stopPreview();
  emit("close");
}
</script>

<template>
  <view class="report-voice-selector">
    <ReportStyleSelector
      v-if="step === 'style'"
      :voice-code="confirmedVoiceCode"
      @confirm="onStyleConfirm"
      @close="onStyleBack"
    />
    <template v-else>
      <!-- ② 顶部导航 Top Nav(309:2082)：关闭 + 工作胶囊 + Home -->
      <view class="report-voice-selector__topbar">
        <view class="report-voice-selector__close" @tap="closeSelector">
          <image class="report-voice-selector__close-icon" :src="closeIcon" mode="aspectFit" />
        </view>
        <!-- 工作胶囊：设计稿 309:2085（hug×36，r18，白 90%，22×22 图标 + 14px 文案，间距 6） -->
        <view class="report-voice-selector__working">
          <view class="report-voice-selector__working-inner">
            <image
              class="report-voice-selector__working-icon"
              :src="headerStatusLogo"
              mode="aspectFit"
            />
            <text class="report-voice-selector__working-text">
              {{ t("report-waiting-select") }}
            </text>
          </view>
        </view>
        <view v-if="canMinimize" class="report-voice-selector__minimize" @tap="onMinimize">
          <image class="report-voice-selector__minimize-icon" :src="minimizeIcon" mode="aspectFit" />
        </view>
        <view v-else class="report-voice-selector__home-placeholder" />
      </view>

      <!-- ③ 页面标题(309:2113) -->
      <text class="report-voice-selector__title">
        {{ t("report-voice-title") }}
      </text>

      <!-- ④ 主视觉区(309:2101)：人物 + 左右声波(309:2117 / 309:2155) -->
      <!--
        PC 端把左右声波直接替换成可点击的尖括号（点哪个就把轮播往对应方向挪一格）；
        APP / 移动端保持原声波装饰（拖动切音色、点中间头像也切）。两种视图占位一致，
        切换时不会让标题/轮播区被顶得上下抖动。
      -->
      <view class="report-voice-selector__hero">
        <view
          v-if="isPc"
          class="report-voice-selector__side-arrow report-voice-selector__side-arrow--prev"
          @tap.stop="stepVoice(-1)"
        >
          <image class="report-voice-selector__side-arrow-icon" :src="arrowLeftIcon" mode="aspectFit" />
        </view>
        <view v-else class="report-voice-selector__wave report-voice-selector__wave--left" aria-hidden="true">
          <ReportWaveform :bars="leftWaveBars" :gradient="waveGradient" :box-width="70" :box-height="70" :bar-width="2" :spacing="4" :origin-x="3" :active="isPlaying" />
        </view>
        <image class="report-voice-selector__hero-image" :src="selectedVoice.hero" mode="aspectFit" />
        <view
          v-if="isPc"
          class="report-voice-selector__side-arrow report-voice-selector__side-arrow--next"
          @tap.stop="stepVoice(1)"
        >
          <image class="report-voice-selector__side-arrow-icon" :src="arrowRightIcon" mode="aspectFit" />
        </view>
        <view v-else class="report-voice-selector__wave report-voice-selector__wave--right" aria-hidden="true">
          <ReportWaveform :bars="rightWaveBars" :gradient="waveGradient" :box-width="70" :box-height="70" :bar-width="2" :spacing="4" :origin-x="3" :active="isPlaying" />
        </view>
      </view>

      <!-- ⑤ 性格信息：名称(309:2150) + 说明(309:2115) -->
      <text class="report-voice-selector__name">
        {{ selectedVoice.name }}
      </text>
      <text class="report-voice-selector__description">
        {{ selectedVoice.description }}
      </text>

      <!-- ⑥ 轮播区：轨道弧线(309:2048) + 5 槽位 -->
      <view
        class="report-voice-selector__carousel"
        @touchstart="startDrag"
        @touchmove="moveDrag"
        @touchend="endDrag"
        @touchcancel="endDrag"
      >
        <image class="report-voice-selector__track" src="@/assets/img/voice-assistant/voice-assistant-track.png" mode="scaleToFill" />
        <view
          v-for="item in visibleVoices"
          :key="item.voice.id"
          class="report-voice-selector__item"
          :class="{ 'report-voice-selector__item--selected': item.index === selectedIndex }"
          :style="`--slot-x: ${item.x * 2}; --slot-y: ${(item.y - 481) * 2}; --drag-x: ${dragDeltaX * 0.12}; opacity: ${item.opacity}`"
          @tap.stop="selectVoice(item.index)"
        >
          <!-- 选中项外层椭圆(309:2058)：浅蓝渐变 + 紫蓝渐变描边；非选中为空 -->
          <view v-if="item.index === selectedIndex" class="report-voice-selector__selected-halo" />
          <!-- 头像容器(940:67/102 等)：椭圆头像 -->
          <view class="report-voice-selector__avatar-wrap">
            <image class="report-voice-selector__avatar" :src="item.voice.avatar" mode="aspectFill" />
          </view>
          <!-- 音色标签(309:2104 / 309:2041 等) -->
          <text class="report-voice-selector__tag">
            {{ item.voice.tag }}
          </text>
        </view>
      </view>

      <!-- ⑩ 轮播指示点：PC 与移动端都展示；移动端再在下方补一行「可滑动切换」文字提示 -->
      <view
        class="report-voice-selector__dots"
        :class="{ 'report-voice-selector__dots--mobile': !isPc }"
        aria-hidden="true"
      >
        <view
          v-for="(voice, index) in REPORT_VOICE_OPTIONS"
          :key="voice.id"
          class="report-voice-selector__dot"
          :class="{ 'report-voice-selector__dot--active': index === selectedIndex }"
        />
      </view>
      <text v-if="!isPc" class="report-voice-selector__hint">
        {{ t("report-voice-swipe-hint") }}
      </text>

      <!-- ⑪ CTA 按钮(309:2076) -->
      <view class="report-voice-selector__button" @tap="confirmVoice">
        <text>{{ t("report-voice-next") }}</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
/* 根容器：普通文档流（非 fixed 覆盖层），由外层 podcast-page flex 撑满；
   relative 仅为内部 absolute 子元素提供定位参照。顶部安全区由外层 statusbar 占位统一负责 */
.report-voice-selector {
  --vs-avail: calc(100vh - var(--safe-top-px, 0px));
  --vs-bottom: max(var(--safe-bottom-px, 0px), 48px);
  --vs-gap-floor: 0.3;
  --vs-region-floor: 0.45;
  --vs-gaps: clamp(
    calc(281rpx * var(--vs-gap-floor)),
    calc(var(--vs-avail) - 424rpx - 16rpx - 720rpx - var(--vs-bottom)),
    281rpx
  );
  --vs-gap-u: calc(var(--vs-gaps) / 281);
  --vs-region-budget: calc(
    var(--vs-avail) - 424rpx - 16rpx - calc(281rpx * var(--vs-gap-floor)) - var(--vs-bottom)
  );
  --vs-hero-size: clamp(
    calc(420rpx * var(--vs-region-floor)),
    calc(var(--vs-region-budget) * 0.583333),
    420rpx
  );
  --vs-car-size: clamp(
    calc(300rpx * var(--vs-region-floor)),
    calc(var(--vs-region-budget) * 0.416667),
    300rpx
  );
  --vs-hero-u: calc(var(--vs-hero-size) / 420);
  --vs-car-u: calc(var(--vs-car-size) / 300);
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  color: #0d0d0d;
  background: #fff;
}

@supports (height: 100dvh) {
  .report-voice-selector {
    --vs-avail: calc(100dvh - var(--safe-top-px, 0px));
  }
}

/* —— ② 顶部导航 Top Nav(309:2082) 高 50px=100rpx，左右内边距 20px=40rpx，flex 两端对齐 —— */
.report-voice-selector__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  width: 100%;
  height: 100rpx;
  padding: 0 40rpx;
  flex-shrink: 0;
}

.report-voice-selector__close,
.report-voice-selector__home-placeholder,
.report-voice-selector__minimize {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
}

/* 最小化图标：与关闭按钮同尺寸容器，图标本体略小以贴合视觉重心 */
.report-voice-selector__minimize-icon {
  display: block;
  width: 40rpx;
  height: 40rpx;
}

/* 关闭 × ：设计稿 1024:12 为 24×24px=48×48rpx 矢量叉（灰 #999），用 SVG 图承载 */
.report-voice-selector__close-icon {
  display: block;
  width: 48rpx;
  height: 48rpx;
}

/* 工作胶囊(309:2085)：hug×36px，内边距 12px，圆角 18px，填充 #FFFFFF 90%，
   投影 0 2px 8px rgba(13,13,13,0.09)，无背景模糊；子项间距 6px */
.report-voice-selector__working {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx;
  padding: 0 24rpx;
  border-radius: 36rpx;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 4rpx 16rpx rgb(13 13 13 / 9%);
}

.report-voice-selector__working-inner {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

/* 胶囊图标(309:2087)：22×22px=44×44rpx */
.report-voice-selector__working-icon {
  display: block;
  width: 44rpx;
  height: 44rpx;
  flex: 0 0 44rpx;
}

/* 胶囊文字(309:2086)：14px=28rpx Regular，色 #0D0D0D */
.report-voice-selector__working-text {
  color: #0d0d0d;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
}

/* —— ③ 页面标题(309:2113)：18px=36rpx Bold，色 #0D0D0D，行高约 26px=52rpx，
   与导航底间距 19px=38rpx —— */
.report-voice-selector__title {
  display: block;
  width: 100%;
  margin-top: calc(38 * var(--vs-gap-u));
  color: #0d0d0d;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 52rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ④ 主视觉区(309:2101)：210×210px，与标题底间距 26px=52rpx —— */
.report-voice-selector__hero {
  position: relative;
  width: var(--vs-hero-size);
  height: var(--vs-hero-size);
  margin-top: calc(52 * var(--vs-gap-u));
  flex-shrink: 0;
}

.report-voice-selector__hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: auto;
}

/* 左右声波(940:3 / 940:110)：70×70px=140×140rpx，垂直居中于人物中部 */
.report-voice-selector__wave {
  position: absolute;
  top: calc(156 * var(--vs-hero-u));
  width: calc(140 * var(--vs-hero-u));
  height: calc(140 * var(--vs-hero-u));
}

.report-voice-selector__wave--left { left: calc(-88 * var(--vs-hero-u)); }
.report-voice-selector__wave--right { right: calc(-110 * var(--vs-hero-u)); }

// PC 端专用：占位与声波同位（左/右 + 同一 top / size 系数），整体布局不抖；
// 内部画一个比声波略小的圆形按钮承载尖括号。
.report-voice-selector__side-arrow {
  position: absolute;
  top: calc(156 * var(--vs-hero-u));
  z-index: 6;
  display: flex;
  width: calc(120 * var(--vs-hero-u));
  height: calc(120 * var(--vs-hero-u));
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(200, 120, 120, 0.22);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 4rpx 16rpx rgb(0 0 0 / 8%);
}

.report-voice-selector__side-arrow--prev { left: calc(-150 * var(--vs-hero-u)); }
.report-voice-selector__side-arrow--next { right: calc(-180 * var(--vs-hero-u)); }

.report-voice-selector__side-arrow-icon {
  width: 60%;
  height: 60%;
}

.report-voice-selector__wave .report-waveform {
  width: calc(140 * var(--vs-hero-u)) !important;
  height: calc(140 * var(--vs-hero-u)) !important;
}

/* —— ⑤ 性格信息：与主视觉底间距 25px=50rpx —— */
.report-voice-selector__name,
.report-voice-selector__description {
  display: block;
  width: 100%;
  text-align: center;
  flex-shrink: 0;
}

/* 名称(309:2150)：18px=36rpx Medium，色 #0D0D0D，与主视觉底间距 17px=34rpx */
.report-voice-selector__name {
  margin-top: calc(34 * var(--vs-gap-u));
  color: #0d0d0d;
  font-size: 36rpx;
  font-weight: 500;
  line-height: 52rpx;
}

/* 说明(309:2115)：14px=28rpx Regular，色 #8F8F8F，与名称间距 0 */
.report-voice-selector__description {
  margin-top: 0;
  color: #8f8f8f;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
}

/* —— ⑥ 轮播区：轨道弧线(309:2048) 327×72px，与说明底间距 41px=82rpx —— */
.report-voice-selector__carousel {
  position: relative;
  width: calc(750 * var(--vs-car-u));
  height: var(--vs-car-size);
  margin-top: calc(82 * var(--vs-gap-u));
  flex-shrink: 0;
  touch-action: pan-y;
}

/* 轨道弧线(309:2048)：固定描边投影，几何随轮播区域统一缩放 */
.report-voice-selector__track {
  position: absolute;
  top: 0;
  left: calc(48 * var(--vs-car-u));
  width: calc(654 * var(--vs-car-u));
  height: calc(144 * var(--vs-car-u));
  filter: drop-shadow(0 4px 4px rgb(183 20 20 / 25%));
}

/* 轮播槽位：仅轮播内部用绝对定位摆出 5 个弧线槽位 */
.report-voice-selector__item {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: calc(140 * var(--vs-car-u));
  height: calc(280 * var(--vs-car-u));
  left: calc(var(--slot-x) * var(--vs-car-u));
  top: calc(var(--slot-y) * var(--vs-car-u));
  transform: translateX(calc(var(--drag-x) * var(--vs-car-u)));
  transform-origin: center bottom;
  transition: left 180ms ease, top 180ms ease, transform 180ms ease, opacity 180ms ease;
}

.report-voice-selector__item--selected {
  z-index: 5;
}

/* 选中外层椭圆(309:2058)：90×114px=180×228rpx
   填充 180° 渐变 #F3F7FF → #E2EAFF；描边 1px=2rpx 渐变 #EBB4E9 → #56ABFA(48.72%) → #9795E8 */
.report-voice-selector__selected-halo {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 0;
  box-sizing: border-box;
  width: calc(180 * var(--vs-car-u));
  height: calc(228 * var(--vs-car-u));
  background: linear-gradient(180deg, #f3f7ff 0%, #e2eaff 100%);
  border-radius: 50%;
  transform: translateX(-50%);
}

/* 渐变描边环：渐变无法直接作用于 border，用 mask 挖空中间只留 2rpx 的环 */
.report-voice-selector__selected-halo::after {
  position: absolute;
  inset: 0;
  padding: 2rpx;
  border-radius: 50%;
  background: linear-gradient(90deg, #ebb4e9 0%, #56abfa 48.72%, #9795e8 100%);
  content: "";
  pointer-events: none;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
}

/* 头像容器：普通槽位 70×92px=140×184rpx，椭圆，底 #F4F4F4 描边 #EAEAEA */
.report-voice-selector__avatar-wrap {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: calc(140 * var(--vs-car-u));
  height: calc(184 * var(--vs-car-u));
  padding: calc(6 * var(--vs-car-u));
  overflow: hidden;
  border: 1px solid #eaeaea;
  border-radius: 50%;
  background: #f4f4f4;
}

/* 选中头像(309:2038)：保持原头像资源与几何，外层露出 #F3F7FF→#E2EAFF 渐变 */
.report-voice-selector__item--selected .report-voice-selector__avatar-wrap {
  position: absolute;
  top: calc(20 * var(--vs-car-u));
  left: 50%;
  width: calc(140 * var(--vs-car-u));
  height: calc(182 * var(--vs-car-u));
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  transform: translateX(-50%);
}

.report-voice-selector__avatar {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

/* 音色标签(309:2041 等)：14px=28rpx Regular，色 #8F8F8F */
.report-voice-selector__tag {
  display: block;
  margin-top: calc(16 * var(--vs-car-u));
  color: #8f8f8f;
  font-size: calc(28 * var(--vs-car-u));
  font-weight: 400;
  line-height: calc(34 * var(--vs-car-u));
  white-space: nowrap;
}

/* 选中标签(309:2104)：14px Medium，色 #0D0D0D，设计稿 y=609 → 相对槽位顶 248rpx */
.report-voice-selector__item--selected .report-voice-selector__tag {
  position: absolute;
  top: calc(248 * var(--vs-car-u));
  left: 50%;
  margin-top: 0;
  color: #0d0d0d;
  font-weight: 500;
  transform: translateX(-50%);
}

/* —— ⑦ 移动端「可滑动切换」文字提示(309:2075)：12px=24rpx Regular，色 #8E8E8E ——
   上方多了指示点后，这里只留点与文字之间的小间距，整体高度与原设计持平 */
.report-voice-selector__hint {
  display: block;
  width: 100%;
  margin-top: calc(10 * var(--vs-gap-u));
  color: #8e8e8e;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ⑧ PC 端轮播指示点(309:2050/2051/2112)：6×6px=12×12rpx，
   选中 #0D0D0D，未选中 #D0D0D0 29.78% —— */
.report-voice-selector__dots {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-top: calc(28 * var(--vs-gap-u));
  flex-shrink: 0;
}

/* 移动端：指示点紧贴轮播下方，16px + 点高 6px + 提示 10px ≈ 原提示间距 33px */
.report-voice-selector__dots--mobile {
  margin-top: calc(16 * var(--vs-gap-u));
}

.report-voice-selector__dot {
  width: 12rpx;
  height: 12rpx;
  margin: 0 6rpx;
  border-radius: 50%;
  background: rgb(208 208 208 / 29.78%);
  transition: background 0.2s ease;
}

.report-voice-selector__dot--active {
  background: #0d0d0d;
}

/* —— ⑨ CTA 按钮(309:2076)：295×50px=590×100rpx，圆角 30px=60rpx，
   白底 + 1px rgba(13,13,13,0.05) 描边，投影 0 2px 8px rgba(0,0,0,0.04)，
   文案 Inter Regular 16px=32rpx / #0D0D0D，与提示间距 28px=56rpx —— */
.report-voice-selector__button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 590rpx;
  height: 100rpx;
  margin-top: calc(56 * var(--vs-gap-u));
  color: #0d0d0d;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 32rpx;
  font-weight: 400;
  line-height: 38rpx;
  background: #fff;
  border: 2rpx solid rgb(13 13 13 / 5%);
  border-radius: 60rpx;
  box-shadow: 0 4rpx 16rpx rgb(0 0 0 / 4%);
  flex-shrink: 0;
  /* 底部安全区：改由按钮自身承担。优先用真实 inset；安卓 WebView 读不到时为 0，
     兜底 48px（96rpx）避免贴底的「下一步」被系统导航栏/手势条遮挡。 */
  margin-bottom: max(var(--safe-bottom-px, 0px), 48px);
}
</style>

<script setup lang="ts">
import type { ReportVoiceOption } from "@/config/report-voices";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import microphoneBadge from "@/assets/img/voice-assistant/report-microphone-badge.png";
import smallWave from "@/assets/img/voice-assistant/report-small-wave.png";
import ReportWaveform from "@/components/report-waveform/index.vue";
import { REPORT_VOICE_OPTIONS, REPORT_VOICE_STORAGE_KEY } from "@/config/report-voices";
import { useSafeArea } from "@/hooks/useSafeArea";

const emit = defineEmits<{
  confirm: [voice: ReportVoiceOption];
  close: [];
}>();

// 顶部状态栏安全区（宿主注入 > uni 信息 > CSS 环境变量 > 平台兜底），以 CSS 变量 --safe-top-px 暴露
const { safeAreaStyle } = useSafeArea();

// 设计稿 940:3 左声波 17 根柱高（px）
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
// 设计稿 940:110 右声波 17 根柱高（px）
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];

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

function confirmVoice() {
  const voice = selectedVoice.value;
  if (!voice) return;
  uni.setStorageSync(REPORT_VOICE_STORAGE_KEY, voice.id);
  emit("confirm", voice);
}
</script>

<template>
  <view class="report-voice-selector" :style="safeAreaStyle">
    <!-- ② 顶部导航 Top Nav(1024:1)：关闭 + 工作胶囊 + Home -->
    <view class="report-voice-selector__topbar">
      <view class="report-voice-selector__close" @tap="emit('close')">
        <text class="report-voice-selector__close-icon">
          ×
        </text>
      </view>
      <view class="report-voice-selector__working">
        <view class="report-voice-selector__working-inner">
          <text class="report-voice-selector__dot" />
          <text class="report-voice-selector__dot" />
          <text class="report-voice-selector__working-text">
            Noii 等你选..
          </text>
        </view>
      </view>
      <view class="report-voice-selector__home-placeholder" />
    </view>

    <!-- ③ 页面标题(940:79) -->
    <text class="report-voice-selector__title">
      快来选择你的汇报助手吧
    </text>

    <!-- ④ 主视觉区(940:56 群组)：人物 + 左右声波 -->
    <view class="report-voice-selector__hero">
      <view class="report-voice-selector__wave report-voice-selector__wave--left" aria-hidden="true">
        <ReportWaveform :bars="leftWaveBars" :box-width="70" :box-height="70" :bar-width="2" :spacing="4" :origin-x="3" :active="isPlaying" />
      </view>
      <image class="report-voice-selector__hero-image" :src="selectedVoice.hero" mode="aspectFit" />
      <view class="report-voice-selector__wave report-voice-selector__wave--right" aria-hidden="true">
        <ReportWaveform :bars="rightWaveBars" :box-width="70" :box-height="70" :bar-width="2" :spacing="4" :origin-x="3" :active="isPlaying" />
      </view>
    </view>

    <!-- ⑤ 性格信息：名称(940:78) + 说明(940:107) -->
    <text class="report-voice-selector__name">
      {{ selectedVoice.name }}
    </text>
    <text class="report-voice-selector__description">
      {{ selectedVoice.description }}
    </text>

    <!-- ⑥ 正在播报胶囊(940:52) -->
    <view class="report-voice-selector__broadcast">
      <image class="report-voice-selector__broadcast-wave" :src="smallWave" mode="scaleToFill" />
      <text>正在播报</text>
    </view>

    <!-- ⑦ 轮播区：轨道弧线(940:48) + 5 槽位 -->
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
        :style="{
          left: `${item.x * 2}rpx`,
          top: `${(item.y - 481) * 2}rpx`,
          opacity: item.opacity,
          transform: `translateX(${dragDeltaX * 0.12}rpx)`,
        }"
        @tap.stop="selectVoice(item.index)"
      >
        <!-- 选中项外层椭圆(940:27)：粉渐变 + 红描边；非选中为空 -->
        <view v-if="item.index === selectedIndex" class="report-voice-selector__selected-halo" />
        <!-- 头像容器(940:67/102 等)：椭圆头像 -->
        <view class="report-voice-selector__avatar-wrap">
          <image class="report-voice-selector__avatar" :src="item.voice.avatar" mode="aspectFill" />
        </view>
        <!-- 选中麦克风徽标(940:28) -->
        <image v-if="item.index === selectedIndex" class="report-voice-selector__mic" :src="microphoneBadge" mode="scaleToFill" />
        <!-- 音色标签(940:83 等) -->
        <text class="report-voice-selector__tag">
          {{ item.voice.tag }}
        </text>
      </view>
    </view>

    <!-- ⑨ 分页圆点(940:45/46/64) -->
    <view class="report-voice-selector__dots">
      <text v-for="index in 3" :key="`dot-${index}`" class="report-voice-selector__page-dot" :class="{ 'report-voice-selector__page-dot--active': index === 2 }" />
    </view>
    <!-- ⑩ 可滑动切换(940:31) -->
    <text class="report-voice-selector__hint">
      可滑动切换
    </text>

    <!-- ⑪ CTA 按钮(940:108) -->
    <view class="report-voice-selector__button" @tap="confirmVoice">
      <text>下一步</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 根容器：整屏、白底、flex 纵向流，内容居中（页面级不再用 absolute） */
.report-voice-selector {
  position: fixed;
  inset: 0;
  z-index: 1000;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  height: 100%;
  padding-top: var(--safe-top-px, 0px);
  overflow: hidden;
  color: #1a1a1a;
  background: #fff;
}

/* —— ② 顶部导航 Top Nav(1024:1) 高 54px=108rpx，flex 两端对齐 —— */
.report-voice-selector__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  width: 100%;
  height: 108rpx;
  padding: 0 40rpx;
  flex-shrink: 0;
}

.report-voice-selector__close,
.report-voice-selector__home-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
}

/* 关闭 × ：设计稿 1024:12 为 24×24px=48×48rpx 矢量叉（灰 #999） */
.report-voice-selector__close-icon {
  color: #999;
  font-size: 44rpx;
  font-weight: 300;
  line-height: 48rpx;
}

/* 工作胶囊(1024:2)：外层渐变描边(2rpx)，内层纯白实底。设计稿 1024:2 为纯白底 + 1.5px 渐变描边。
   box-shadow(px)：0 2px 8px rgba(0,0,0,0.08) */
.report-voice-selector__working {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx;
  padding: 2rpx;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #ff6b6b 0%, #c8201e 15%, #ffd6d1 40%, #ffd6d1 100%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

/* 内层：纯白实底，透明处露出外层渐变作为描边 */
.report-voice-selector__working-inner {
  display: flex;
  align-items: center;
  gap: 12rpx;
  box-sizing: border-box;
  height: 100%;
  padding: 0 28rpx;
  border-radius: 34rpx;
  background: #fff;
}

/* 胶囊脉冲点(1024:5/4)：6px→12rpx，红 #C8201E */
.report-voice-selector__dot {
  width: 12rpx;
  height: 12rpx;
  background: #c8201e;
  border-radius: 50%;
}

/* 胶囊文字(1024:3)：Inter Medium 13px=26rpx，颜色 #1A1A1A */
.report-voice-selector__working-text {
  color: #1a1a1a;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 32rpx;
}

/* —— ③ 页面标题(940:79)：Inter SemiBold 17px=34rpx，与导航底间距 19px=38rpx —— */
.report-voice-selector__title {
  display: block;
  width: 100%;
  margin-top: 38rpx;
  color: #1a1a1a;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 42rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ④ 主视觉区(940:56 群组)：人物半身大图，与标题底间距 31px=62rpx —— */
.report-voice-selector__hero {
  position: relative;
  width: 420rpx;
  height: 420rpx;
  margin-top: 62rpx;
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
  top: 156rpx;
  width: 140rpx;
  height: 140rpx;
}

.report-voice-selector__wave--left { left: -88rpx; }
.report-voice-selector__wave--right { right: -110rpx; }

.report-voice-selector__wave .report-waveform {
  width: 140rpx;
  height: 140rpx;
}

/* —— ⑤ 性格信息：与主视觉底间距 25px=50rpx —— */
.report-voice-selector__name,
.report-voice-selector__description {
  display: block;
  width: 100%;
  text-align: center;
  flex-shrink: 0;
}

/* 名称(940:78)：Inter SemiBold 17px=34rpx，色 #9A5F5D */
.report-voice-selector__name {
  margin-top: 50rpx;
  color: #9a5f5d;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 48rpx;
}

/* 说明(940:107)：Inter Regular 14px=28rpx，色 #B88F8D，与名称间距 2px=4rpx */
.report-voice-selector__description {
  margin-top: 4rpx;
  color: #b88f8d;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
}

/* —— ⑥ 正在播报胶囊(940:52)：82×22px=164×44rpx，圆角11px，底 #FFEDED，与说明间距 6px=12rpx —— */
.report-voice-selector__broadcast {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  box-sizing: border-box;
  height: 44rpx;
  margin-top: 12rpx;
  padding: 0 22rpx;
  color: #c8201e;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 28rpx;
  background: #ffeded;
  border-radius: 22rpx;
  flex-shrink: 0;
}

/* 胶囊小声波(940:53)：12×12px=24×24rpx */
.report-voice-selector__broadcast-wave {
  display: block;
  width: 24rpx;
  height: 24rpx;
}

/* —— ⑦ 轮播区：轨道弧线(940:48) 高 72px=144rpx，与胶囊底间距 13px=26rpx —— */
.report-voice-selector__carousel {
  position: relative;
  width: 100%;
  height: 300rpx;
  margin-top: 34rpx;
  flex-shrink: 0;
  touch-action: pan-y;
}

/* 轨道弧线(940:48)：327×72px → 宽 calc(100%-96rpx)，高 144rpx
   box-shadow(px)：0 4px 4px rgba(183,20,20,0.25) */
.report-voice-selector__track {
  position: absolute;
  top: 0;
  left: 48rpx;
  width: calc(100% - 96rpx);
  height: 144rpx;
  filter: drop-shadow(0 4px 4px rgb(183 20 20 / 25%));
}

/* 轮播槽位：仅轮播内部用绝对定位摆出 5 个弧线槽位 */
.report-voice-selector__item {
  position: absolute;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 140rpx;
  height: 280rpx;
  transform-origin: center bottom;
  transition: left 180ms ease, top 180ms ease, transform 180ms ease, opacity 180ms ease;
}

.report-voice-selector__item--selected {
  z-index: 5;
}

/* 选中外层椭圆(940:27)：90×114px=180×228rpx，粉渐变 + 红描边 #C8201E */
.report-voice-selector__selected-halo {
  position: absolute;
  top: 0;
  left: 50%;
  z-index: 0;
  box-sizing: border-box;
  width: 180rpx;
  height: 228rpx;
  background: linear-gradient(180deg, #f5eaea 0%, #f2fbff 100%);
  border: 1px solid #c8201e;
  border-radius: 50%;
  transform: translateX(-50%);
}

/* 头像容器：普通槽位 70×92px=140×184rpx，椭圆，底 #F4F4F4 描边 #EAEAEA */
.report-voice-selector__avatar-wrap {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: 140rpx;
  height: 184rpx;
  padding: 6rpx;
  overflow: hidden;
  border: 1px solid #eaeaea;
  border-radius: 50%;
  background: #f4f4f4;
}

/* 选中头像(940:67)：缩到椭圆内且明显小于外层渐变，四周露出粉渐变 */
.report-voice-selector__item--selected .report-voice-selector__avatar-wrap {
  position: absolute;
  top: 20rpx;
  left: 50%;
  width: 140rpx;
  height: 182rpx;
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

/* 选中麦克风徽标(940:28)：24×24px=48×48rpx，设计稿 y=581 → 相对槽位顶 192rpx */
.report-voice-selector__mic {
  position: absolute;
  top: 192rpx;
  left: 50%;
  z-index: 4;
  width: 48rpx;
  height: 48rpx;
  transform: translateX(-50%);
}

/* 音色标签(940:71 等)：Inter Regular 13px=26rpx，色 #B78E8C */
.report-voice-selector__tag {
  display: block;
  margin-top: 16rpx;
  color: #b78e8c;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 32rpx;
  white-space: nowrap;
}

/* 选中标签(940:83)：Inter SemiBold 13px=26rpx，色 #96605C，设计稿 y=609 → 相对槽位顶 248rpx */
.report-voice-selector__item--selected .report-voice-selector__tag {
  position: absolute;
  top: 248rpx;
  left: 50%;
  margin-top: 0;
  color: #96605c;
  font-weight: 600;
  transform: translateX(-50%);
}

/* —— ⑨ 分页圆点(940:45/46/64)：6×6px=12×12rpx，间距7px=14rpx —— */
.report-voice-selector__dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14rpx;
  width: 100%;
  height: 24rpx;
  margin-top: 47rpx;
  flex-shrink: 0;
}

.report-voice-selector__page-dot {
  width: 12rpx;
  height: 12rpx;
  background: rgb(219 20 20 / 14.4%);
  border-radius: 50%;
}

.report-voice-selector__page-dot--active {
  background: #c8201e;
}

/* —— ⑩ 可滑动切换(940:31)：Inter Regular 12px=24rpx，色 #B5B5B5，与圆点间距 16px=33rpx —— */
.report-voice-selector__hint {
  display: block;
  width: 100%;
  margin-top: 33rpx;
  color: #b5b5b5;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  text-align: center;
  flex-shrink: 0;
}

/* —— ⑪ CTA 按钮(940:108)：319×56px=638×112rpx，圆角28px，白底
   box-shadow(px)：0 -2px 21px rgba(0,0,0,0.061) —— */
.report-voice-selector__button {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 638rpx;
  height: 112rpx;
  margin-top: 48rpx;
  color: #c8201e;
  font-size: 34rpx;
  font-weight: 400;
  line-height: 42rpx;
  background: #fff;
  border-radius: 56rpx;
  box-shadow: 0 -2px 21px rgb(0 0 0 / 6.1%);
  flex-shrink: 0;
}
</style>

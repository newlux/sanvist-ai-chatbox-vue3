<script setup lang="ts">
import type { ListenBroadcastHistoryItem, PlayListenBroadcastParams } from "@/api/listen-broadcast/types";
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from "vue";
import { getListenBroadcastHistory } from "@/api/listen-broadcast";
import aiChatIcon from "@/assets/img/report-broadcast/ai-chat.png";
import feedbackGoodIcon from "@/assets/img/report-broadcast/feedback-good.svg";
import feedbackHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-close.svg";
import ReportWaveform from "@/components/report-waveform/index.vue";
import { useListenBroadcastPlayer } from "@/hooks/useListenBroadcastPlayer";
import { useSafeArea } from "@/hooks/useSafeArea";

const props = defineProps<{
  params: PlayListenBroadcastParams;
  portrait: string;
  dockOffset: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { safeBottomPx } = useSafeArea();

// 设计稿 940:3 / 940:110：左右声波逐柱高度（px）。
const leftWaveBars = [2, 2, 18, 4, 10, 4, 16, 8, 4, 16, 4, 30, 12, 20, 2, 1, 1];
const rightWaveBars = [2, 2, 18, 10, 18, 4, 8, 8, 10, 2, 4, 8, 22, 6, 2, 1, 1];

const {
  play,
  stop,
  loading,
  playing,
  currentSeq,
  nextText,
  transcriptSegments,
  error,
} = useListenBroadcastPlayer();

const statusText = computed(() => {
  if (loading.value) return "准备中...";
  if (playing.value) return "播报中...";
  if (error.value) return "播报失败";
  return "播报完成";
});

interface TranscriptItem {
  key: string;
  role: "previous" | "current" | "next";
  text: string;
}

const transcriptItems = computed<TranscriptItem[]>(() => {
  const segments = transcriptSegments.value.map(segment => ({
    key: `segment-${segment.seq}`,
    role: (segment.seq === currentSeq.value ? "current" : segment.seq < (currentSeq.value ?? Infinity) ? "previous" : "next") as TranscriptItem["role"],
    text: segment.text,
  }));
  if (nextText.value && currentSeq.value !== null && !segments.some(item => item.key === `segment-${currentSeq.value + 1}`)) {
    segments.push({ key: `segment-${currentSeq.value + 1}`, role: "next" as const, text: nextText.value });
  }
  return segments;
});

const showTranscriptSkeleton = computed(() => loading.value && transcriptSegments.value.length === 0);
const transcriptScrollTop = ref(0);
const instance = getCurrentInstance();
const showHistory = ref(false);
const historyLoading = ref(false);
const historyItems = ref<ListenBroadcastHistoryItem[]>([]);
const activeHistoryBizDate = ref("");

function updateTranscriptScroll() {
  if (!playing.value || currentSeq.value === null) return;
  void nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy);
    query.select(".report-broadcast-player__transcript-content").boundingClientRect();
    query.select(`#segment-${currentSeq.value}`).boundingClientRect();
    query.exec((rects) => {
      const viewport = rects?.[0] as UniApp.NodeInfo | undefined;
      const current = rects?.[1] as UniApp.NodeInfo | undefined;
      if (!viewport || !current || typeof viewport.bottom !== "number" || typeof current.bottom !== "number") return;
      const overflow = current.bottom - viewport.bottom;
      if (overflow > 0) transcriptScrollTop.value += Math.ceil(overflow);
    });
  });
}

watch(currentSeq, updateTranscriptScroll);

function close() {
  stop();
  emit("close");
}

async function openHistory() {
  showHistory.value = true;
  if (historyItems.value.length || historyLoading.value) return;
  historyLoading.value = true;
  try {
    historyItems.value = await getListenBroadcastHistory();
  } catch {
    historyItems.value = [];
  } finally {
    historyLoading.value = false;
  }
}

function closeHistory() {
  showHistory.value = false;
}

function playHistory(item: ListenBroadcastHistoryItem) {
  activeHistoryBizDate.value = item.bizDate;
  showHistory.value = false;
  play({
    ...props.params,
    bizDate: item.bizDate,
  });
}

onMounted(() => play(props.params));
</script>

<template>
  <view class="report-broadcast-player" :style="{ height: `calc(100% - ${dockOffset})` }">
    <!-- 设计稿：安全区基准 44px 后，Top Nav 从 y=48px 开始 -->
    <view class="report-broadcast-player__safe-gap" />

    <!-- 设计稿：顶部导航与播报状态 -->
    <view class="report-broadcast-player__header">
      <view class="report-broadcast-player__close" @tap="close">
        <image class="report-broadcast-player__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
      <view class="report-broadcast-player__status">
        <text>{{ statusText }}</text>
      </view>
      <!-- 设计稿 2525:184：右上角 AI 聊天入口 24×24px -->
      <view class="report-broadcast-player__ai-entry" @tap="close">
        <image class="report-broadcast-player__ai-icon" :src="aiChatIcon" mode="aspectFit" />
      </view>
    </view>

    <!-- 设计稿：Top Nav 底部 y=98px → 人物区域顶部 y=115px -->
    <view class="report-broadcast-player__portrait-gap" />

    <!-- 设计稿：人物、左右实时声波与背景光晕 -->
    <view class="report-broadcast-player__portrait-stage">
      <view class="report-broadcast-player__wave report-broadcast-player__wave--left">
        <ReportWaveform :active="playing" :bars="leftWaveBars" />
      </view>
      <!-- 设计稿 2525:122 / 2525:123：人物背景红蓝椭圆光晕 -->
      <view class="report-broadcast-player__glow report-broadcast-player__glow--blue" />
      <view class="report-broadcast-player__glow report-broadcast-player__glow--red" />
      <view class="report-broadcast-player__portrait-wrap">
        <image class="report-broadcast-player__portrait" :src="portrait" mode="aspectFit" />
      </view>
      <view class="report-broadcast-player__wave report-broadcast-player__wave--right">
        <ReportWaveform :active="playing" :bars="rightWaveBars" />
      </view>
    </view>

    <!-- 设计稿 2525:114：上一段淡出、当前段强调、下一段淡出 -->
    <view class="report-broadcast-player__transcript">
      <!-- 准备中：用五段文字槽位铺满视口，首个文字分片到达后替换。 -->
      <view v-show="showTranscriptSkeleton" class="report-broadcast-player__skeleton">
        <view v-for="index in 5" :key="index" class="report-broadcast-player__skeleton-segment">
          <view class="report-broadcast-player__skeleton-line" />
          <view class="report-broadcast-player__skeleton-line" />
          <view class="report-broadcast-player__skeleton-line report-broadcast-player__skeleton-line--short" />
        </view>
      </view>
      <scroll-view
        v-show="!showTranscriptSkeleton"
        class="report-broadcast-player__transcript-content"
        scroll-y
        :scroll-top="transcriptScrollTop"
        :scroll-with-animation="playing"
      >
        <view class="report-broadcast-player__transcript-track">
          <text
            v-for="item in transcriptItems"
            :id="item.key"
            :key="item.key"
            class="report-broadcast-player__segment"
            :class="`report-broadcast-player__segment--${item.role}`"
          >
            {{ item.text }}
          </text>
        </view>
      </scroll-view>
      <!-- 文字区底部渐变：淡化滚动文字，避免遮挡反馈操作。 -->
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-player__bottom-fade" />
      <!-- 设计稿 2525:212：点赞与历史操作，24×24px，间距 16px -->
      <view v-if="!showTranscriptSkeleton" class="report-broadcast-player__feedback">
        <image
          class="report-broadcast-player__feedback-icon"
          :src="feedbackHistoryIcon"
          mode="aspectFit"
          @tap="openHistory"
        />
        <image class="report-broadcast-player__feedback-icon" :src="feedbackGoodIcon" mode="aspectFit" />
      </view>
    </view>

    <!-- 设计稿 940:1000 / 940:1001：日报历史播放列表底部弹层 -->
    <view v-if="showHistory" class="report-history">
      <view class="report-history__mask" @tap="closeHistory" />
      <view class="report-history__sheet">
        <!-- 设计稿：标题与关闭按钮 -->
        <view class="report-history__header">
          <text class="report-history__title">
            历史播放列表
          </text>
          <image class="report-history__close" :src="closeIcon" mode="aspectFit" @tap="closeHistory" />
        </view>

        <!-- 设计稿：周期筛选；当前仅实现日报，周报/月报为不可用展示项 -->
        <view class="report-history__tabs">
          <view class="report-history__tab report-history__tab--active">
            <text>日报</text>
          </view>
          <view class="report-history__tab report-history__tab--disabled">
            <text>周报</text>
          </view>
          <view class="report-history__tab report-history__tab--disabled">
            <text>月报</text>
          </view>
        </view>

        <!-- 设计稿：日报历史记录列表 -->
        <scroll-view class="report-history__list" scroll-y>
          <view v-if="historyLoading" class="report-history__empty">
            加载中...
          </view>
          <view v-else-if="!historyItems.length" class="report-history__empty">
            暂无日报
          </view>
          <view
            v-for="(item, index) in historyItems"
            v-else
            :key="item.bizDate"
            class="report-history__item"
            :class="{ 'report-history__item--selected': activeHistoryBizDate ? item.bizDate === activeHistoryBizDate : index === 0 }"
            @tap="playHistory(item)"
          >
            <view class="report-history__item-title-row">
              <text class="report-history__item-title">
                {{ item.title || "经营概览早报" }}
              </text>
              <view v-if="index === 0" class="report-history__new-badge">
                <text>NEW</text>
              </view>
            </view>
            <text class="report-history__item-date">
              {{ item.bizDate }}
            </text>
          </view>
        </scroll-view>

        <!-- 设计稿：底部系统安全区 -->
        <view class="report-history__safe-area" :style="{ height: `${safeBottomPx * 2}rpx` }" />
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-broadcast-player {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #fff;
}

/* 设计稿：安全区 44px → Top Nav y=48px，间距 4px。 */
.report-broadcast-player__safe-gap {
  width: 100%;
  height: 8rpx;
  flex: 0 0 8rpx;
}

/* 设计稿：50px 顶部导航 */
.report-broadcast-player__header {
  display: flex;
  width: 100%;
  height: 100rpx;
  flex: 0 0 100rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 38rpx;
  box-sizing: border-box;
}

/* 设计稿：Top Nav 底部 y=98px → 人物区域顶部 y=115px，间距 17px。 */
.report-broadcast-player__portrait-gap {
  width: 100%;
  height: 34rpx;
  flex: 0 0 34rpx;
}

/* 设计稿 2525:108 / 2525:184：左右导航操作均为 24×24px。 */
.report-broadcast-player__close,
.report-broadcast-player__ai-entry {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
}

.report-broadcast-player__close-icon,
.report-broadcast-player__ai-icon {
  width: 48rpx;
  height: 48rpx;
}

.report-broadcast-player__status {
  display: flex;
  width: 158rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 36rpx;
  background: rgb(255 255 255 / 90%);
  box-shadow: 0 4rpx 16rpx rgb(237 26 26 / 9%);
  color: #1a1a1a;
  font-size: 28rpx;
  font-weight: 500;
  backdrop-filter: blur(32rpx);
}

/* 设计稿：255px 人物与声波区域 */
.report-broadcast-player__portrait-stage {
  position: relative;
  display: flex;
  width: 100%;
  height: 510rpx;
  flex: 0 0 510rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* 设计稿：左右音波保持 70×70px，并与 235px 人物图叠层。 */
.report-broadcast-player__wave {
  position: absolute;
  z-index: 2;
  top: 243.707rpx;
  width: 140rpx;
  height: 140rpx;
}

.report-broadcast-player__wave--left {
  left: 52rpx;
}

.report-broadcast-player__wave--right {
  right: 52rpx;
}

.report-broadcast-player__portrait-wrap {
  position: relative;
  display: flex;
  width: 470rpx;
  height: 470rpx;
  flex: 0 0 470rpx;
  align-items: flex-end;
  justify-content: center;
}

/* 设计稿 2525:122 / 2525:123：人物背后椭圆光晕，blur 46px。 */
.report-broadcast-player__glow {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  filter: blur(92rpx);
}

.report-broadcast-player__glow--blue {
  top: 90rpx;
  left: 86rpx;
  width: 282rpx;
  height: 350rpx;
  background: rgb(229 242 255 / 30%);
}

.report-broadcast-player__glow--red {
  top: 40rpx;
  left: 303.714rpx;
  width: 362.571rpx;
  height: 450rpx;
  background: rgb(255 216 216 / 40%);
}

.report-broadcast-player__portrait {
  position: relative;
  z-index: 1;
  width: 470rpx;
  height: 470rpx;
}

/* 文字滚动区域：左右各 46px，底边止于 AiChatInput 顶部。 */
.report-broadcast-player__transcript {
  position: relative;
  width: 100%;
  height: calc(100% - 652rpx);
  padding: 32rpx 88rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}

/* 固定文字视口：播放完成后可在区域内滚动查看全部内容。 */
.report-broadcast-player__transcript-content {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.report-broadcast-player__transcript-track {
  display: flex;
  width: 100%;
  min-height: 100%;
  padding-bottom: 180rpx;
  box-sizing: border-box;
  flex-direction: column;
  gap: 12rpx;
}

@keyframes report-broadcast-skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.report-broadcast-player__skeleton {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 12rpx;
}

.report-broadcast-player__skeleton-segment {
  display: flex;
  height: 152rpx;
  flex: 0 0 152rpx;
  flex-direction: column;
  gap: 12rpx;
}

.report-broadcast-player__skeleton-line {
  width: 100%;
  height: 24rpx;
  flex: 0 0 24rpx;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f2f3f5 25%, #e5e7eb 50%, #f2f3f5 75%);
  background-size: 200% 100%;
  animation: report-broadcast-skeleton-shimmer 1.4s ease-in-out infinite;
}

.report-broadcast-player__skeleton-line--short {
  width: 68%;
}

.report-broadcast-player__segment {
  display: block;
  width: 100%;
  min-height: 0;
  color: #e0e0e0;
  font-size: 38rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: normal;
  transition: color 220ms ease, font-size 220ms ease, font-weight 220ms ease, opacity 180ms ease;
}

/* 设计稿 2525:115：当前文字 283px 宽，18px/25px，700，#211B1B。 */
.report-broadcast-player__segment--current {
  color: #211b1b;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 50rpx;
}

/* 文字区底部 90px 渐变，避免滚动文字穿过点赞和历史图标。 */
.report-broadcast-player__bottom-fade {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 180rpx;
  pointer-events: none;
  background: linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, rgb(255 255 255 / 86%) 58%, #ffffff 100%);
}

/* 设计稿 2525:212：点赞 x=281px、历史 x=321px，尺寸均为 24px。 */
.report-broadcast-player__feedback {
  position: absolute;
  z-index: 3;
  right: 60rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  bottom: 100rpx;
}

.report-broadcast-player__feedback-icon {
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
}

/* 设计稿 940:1000：历史播放列表页面底部弹层，375×455px。 */
.report-history {
  position: fixed;
  z-index: 10;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

/* 设计稿 940:1027：全屏黑色 40% 遮罩。 */
.report-history__mask {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 40%);
}

/* 设计稿 940:1001：白色底部内容区域，375×455px。 */
.report-history__sheet {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  height: 910rpx;
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
  border-radius: 48rpx 48rpx 0 0;
  background: #fff;
  box-shadow: 0 -8rpx 24rpx rgb(0 0 0 / 8%);
}

/* 设计稿 940:1002 + 940:1023：标题和右上角关闭按钮。 */
.report-history__header {
  display: flex;
  height: 128rpx;
  flex: 0 0 128rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 36rpx 0 52rpx;
  box-sizing: border-box;
}

.report-history__title {
  color: #666;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 36rpx;
  font-weight: 500;
  line-height: 44rpx;
}

.report-history__close {
  width: 60rpx;
  height: 60rpx;
  flex: 0 0 60rpx;
}

/* 设计稿 1004:10 / 1004:11 / 1004:14：日报、周报、月报筛选项。 */
.report-history__tabs {
  display: flex;
  height: 82rpx;
  flex: 0 0 82rpx;
  gap: 12rpx;
  padding: 0 52rpx;
  box-sizing: border-box;
}

.report-history__tab {
  display: flex;
  width: 208rpx;
  height: 82rpx;
  flex: 0 0 208rpx;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 40rpx;
}

.report-history__tab--active {
  background: #191b27;
  box-shadow: 0 6rpx 16rpx rgb(25 27 39 / 20%);
  color: #fff;
  font-weight: 500;
}

.report-history__tab--disabled {
  background: #f4f3f8;
  color: #4f4e56;
}

/* 设计稿 940:1033 / 940:1011 / 940:1028 / 940:1015 / 940:1007：日报历史记录。 */
.report-history__list {
  display: flex;
  width: 694rpx;
  align-self: center;
  height: 656rpx;
  flex: 0 0 656rpx;
  padding-top: 44rpx;
  box-sizing: border-box;
  flex-direction: column;
}

.report-history__item {
  display: flex;
  width: 694rpx;
  height: 128rpx;
  flex: 0 0 128rpx;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: center;
  padding: 0 44rpx;
  gap: 12rpx;
}

.report-history__item--selected {
  border-radius: 24rpx;
  background: #f4f3f8;
}

.report-history__item-title-row {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.report-history__item-title {
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
}

.report-history__new-badge {
  display: flex;
  width: 80rpx;
  height: 34rpx;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 4rpx 14rpx;
  border-radius: 10rpx;
  background: #ffe6e4;
}

.report-history__new-badge text {
  color: #fe0000;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 26rpx;
}

.report-history__item-date {
  color: #999;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
}

.report-history__empty {
  display: flex;
  width: 694rpx;
  height: 128rpx;
  flex: 0 0 128rpx;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 24rpx;
}

/* 设计稿 940:1021 / 940:1022：高度由真实设备的底部安全区决定。 */
.report-history__safe-area {
  width: 100%;
  flex: 0 0 auto;
}
</style>

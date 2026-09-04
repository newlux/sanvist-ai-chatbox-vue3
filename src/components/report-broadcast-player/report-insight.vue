<script setup lang="ts">
import type { ReportInsightItem } from "@/hooks/useReportInsights";
import { computed } from "vue";
import activeLightningIcon from "@/assets/img/report-broadcast/insight-lightning-active.svg";
import defaultLightningIcon from "@/assets/img/report-broadcast/insight-lightning-default.svg";
import operatorNextIcon from "@/assets/img/report-broadcast/insight-operator-next.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";
import { loadReportVoice } from "@/hooks/useReportVoice";
import { useSafeArea } from "@/hooks/useSafeArea";

const props = defineProps<{
  items: ReportInsightItem[];
  loading: boolean;
  canToggleUrgent: boolean;
  urgentToastVisible: boolean;
  loadingMore: boolean;
  hasMore: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "operator-item-open": [item: ReportInsightItem];
  "urgent-toggle": [item: ReportInsightItem];
  "load-more": [];
}>();

function handleIconTap(item: ReportInsightItem) {
  if (props.canToggleUrgent) {
    emit("urgent-toggle", item);
    return;
  }
  emit("operator-item-open", item);
}

const voicePortrait = computed(() => loadReportVoice()?.hero || "");
const { safeBottomPx, safeTopPx } = useSafeArea();
const statusbarStyle = computed(() => ({ height: `${safeTopPx.value}px` }));
const contentBottomStyle = computed(() => ({ paddingBottom: `${safeBottomPx.value + 116}px` }));
const urgentToastStyle = computed(() => ({ bottom: `${safeBottomPx.value + 121}px` }));
</script>

<template>
  <view class="report-insight" :style="contentBottomStyle">
    <view class="report-insight__statusbar" :style="statusbarStyle" />
    <!-- 设计稿 2582:799：顶部关闭导航 -->
    <view class="report-insight__nav">
      <view class="report-insight__close" @tap="emit('close')">
        <image class="report-insight__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
    </view>

    <!-- 设计稿 2582:862、2582:798、2582:867、2582:786：汇报结束摘要 -->
    <view class="report-insight__summary">
      <view class="report-insight__portrait">
        <image v-if="voicePortrait" class="report-insight__portrait-image" :src="voicePortrait" mode="aspectFill" />
      </view>
      <view class="report-insight__summary-copy">
        <view class="report-insight__headlines">
          <text class="report-insight__headline report-insight__headline--first">
            汇报结束，
          </text>
          <text class="report-insight__headline report-insight__headline--second">
            尽快处理异常事项。
          </text>
        </view>
        <view class="report-insight__voice-tip">
          <text>
            可以用语音处理所有异常，快来试试吧
          </text>
        </view>
      </view>
    </view>

    <!-- 设计稿 2582:848、2582:779、2582:854：异常列表 -->
    <scroll-view class="report-insight__list-scroll" scroll-y lower-threshold="80" @scrolltolower="emit('load-more')">
      <view class="report-insight__list">
        <view v-if="props.loading" class="report-insight__skeleton">
          <view v-for="index in 3" :key="index" class="report-insight__skeleton-item">
            <view class="report-insight__skeleton-head">
              <view class="report-insight__skeleton-block report-insight__skeleton-title" />
              <view class="report-insight__skeleton-block report-insight__skeleton-icon" />
            </view>
            <view class="report-insight__skeleton-block report-insight__skeleton-line" />
            <view class="report-insight__skeleton-block report-insight__skeleton-line report-insight__skeleton-line--short" />
          </view>
        </view>
        <view
          v-for="item in props.items"
          v-else
          :key="item.id"
          class="report-insight__item"
          :class="{ 'report-insight__item--urgent': props.canToggleUrgent && item.isUrgent }"
        >
          <view class="report-insight__item-head">
            <text class="report-insight__item-title">
              {{ item.title }}
            </text>
            <view
              v-if="props.canToggleUrgent"
              class="report-insight__lightning report-insight__lightning--actionable"
              :class="{ 'report-insight__lightning--loading': item.urgentLoading }"
              @tap="handleIconTap(item)"
            >
              <image
                class="report-insight__lightning-icon"
                :src="item.isUrgent ? activeLightningIcon : defaultLightningIcon"
                mode="aspectFit"
              />
            </view>
            <view v-else class="report-insight__operator-next" @tap="handleIconTap(item)">
              <image class="report-insight__operator-next-icon" :src="operatorNextIcon" mode="aspectFit" />
            </view>
          </view>
          <view v-if="props.canToggleUrgent && item.urgentText" class="report-insight__urgent-body">
            <text class="report-insight__urgent-text">
              {{ item.urgentText }}
            </text>
            <text class="report-insight__description">
              {{ item.description }}
            </text>
          </view>
          <text v-else class="report-insight__description">
            {{ item.description }}
          </text>
        </view>
        <text v-if="props.loadingMore" class="report-insight__load-status">
          加载中...
        </text>
        <text v-else-if="!props.hasMore && props.items.length" class="report-insight__load-status">
          没有更多了
        </text>
      </view>
    </scroll-view>

    <view v-if="props.canToggleUrgent && props.urgentToastVisible" class="report-insight__urgent-toast" :style="urgentToastStyle">
      已加急
    </view>
  </view>
</template>

<style scoped lang="scss">
.report-insight {
  display: flex;
  height: 100vh;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  background: #FFFFFF;
  font-family: PingFang SC;
}

.report-insight__statusbar {
  width: 100%;
  flex: 0 0 auto;
}

/* 设计稿 2582:799：375px × 50px 顶部导航 */
.report-insight__nav {
  display: flex;
  height: 100rpx;
  flex: 0 0 100rpx;
  align-items: center;
  padding: 0 40rpx;
  box-sizing: border-box;
}

.report-insight__close {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
}

.report-insight__close-icon {
  width: 48rpx;
  height: 48rpx;
}

/* 设计稿 2582:862、2582:798、2582:867、2582:786：头像与结论 */
.report-insight__summary {
  display: flex;
  height: 358rpx;
  flex: 0 0 358rpx;
  gap: 14rpx;
  padding: 34rpx 64rpx 0;
  box-sizing: border-box;
}

.report-insight__portrait {
  width: 140rpx;
  height: 140rpx;
  flex: 0 0 140rpx;
  overflow: hidden;
  border: 2rpx solid #EAEAEA;
  border-radius: 50%;
  box-sizing: border-box;
  background: #F4F4F4;
}

.report-insight__portrait-image {
  width: 138rpx;
  height: 135.434768rpx;
  border-radius: 50%;
}

.report-insight__summary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 12rpx;
  padding-top: 10rpx;
  box-sizing: border-box;
}

.report-insight__headlines {
  display: flex;
  height: 116rpx;
  flex: 0 0 116rpx;
  flex-direction: column;
}

.report-insight__headline {
  display: block;
  height: 58rpx;
  font-size: 48rpx;
  font-weight: 400;
  line-height: 58rpx;
}

.report-insight__headline--first {
  color: #130F0F;
}

.report-insight__headline--second {
  color: #1A1A1A;
}

.report-insight__voice-tip {
  display: flex;
  width: 402rpx;
  height: 34rpx;
  flex: 0 0 34rpx;
  align-items: center;
  padding: 4rpx 14rpx;
  border-radius: 10rpx;
  box-sizing: border-box;
  background: #FFE6E4;
  color: #C8201E;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 26rpx;
  white-space: nowrap;
}

/* 设计稿 2582:848、2582:779、2582:854：311px 宽异常条目 */
.report-insight__list-scroll {
  height: 0;
  min-height: 0;
  flex: 1 1 0;
}

.report-insight__list {
  display: flex;
  width: 622rpx;
  flex-direction: column;
  gap: 36rpx;
  margin: 0 auto;
  padding-bottom: 40rpx;
}

.report-insight__load-status {
  display: block;
  color: #999999;
  font-size: 24rpx;
  line-height: 36rpx;
  text-align: center;
}

@keyframes report-insight-skeleton-shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

.report-insight__skeleton {
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.report-insight__skeleton-item {
  display: flex;
  height: 146rpx;
  flex-direction: column;
  gap: 20rpx;
}

.report-insight__skeleton-head {
  display: flex;
  height: 36rpx;
  align-items: center;
  justify-content: space-between;
}

.report-insight__skeleton-block {
  background: linear-gradient(90deg, #F2F3F5 25%, #E5E7EB 50%, #F2F3F5 75%);
  background-size: 200% 100%;
  animation: report-insight-skeleton-shimmer 1.4s ease-in-out infinite;
}

.report-insight__skeleton-title {
  width: 250rpx;
  height: 30rpx;
  border-radius: 6rpx;
}

.report-insight__skeleton-icon {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
}

.report-insight__skeleton-line {
  width: 100%;
  height: 24rpx;
  border-radius: 6rpx;
}

.report-insight__skeleton-line--short {
  width: 68%;
}

.report-insight__item {
  display: flex;
  height: 146rpx;
  flex: 0 0 146rpx;
  flex-direction: column;
  gap: 20rpx;
}

.report-insight__item--urgent {
  height: 174rpx;
  flex-basis: 174rpx;
  gap: 14rpx;
}

.report-insight__item-head {
  display: flex;
  height: 36rpx;
  flex: 0 0 36rpx;
  align-items: flex-start;
  justify-content: space-between;
}

.report-insight__item-title {
  color: #000000;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 36rpx;
}

.report-insight__lightning {
  display: flex;
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 36rpx;
  align-items: center;
  justify-content: center;
}

.report-insight__lightning--actionable {
  cursor: pointer;
}

.report-insight__lightning--loading {
  opacity: 0.45;
  pointer-events: none;
}

.report-insight__operator-next {
  display: flex;
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 36rpx;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.report-insight__operator-next-icon {
  width: 32rpx;
  height: 32rpx;
}

.report-insight__lightning-icon {
  width: 36rpx;
  height: 36rpx;
}

.report-insight__urgent-body {
  display: flex;
  height: 124rpx;
  flex: 0 0 124rpx;
  flex-direction: column;
  gap: 20rpx;
}

.report-insight__urgent-text {
  display: block;
  height: 44rpx;
  flex: 0 0 44rpx;
  color: #B52222;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 44rpx;
}

.report-insight__description {
  display: -webkit-box;
  overflow: hidden;
  color: #999999;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  -webkit-box-orient: vertical;
}

.report-insight__item--urgent .report-insight__description {
  height: 60rpx;
  flex: 0 0 60rpx;
  line-clamp: 2;
  -webkit-line-clamp: 2;
}

.report-insight__item:not(.report-insight__item--urgent) .report-insight__description {
  height: 90rpx;
  flex: 0 0 90rpx;
  line-clamp: 3;
  -webkit-line-clamp: 3;
}

/* 设计稿 2582:836：点击后显示的 80px × 36px 加急提示 */
.report-insight__urgent-toast {
  position: fixed;
  z-index: 10;
  left: 50%;
  display: flex;
  width: 160rpx;
  height: 72rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid #EFEFEF;
  border-radius: 16rpx;
  box-sizing: border-box;
  background: #FFFFFF;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
  color: #C8201E;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  transform: translateX(-50%);
}
</style>

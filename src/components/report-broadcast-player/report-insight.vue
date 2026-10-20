<script setup lang="ts">
import type { ReportInsightItem } from "@/hooks/useReportInsights";
import { computed } from "vue";
import activeLightningIcon from "@/assets/img/report-broadcast/insight-lightning-active.svg";
import defaultLightningIcon from "@/assets/img/report-broadcast/insight-lightning-default.svg";
import operatorNextIcon from "@/assets/img/report-broadcast/insight-operator-next.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";
import { useSafeArea } from "@/hooks/useSafeArea";

const props = withDefaults(defineProps<{
  items: ReportInsightItem[];
  loading: boolean;
  canToggleUrgent: boolean;
  urgentToastVisible: boolean;
  urgentToastMessage: string;
  loadingMore: boolean;
  hasMore: boolean;
  /** 内嵌到听汇报页时，宿主已提供顶部状态栏占位，这里不再重复渲染。 */
  embedded?: boolean;
  /** 当前是否处于播报播放态，收起态重播按钮沿用播报页同一套图标映射。 */
  playing?: boolean;
  /** 重播退场中：整层按入场动画逆向还原，动画走完由宿主卸载。 */
  leaving?: boolean;
  /** 入场是否播放过渡动画：仅播报结束与语音跳转开启，异常处理回到列表时直接呈现。 */
  animated?: boolean;
  /**
   * 当前激活音色的主视觉头像（hero 大图）。
   * 收敛页与播报页用同一份来源：宿主进页已经从 preference / finishHistory / finishDefault 三路对齐过，
   * 这里再读一次 storage 会因为播报期从未 saveReportVoice 而取不到，所以直接由宿主传入。
   */
  portrait?: string;
}>(), {
  embedded: false,
  playing: false,
  leaving: false,
  animated: true,
  portrait: "",
});

const emit = defineEmits<{
  close: [];
  "operator-item-open": [item: ReportInsightItem];
  "urgent-toggle": [item: ReportInsightItem];
  /** 点击异常条目正文：触发详情弹窗（仅在 canToggleUrgent=false 时使用；OWNER 由右侧闪电按钮走 urgent-toggle）。 */
  "item-open": [item: ReportInsightItem];
  "load-more": [];
  replay: [];
}>();

function handleIconTap(item: ReportInsightItem) {
  if (props.canToggleUrgent) {
    emit("urgent-toggle", item);
    return;
  }
  emit("operator-item-open", item);
}

const voicePortrait = computed(() => props.portrait);
const { safeBottomPx, safeTopPx } = useSafeArea();
const statusbarStyle = computed(() => ({ height: `${safeTopPx.value}px` }));
const contentBottomStyle = computed(() => ({ paddingBottom: `${safeBottomPx.value + 116}px` }));
const urgentToastStyle = computed(() => ({ bottom: `${safeBottomPx.value + 121}px` }));
</script>

<template>
  <view
    class="report-insight"
    :class="{
      'report-insight--embedded': props.embedded,
      'report-insight--leaving': props.leaving,
      'report-insight--instant': !props.animated,
    }"
    :style="contentBottomStyle"
  >
    <view v-if="!props.embedded" class="report-insight__statusbar" :style="statusbarStyle" />
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
      <!-- 设计稿 309:3319：头像右下角的重播角标，22px 白底圆 + 1px 描边 + 渐变描边图标 -->
      <view class="report-insight__replay" @tap="emit('replay')">
        <svg class="report-insight__replay-icon" viewBox="0 0 22 22" aria-hidden="true">
          <defs>
            <linearGradient
              id="report-insight-replay-gradient"
              x1="0"
              y1="0"
              x2="22"
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stop-color="#3D21CD" />
              <stop offset="48.72%" stop-color="#1999FE" />
              <stop offset="76%" stop-color="#C067FA" />
              <stop offset="100%" stop-color="#FD90C4" />
            </linearGradient>
          </defs>
          <!-- 播放中显示暂停双条，收起态显示播放三角（与设计稿一致） -->
          <g v-if="props.playing" fill="url(#report-insight-replay-gradient)">
            <rect x="7.4" y="6.2" width="2.8" height="9.6" rx="1.4" />
            <rect x="11.8" y="6.2" width="2.8" height="9.6" rx="1.4" />
          </g>
          <polygon
            v-else
            points="8.2,6.2 15.4,11 8.2,15.8"
            fill="none"
            stroke="url(#report-insight-replay-gradient)"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
      </view>
    </view>

    <!-- 设计稿 2582:848、2582:779、2582:854：异常列表 -->
    <!-- list-stage 负责在基线处裁切，列表整体自文字滚动区底边向上抽出 -->
    <view class="report-insight__list-stage">
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
            v-for="(item, index) in props.items"
            v-else
            :key="item.id"
            class="report-insight__item"
            :class="{ 'report-insight__item--urgent': item.ownerTag }"
            @tap="emit('item-open', item)"
          >
            <view class="report-insight__item-head">
              <text class="report-insight__item-title">
                {{ index + 1 }}.{{ item.title }}
              </text>
              <view
                v-if="props.canToggleUrgent"
                class="report-insight__lightning report-insight__lightning--actionable"
                :class="{ 'report-insight__lightning--loading': item.urgentLoading }"
                @tap.stop="handleIconTap(item)"
              >
                <image
                  class="report-insight__lightning-icon"
                  :src="item.isUrgent ? activeLightningIcon : defaultLightningIcon"
                  mode="aspectFit"
                />
              </view>
              <view v-else class="report-insight__operator-next" @tap.stop="handleIconTap(item)">
                <image class="report-insight__operator-next-icon" :src="operatorNextIcon" mode="aspectFit" />
              </view>
            </view>
            <view v-if="item.ownerTag" class="report-insight__urgent-body">
              <text class="report-insight__urgent-text">
                {{ item.ownerTag }}
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
    </view>

    <view v-if="props.canToggleUrgent && props.urgentToastVisible" class="report-insight__urgent-toast" :style="urgentToastStyle">
      {{ props.urgentToastMessage }}
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

/* 内嵌到听汇报页时，高度由宿主容器决定，顶部状态栏由宿主提供。 */
.report-insight--embedded {
  height: 100%;
}

/* 头像归位形变：起点与播报期大头像完全重合。
   播报头像 470rpx @ left 140rpx / top 154rpx（header 100 + gap 34 + stage 居中留白 20）
   洞察头像 140rpx @ left 64rpx  / top 134rpx（nav 100 + summary padding-top 34）
   => scale = 470 / 140 ≈ 3.357，translate = (140 - 64, 154 - 134) = (76rpx, 20rpx) */
@keyframes report-insight-portrait-morph {
  from {
    border-color: transparent;
    border-radius: 0;
    background: transparent;
    transform: translate(76rpx, 20rpx) scale(3.357);
  }
  to {
    border-color: #EAEAEA;
    border-radius: 70rpx;
    background: #F4F4F4;
    transform: none;
  }
}

/* 用长度而非百分比插值，避免部分端 length↔percentage 过渡不平滑 */
@keyframes report-insight-portrait-image-radius {
  from {
    border-radius: 0;
  }
  to {
    border-radius: 70rpx;
  }
}

/* 标题与关闭按钮：略晚于头像起手淡入 */
@keyframes report-insight-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* 异常列表：自基线整体上抽并淡入 */
@keyframes report-insight-list-drawer {
  from {
    opacity: 0;
    transform: translateY(180rpx);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 重播退场：以下四条都是入场动画的时间倒放。
   from 必须与对应入场动画的 to 完全一致，切换 animation 时才不会跳变。 */
@keyframes report-insight-portrait-morph-out {
  from {
    border-color: #EAEAEA;
    border-radius: 70rpx;
    background: #F4F4F4;
    transform: none;
  }
  to {
    border-color: transparent;
    border-radius: 0;
    background: transparent;
    transform: translate(76rpx, 20rpx) scale(3.357);
  }
}

@keyframes report-insight-portrait-image-radius-out {
  from {
    border-radius: 70rpx;
  }
  to {
    border-radius: 0;
  }
}

@keyframes report-insight-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@keyframes report-insight-list-drawer-out {
  from {
    opacity: 1;
    transform: none;
  }
  to {
    opacity: 0;
    transform: translateY(180rpx);
  }
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
  animation: report-insight-fade-in 0.28s ease-out 0.16s both;
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

/* 设计稿 309:3243（头像）、309:3288/309:3179（两行标题）、309:3303（语音胶囊）：
   头像 70px@(32,115)，左边距 32px（64rpx），与右侧文字间距 7px（14rpx） */
.report-insight__summary {
  position: relative;
  z-index: 2;
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
  transform-origin: top left;
  animation: report-insight-portrait-morph 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 设计稿头像照片 74.14×74.14 铺满并裁切 70×70 圆形容器：
   这里用 100% 撑满 + aspectFill，避免旧值（138×135.43）造成的边缘留白 */
.report-insight__portrait-image {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  animation: report-insight-portrait-image-radius 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 设计稿 309:3178：头像顶 115、标题顶 115（与头像齐平，不再向下让 5px） */
.report-insight__summary-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 10rpx;
  padding-top: 0;
  box-sizing: border-box;
  animation: report-insight-fade-in 0.3s ease-out 0.16s both;
}

/* 设计稿 309:3288 / 309:3179：文本盒 35px×2、行距 30px，
   盒高取 130rpx（65px）让语音胶囊顶落在 185px（第二行盒底 180 + 5） */
.report-insight__headlines {
  display: flex;
  height: 130rpx;
  flex: 0 0 130rpx;
  flex-direction: column;
}

/* 设计稿：24px（48rpx）/ Medium(500) / 行距 30px（60rpx） */
.report-insight__headline {
  display: block;
  height: 60rpx;
  font-size: 48rpx;
  font-weight: 500;
  line-height: 60rpx;
}

/* 设计稿色值：首行 #131010，次行 #0D0D0D */
.report-insight__headline--first {
  color: #131010;
}

.report-insight__headline--second {
  color: #0D0D0D;
}

/* 设计稿 309:3303：hug 宽、高 19px（38rpx）、圆角 5px（10rpx）、#1166D6 @10%、
   内边距 上2 右7 下2 左7、文字 11px（22rpx）#0D0D0D */
.report-insight__voice-tip {
  display: flex;
  width: auto;
  height: 38rpx;
  flex: 0 0 38rpx;
  align-self: flex-start;
  align-items: center;
  padding: 4rpx 14rpx;
  border-radius: 10rpx;
  box-sizing: border-box;
  background: rgba(17, 102, 214, 0.1);
  color: #0D0D0D;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 30rpx;
  white-space: nowrap;
}

/* 设计稿 309:3319：头像右下角的重播角标 22px（44rpx），
   圆心 (135rpx, 173rpx) = 头像 (64,34)~(204,174) 右下侧，
   白底圆 + 1px（2rpx）#E4E4E4 描边 + 0 1 11 rgba(0,0,0,10%) 投影。
   淡入延迟到头像缩小收尾，否则会被 3.357 倍的大头像压住。 */
.report-insight__replay {
  position: absolute;
  z-index: 1;
  top: 151rpx;
  left: 113rpx;
  display: flex;
  width: 44rpx;
  height: 44rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid #E4E4E4;
  border-radius: 50%;
  box-sizing: border-box;
  background: #FFFFFF;
  box-shadow: 0 2rpx 22rpx rgba(0, 0, 0, 0.1);
  animation: report-insight-fade-in 0.22s ease-out 0.4s both;
}

/* 图标画在 22 视盒里（1 单位 = 1px），尺寸取描边内的 40rpx 内容区，
   三角实际约 7px 宽，与设计稿 7.7px 的描边区域一致 */
.report-insight__replay-icon {
  width: 40rpx;
  height: 40rpx;
}

/* 设计稿 2582:848、2582:779、2582:854：311px 宽异常条目 */
/* 裁切容器：底边即语音输入栏上方基线（等价播报期文字滚动区底边），
   列表整体从该基线向上抽出，形成抽屉观感 */
.report-insight__list-stage {
  display: flex;
  min-height: 0;
  flex: 1 1 0;
  flex-direction: column;
  overflow: hidden;
}

.report-insight__list-scroll {
  width: 100%;
  min-height: 0;
  flex: 1 1 0;
  animation: report-insight-list-drawer 0.34s cubic-bezier(0.22, 0.61, 0.36, 1) 0.12s both;
}

/* 重播退场：用更高优先级的选择器整体换掉入场 animation。
   最长一段 0.42s（头像形变），宿主在 0.44s 后卸载本层。 */
.report-insight--leaving {
  pointer-events: none;
}

/* 退场时本层转透明，露出下面的播报层做交叉过渡。
   此刻播报层还被 --restoring 的 from 段压在全透明（等效白底），
   所以「白 → 透明」这一下不会闪。 */
.report-insight--embedded.report-insight--leaving {
  background: transparent;
}

.report-insight--leaving .report-insight__portrait {
  animation: report-insight-portrait-morph-out 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.report-insight--leaving .report-insight__portrait-image {
  animation: report-insight-portrait-image-radius-out 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.report-insight--leaving .report-insight__replay {
  animation: report-insight-fade-out 0.16s ease-out both;
}

.report-insight--leaving .report-insight__nav,
.report-insight--leaving .report-insight__summary-copy {
  animation: report-insight-fade-out 0.2s ease-out both;
}

.report-insight--leaving .report-insight__list-scroll {
  animation: report-insight-list-drawer-out 0.3s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

/* 非过渡入场：整层直接呈现，不播头像形变、标题淡入与列表上抽。
   排除退场态，保证收起态重播仍走原有逆向动画。 */
.report-insight--instant:not(.report-insight--leaving) {
  .report-insight__nav,
  .report-insight__portrait,
  .report-insight__portrait-image,
  .report-insight__summary-copy,
  .report-insight__replay,
  .report-insight__list-scroll {
    animation: none;
  }
}

/* 设计稿 309:3313 / 309:3296 / 309:3305：条目宽 311px（622rpx），
   条目间距取设计稿稳定值 30px（60rpx） */
.report-insight__list {
  display: flex;
  width: 622rpx;
  flex-direction: column;
  gap: 60rpx;
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

/* 骨架屏与真实条目同高（158rpx），切换时不跳动 */
.report-insight__skeleton-item {
  display: flex;
  height: 158rpx;
  flex-direction: column;
  gap: 10rpx;
}

.report-insight__skeleton-head {
  display: flex;
  height: 46rpx;
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

/* 设计稿普通条目：标题 23 + 间距 5 + 描述 51 = 79px（158rpx） */
.report-insight__item {
  display: flex;
  height: 158rpx;
  flex: 0 0 158rpx;
  flex-direction: column;
  gap: 10rpx;
}

/* 设计稿带负责人条目：标题 23 + 1 + 状态 22 + 6 + 描述 34 = 86px（172rpx） */
.report-insight__item--urgent {
  height: 172rpx;
  flex-basis: 172rpx;
  gap: 2rpx;
}

/* 设计稿：标题行高 23px（46rpx），右侧图标与标题顶对齐 */
.report-insight__item-head {
  display: flex;
  height: 46rpx;
  flex: 0 0 46rpx;
  align-items: flex-start;
  justify-content: space-between;
}

/* 设计稿：16px（32rpx）/ Medium(500) / 行高 23px（46rpx）/ #0D0D0D */
.report-insight__item-title {
  color: #0D0D0D;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 46rpx;
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

/* 设计稿：状态行 22px（44rpx）与描述间距 6px（12rpx） */
.report-insight__urgent-body {
  display: flex;
  height: 124rpx;
  flex: 0 0 124rpx;
  flex-direction: column;
  gap: 12rpx;
}

/* 设计稿：12px（24rpx）/ 行高 22px（44rpx）/ #E02E2A */
.report-insight__urgent-text {
  display: block;
  height: 44rpx;
  flex: 0 0 44rpx;
  color: #E02E2A;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 44rpx;
}

/* 设计稿：12px（24rpx）/ 行高 17px（34rpx）/ #8E8E8E */
.report-insight__description {
  display: -webkit-box;
  overflow: hidden;
  color: #8E8E8E;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 34rpx;
  -webkit-box-orient: vertical;
}

/* 带负责人条目描述 34px（68rpx）= 2 行 */
.report-insight__item--urgent .report-insight__description {
  height: 68rpx;
  flex: 0 0 68rpx;
  line-clamp: 2;
  -webkit-line-clamp: 2;
}

/* 普通条目描述 51px（102rpx）= 3 行 */
.report-insight__item:not(.report-insight__item--urgent) .report-insight__description {
  height: 102rpx;
  flex: 0 0 102rpx;
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

/* PC 端（鼠标/精确指针）隐藏异常列表滚动条：
   scroll-view 在 H5 下即使只有 1 条数据也会保留滚动条轨道，
   这里只在 PC 端隐藏，不影响 App/手机端原生滚动条行为。 */
@media (hover: hover) and (pointer: fine) {
  :deep(.report-insight__list-scroll) {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  :deep(.report-insight__list-scroll::-webkit-scrollbar) {
    display: none;
    width: 0;
    height: 0;
  }
}
</style>

<script setup lang="ts">
import type { GuideCheckPayload, GuideStepSelectEvent } from "@/api/chat/types";
import { computed, ref } from "vue";
import iconCopy from "@/assets/img/icon-action-copy.svg";
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import iconShare from "@/assets/img/icon-action-share.svg";
import GuideSourceBlock from "./GuideSourceBlock.vue";
import { normalizeGuideUrl, previewGuideImages } from "@/utils/guide-content";

/**
 * 核对任务与资料卡片（设计稿 2667:4520）。
 *
 * 独立白卡（白底 + #EFEFEF 边框 + 圆角 20 + 阴影 + 内边距 20），不套在回答气泡里，
 * 由消息列表在气泡下方单独渲染。
 * 结构：标题 + 右上角红色「步骤i/n」→ 步骤条（按步骤数切分，高亮当前步）→ 核对清单正文
 * → 参考来源（步骤卡回答气泡正文隐藏时，由消息列表注入同一条回答的 source 组件）→ 状态行
 * → 底部动作区（播报 / 复制 / 分享）。
 */
defineOptions({ name: "GuideCheckBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideCheckPayload, required: true },
  /** 动作区是否展示：生成中 / 被中断的那一轮不展示（与气泡操作栏一致） */
  showActions: { type: Boolean, default: true },
  /** 这一轮是否支持语音播报：由消息的 ttsEnabled 决定，不支持时不画播报按钮 */
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  ttsPlaying: { type: Boolean, default: false },
});

/**
 * 卡片的动作全部上抛，由页面复用现成能力：
 * - select-step → 页面切步骤并打开底部白板；
 * - tts-click   → 页面 useChatTts / 实时 TTS（按消息下标）；
 * - copy-click  → 页面 useChatShare 的复制（带卡片自身文案，这条消息气泡正文是隐藏的）；
 * - share-click → 页面 useChatShare 把这张卡片截成海报（带的是卡片根节点，不是未渲染的正文）。
 */
const emit = defineEmits<{
  (e: "select-step", payload: GuideStepSelectEvent): void;
  (e: "tts-click"): void;
  (e: "copy-click", payload: { text: string }): void;
  (e: "share-click", payload: { element: HTMLElement | null }): void;
}>();

/** 卡片根节点：分享时整卡截图用（uni 的 view 在部分端会包一层组件实例） */
const rootRef = ref<HTMLElement | { $el?: HTMLElement } | null>(null);

const title = computed(() => String(props.payload?.title || "").trim() || "核对任务与资料");
const content = computed(() => String(props.payload?.content || ""));
/** 这一步的参考图（steps[].images）：渲染在「参考来源」上方，宽高自适应 */
const images = computed(() => (Array.isArray(props.payload?.images) ? props.payload.images : [])
  .map(item => ({
    url: normalizeGuideUrl(String(item?.url || "")),
    caption: String(item?.caption || ""),
  }))
  .filter(item => item.url));
/** 参考来源：由消息列表从同一条回答的 source 组件注入，卡片内沿用「参考来源」样式展示 */
const sources = computed(() => (Array.isArray(props.payload?.sources) ? props.payload.sources : []));

function previewImage(current: string) {
  previewGuideImages(current, images.value.map(item => item.url));
}
const status = computed(() => String(props.payload?.status || "").trim());
const stepIndex = computed(() => Math.max(0, Number(props.payload?.step_index) || 0));
const stepTotal = computed(() => Math.max(0, Number(props.payload?.step_total) || 0));
const showStep = computed(() => stepTotal.value > 0 && stepIndex.value > 0);
/**
 * 步骤条分段数 = 步骤总数：轨道按「每一步」等分成 N 段（段间留小空隙），
 * 只有**当前步**那一段着色，走到第几步一眼能看出来。
 */
const stepSegments = computed(() => Math.max(0, stepTotal.value));

/** 点某一段 → 切到该步；越界（数据异常）不响应 */
function onSelectStep(index: number) {
  if (index < 1 || index > stepSegments.value) return;
  emit("select-step", { index, stepId: String(props.payload?.step_id || "") });
}

/** 复制卡片自身文案：这条消息的气泡正文是隐藏的，用户看到的就是卡内的标题 + 正文 */
const copyText = computed(() => [title.value, content.value].filter(Boolean).join("\n"));

function onCopyTap() {
  emit("copy-click", { text: copyText.value });
}

function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}

/** 分享：把卡片根节点交给页面的 useChatShare 截图（动作区带 data-share-poster-ignore，不会进海报） */
function onShareTap() {
  emit("share-click", { element: resolveRootElement() });
}

/** 取卡片根 DOM：H5 下 view 直接就是元素，部分端会包一层组件实例（取 $el） */
function resolveRootElement(): HTMLElement | null {
  const node = rootRef.value;
  if (!node) return null;
  const hasDom = typeof HTMLElement !== "undefined";
  if (hasDom && node instanceof HTMLElement) return node;
  const inner = (node as { $el?: HTMLElement }).$el;
  return hasDom && inner instanceof HTMLElement ? inner : null;
}
</script>

<template>
  <view ref="rootRef" class="guide-check-block">
    <view class="guide-check-block__header">
      <text class="guide-check-block__title">
        {{ title }}
      </text>
      <text v-if="showStep" class="guide-check-block__step">
        步骤{{ stepIndex }}/{{ stepTotal }}
      </text>
    </view>

    <!-- 步骤条：按步骤数切成 N 段，只高亮当前步那一段；点某一段可切到该步 -->
    <view v-if="showStep" class="guide-check-block__track">
      <view
        v-for="index in stepSegments"
        :key="index"
        class="guide-check-block__segment"
        :class="{ 'guide-check-block__segment--active': index === stepIndex }"
      />
      <!-- 透明命中层：色条只有 4rpx 高，这里上下各撑开一段做可点区域（绝对定位，不参与布局） -->
      <view class="guide-check-block__track-hit">
        <view
          v-for="index in stepSegments"
          :key="`hit-${index}`"
          class="guide-check-block__track-hit-item"
          @tap.stop="onSelectStep(index)"
        />
      </view>
    </view>

    <text class="guide-check-block__content">
      {{ content }}
    </text>

    <!-- 这一步的参考图：渲染在「参考来源」上方 -->
    <view v-if="images.length" class="guide-check-block__images">
      <view v-for="item in images" :key="item.url" class="guide-check-block__image-item">
        <image
          class="guide-check-block__image"
          :src="item.url"
          mode="widthFix"
          @tap.stop="previewImage(item.url)"
        />
        <text v-if="item.caption" class="guide-check-block__image-caption">
          {{ item.caption }}
        </text>
      </view>
    </view>

    <!-- 参考来源：与回答气泡里的参考资料同款（标题 + 条目） -->
    <GuideSourceBlock
      v-if="sources.length"
      class="guide-check-block__sources"
      :payload="{ evidence: sources }"
    />

    <text v-if="status" class="guide-check-block__status">
      {{ status }}
    </text>

    <!-- 动作区：播报 / 复制 / 分享，与回答气泡的操作栏同一套图标与观感；
         data-share-poster-ignore 让分享截图时把这一行摘掉，海报里只有卡片内容 -->
    <view v-if="showActions" class="guide-check-block__actions" data-share-poster-ignore>
      <view
        v-if="ttsEnabled"
        class="guide-check-block__action-btn"
        @tap.stop="onTtsTap"
      >
        <view v-if="ttsLoading" class="guide-check-block__tts-spinner" />
        <view v-else-if="ttsPlaying" class="guide-check-block__tts-wave">
          <view
            v-for="index in 4"
            :key="index"
            class="guide-check-block__tts-wave-bar"
            :class="`guide-check-block__tts-wave-bar--${index}`"
          />
        </view>
        <image v-else :src="iconRadioOn" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
      <view class="guide-check-block__action-btn" @tap.stop="onCopyTap">
        <image :src="iconCopy" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
      <view class="guide-check-block__action-btn" @tap.stop="onShareTap">
        <image :src="iconShare" mode="aspectFit" class="guide-check-block__action-icon" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 这一步的参考图：宽高自适应（widthFix），与对话框里的参考图同一套观感 */
.guide-check-block__images {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.guide-check-block__image-item {
  overflow: hidden;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.guide-check-block__image {
  display: block;
  width: 100%;
  min-height: 240rpx;
  background: #eeeeee;
}

.guide-check-block__image-caption {
  display: block;
  padding: 12rpx 16rpx 16rpx;
  color: #666666;
  font-size: 24rpx;
  line-height: 34rpx;
}

.guide-check-block__sources {
  margin-top: 24rpx;
}


/* 设计稿卡片：白底 + #EFEFEF 边框 + 圆角 20px + 阴影，内边距 20px */
.guide-check-block {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  padding: 40rpx;
  border: 1rpx solid #efefef;
  border-radius: 40rpx;
  background: #ffffff;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
}

.guide-check-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.guide-check-block__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #1a1a1e;
}

.guide-check-block__step {
  flex-shrink: 0;
  margin-left: 16rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  line-height: 34rpx;
  color: #000;
}

/* 步骤条：轨道 295×2 => 590×4，按步骤数等分成 N 段、段间留 2px（4rpx）空隙；
   默认轨道色 #F1F1F1，只有当前步那一段是红色 #C8201E（设计稿 2667:4531） */
.guide-check-block__track {
  position: relative;
  display: flex;
  width: 100%;
  height: 4rpx;
  margin-top: 24rpx;
}

/* 步骤条的透明命中层：视觉仍是 4rpx 细条，可点区域上下各扩 24rpx（约 24px 高） */
.guide-check-block__track-hit {
  position: absolute;
  top: -24rpx;
  right: 0;
  bottom: -24rpx;
  left: 0;
  display: flex;
}

/* 命中块与色条等宽、同空隙，保证点哪一段就是哪一步 */
.guide-check-block__track-hit-item {
  flex: 1 1 0;
  min-width: 0;
}

.guide-check-block__track-hit-item + .guide-check-block__track-hit-item {
  margin-left: 4rpx;
}

.guide-check-block__segment {
  flex: 1 1 0;
  min-width: 0;
  height: 100%;
  border-radius: 2rpx;
  background: #f1f1f1;
}

/* 段间空隙：用 margin 而不是 flex gap（低端安卓 WebView 的 flex gap 支持不稳） */
.guide-check-block__segment + .guide-check-block__segment {
  margin-left: 4rpx;
}

.guide-check-block__segment--active {
  background: #000;
}

.guide-check-block__content {
  display: block;
  margin-top: 24rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 400;
  line-height: 44rpx;
  color: #1a1a1e;
}

.guide-check-block__status {
  display: block;
  margin-top: 24rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #9e9e9e;
}

/* 动作区：与回答气泡的操作栏同款（上方 1px 分隔线 + 图标间距 8px） */
.guide-check-block__actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16rpx;
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 1px solid #e8e8e8;
}

.guide-check-block__action-btn {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
}

.guide-check-block__action-icon {
  width: 32rpx;
  height: 32rpx;
}

.guide-check-block__tts-spinner {
  box-sizing: border-box;
  width: 24rpx;
  height: 24rpx;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: guide-check-tts-spin 0.8s linear infinite;
}

/* 播放中的语音图标：蓝色声波，四根条错峰起伏，视觉上从左往右推进 */
.guide-check-block__tts-wave {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.guide-check-block__tts-wave-bar {
  width: 4rpx;
  height: 24rpx;
  border-radius: 4rpx;
  background: #1a6dff;
  transform-origin: center center;
  animation: guide-check-tts-wave 0.9s ease-in-out infinite;
}

.guide-check-block__tts-wave-bar--1 { animation-delay: 0s; }
.guide-check-block__tts-wave-bar--2 { animation-delay: 0.12s; }
.guide-check-block__tts-wave-bar--3 { animation-delay: 0.24s; }
.guide-check-block__tts-wave-bar--4 { animation-delay: 0.36s; }

@keyframes guide-check-tts-spin {
  to { transform: rotate(360deg); }
}

@keyframes guide-check-tts-wave {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.6;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}
</style>

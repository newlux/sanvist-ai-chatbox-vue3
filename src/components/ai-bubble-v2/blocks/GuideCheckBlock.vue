<script setup lang="ts">
import type { GuideCheckPayload, GuideStepSelectEvent } from "@/api/chat/types";
import { computed } from "vue";
import GuideSourceBlock from "./GuideSourceBlock.vue";
import { normalizeGuideUrl, previewGuideImages } from "@/utils/guide-content";

/**
 * 核对任务与资料卡片（设计稿 2667:4520）。
 *
 * 独立白卡（白底 + #EFEFEF 边框 + 圆角 20 + 阴影 + 内边距 20），不套在回答气泡里，
 * 由消息列表在气泡下方单独渲染。
 * 结构：标题 + 右上角红色「步骤i/n」→ 步骤条（按步骤数切分，高亮当前步）→ 核对清单正文
 * → 参考来源（步骤卡回答气泡正文隐藏时，由消息列表注入同一条回答的 source 组件）→ 状态行。
 */
defineOptions({ name: "GuideCheckBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideCheckPayload, required: true },
});

/** 点步骤条某一段：把步数（1 起）与 step_id 抛给上层，由页面切步骤并打开底部白板 */
const emit = defineEmits<{ (e: "select-step", payload: GuideStepSelectEvent): void }>();

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
</script>

<template>
  <view class="guide-check-block">
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
  color: #c8201e;
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
  background: #c8201e;
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
</style>

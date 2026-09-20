<script setup lang="ts">
import type { GuideCheckPayload } from "@/api/chat/types";
import { computed } from "vue";
import GuideSourceBlock from "./GuideSourceBlock.vue";

/**
 * 核对任务与资料卡片（设计稿 2667:4520）。
 *
 * 独立白卡（白底 + #EFEFEF 边框 + 圆角 20 + 阴影 + 内边距 20），不套在回答气泡里，
 * 由消息列表在气泡下方单独渲染。
 * 结构：标题 + 右上角红色「步骤i/n」→ 红色进度条（已完成步骤占比）→ 核对清单正文
 * → 参考来源（步骤卡回答气泡正文隐藏时，由消息列表注入同一条回答的 source 组件）→ 状态行。
 */
defineOptions({ name: "GuideCheckBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideCheckPayload, required: true },
});

const title = computed(() => String(props.payload?.title || "").trim() || "核对任务与资料");
const content = computed(() => String(props.payload?.content || ""));
/** 参考来源：由消息列表从同一条回答的 source 组件注入，卡片内沿用「参考来源」样式展示 */
const sources = computed(() => (Array.isArray(props.payload?.sources) ? props.payload.sources : []));
const status = computed(() => String(props.payload?.status || "").trim());
const stepIndex = computed(() => Math.max(0, Number(props.payload?.step_index) || 0));
const stepTotal = computed(() => Math.max(0, Number(props.payload?.step_total) || 0));
const showStep = computed(() => stepTotal.value > 0 && stepIndex.value > 0);
/** 进度条按「已完成步骤」占满：设计稿 步骤2/3 对应 97/295 ≈ 33% */
const progressPercent = computed(() => {
  if (!stepTotal.value) return 0;
  const done = Math.min(Math.max(stepIndex.value - 1, 0), stepTotal.value);
  return Math.round((done / stepTotal.value) * 100);
});
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

    <view v-if="showStep" class="guide-check-block__track">
      <view class="guide-check-block__bar" :style="{ width: `${progressPercent}%` }" />
    </view>

    <text class="guide-check-block__content">
      {{ content }}
    </text>

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
/* 步骤配图已移到卡片外单独成卡（消息列表的卡片栈），卡片内只留标题 / 正文 / 参考来源 / 状态行 */
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

/* 进度条：295×2 => 590×4，轨道 #F1F1F1、已完成 #C8201E */
.guide-check-block__track {
  width: 100%;
  height: 4rpx;
  margin-top: 24rpx;
  border-radius: 2rpx;
  background: #f1f1f1;
  overflow: hidden;
}

.guide-check-block__bar {
  height: 100%;
  border-radius: 2rpx;
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

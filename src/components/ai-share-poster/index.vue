<script setup>
import moment from "moment";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AiBubbleV2 from "@/components/ai-bubble-v2/index.vue";

defineOptions({
  name: "ShareConversationPoster",
});

const props = defineProps({
  messages: {
    type: Array,
    default: () => [],
  },
  selectedIndexes: {
    type: Array,
    default: () => [],
  },
});

const { t } = useI18n();

const selectedMessages = computed(() => {
  const list = Array.isArray(props.messages) ? props.messages : [];
  const indexes = Array.isArray(props.selectedIndexes) ? props.selectedIndexes : [];

  return indexes.map(idx => list[idx]).filter(Boolean).map((message) => {
    const rawBlocks = Array.isArray(message.blocks) ? message.blocks : [];
    // 展开 answerGroup 子块，去掉「输出结果」标题，仅保留内部 answer/chart 内容
    const blocks = rawBlocks.flatMap(block =>
      block.type === "answerGroup" && Array.isArray(block.payload?.blocks)
        ? block.payload.blocks
        : [block],
    ).filter(
      block => !["think", "tool_call", "status", "suggestion"].includes(block.type),
    );
    return { ...message, blocks };
  });
});

const date = computed(() => moment().format("YYYY年M月D日"));
</script>

<template>
  <view class="share-poster">
    <view class="share-poster__header">
      <text class="share-poster__header-title">
        {{ t("share-poster-header-title") }}
      </text>
      <view class="share-poster__header-meta">
        <text class="share-poster__header-date">
          {{ date }}
        </text>
        <text class="share-poster__header-tip">
          {{ t("share-poster-header-tip") }}
        </text>
      </view>
    </view>

    <view class="share-poster__items">
      <view v-for="(m, i) in selectedMessages" :key="`sp-${i}-${m.role}`">
        <AiBubbleV2
          :role="m.role"
          :content="m.content"
          :blocks="m.blocks || []"
          :loading="false"
          :tts-enabled="false"
          :tts-loading="false"
          :show-actions="false"
          :selected="false"
          :select-mode="false"
          :disabled="false"
          :force-thinking-expanded="false"
          :hide-suggestion="true"
          :no-answer-group="true"
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 海报卡：设计稿 495:841，整体白色圆角卡 */
.share-poster {
  width: 656rpx;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 24rpx 30rpx 30rpx;
  box-sizing: border-box;
}

/* 海报卡 header：严格按设计稿 495:824 / 495:817 / 495:838 / 495:814 / 495:816 / 495:815 */
.share-poster__header {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 0 0 20rpx;
  border-bottom: 2rpx solid #e5e7ea;
}

.share-poster__header-title {
  font-family: "Inter";
  font-size: 32rpx;
  font-weight: 500;
  line-height: 38rpx;
  color: #1a1a1a;
}

.share-poster__header-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.share-poster__header-date,
.share-poster__header-tip {
  font-family: "Inter";
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  color: #999999;
}

.share-poster__items {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
  padding: 24rpx 0 0;
}
</style>

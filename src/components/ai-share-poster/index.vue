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

  return indexes.map(idx => list[idx]).filter(Boolean).map(message => ({
    ...message,
    blocks: (message.blocks || []).filter(
      block => !["think", "tool_call", "status", "suggestion"].includes(block.type),
    ),
  }));
});

const date = computed(() => moment().format("YYYY-MM-DD"));
</script>

<template>
  <view class="share-poster">
    <view class="share-poster__header">
      <view class="share-poster__header-text">
        <text class="share-poster__header-title">
          {{ t("share-poster-header-title") }}
        </text>
      </view>
      <view class="share-poster__header-tip">
        <text class="share-poster__header-tip-text">
          {{ t("share-poster-header-tip", { date }) }}
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
        />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 复用页面现有的分享长图布局类名 */
.share-poster {
  width: 690rpx;
  min-width: 60vw;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  box-sizing: border-box;
}

.share-poster__header {
  display: flex;
  flex-direction: column;
  gap: 19rpx;
  padding-bottom: 20rpx;
  border-bottom: 2rpx solid #e5e7ea;
}

.share-poster__logo {
  width: 64rpx;
  height: 64rpx;
}

.share-poster__header-text {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.share-poster__header-title {
  font-size: 24rpx;
  line-height: 40rpx;
  font-weight: 700;
  color: #2f323c;
}

.share-poster__header-tip {
  font-size: 20rpx;
  line-height: 32rpx;
  color: #808497;
}

.share-poster__items {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
  padding: 32rpx 0;
}
</style>

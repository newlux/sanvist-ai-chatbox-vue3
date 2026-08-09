<script setup>
import { ref, watch } from "vue";

import MarkdownBlock from "./MarkdownBlock.vue";

defineOptions({ name: "ThinkBlock" });

const props = defineProps({
  content: { type: String, default: "" },
  complete: { type: Boolean, default: false },
  forceExpanded: { type: Boolean, default: false },
});

const expanded = ref(props.forceExpanded || !props.complete);

watch(() => props.complete, (value) => {
  if (!props.forceExpanded) expanded.value = !value;
});

watch(() => props.forceExpanded, (value) => {
  if (value) expanded.value = true;
  else expanded.value = !props.complete;
});

function toggleExpanded() {
  if (!props.forceExpanded) expanded.value = !expanded.value;
}
</script>

<template>
  <view class="think-block">
    <view class="think-block__header" @tap="toggleExpanded">
      <text class="think-block__title" :class="{ 'think-block__title--complete': complete }">
        {{ complete ? 'Deep thinking finished' : 'Deep thinking...' }}
      </text>
      <image
        v-if="expanded"
        src="@/assets/img/icon-collapsed.svg"
        class="think-block__toggle-icon"
        mode="aspectFit"
      />
      <image
        v-else
        src="@/assets/img/icon-expand.svg"
        class="think-block__toggle-icon"
        mode="aspectFit"
      />
    </view>
    <view v-if="expanded" class="think-block__body">
      <MarkdownBlock :content="content" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.think-block { overflow: hidden; border: 1px solid #e4e9f0; border-radius: 20rpx; background: #fff; padding: 24rpx 32rpx; }
.think-block__header { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.think-block__title { color: #ff4d73; font-family: 'PingFang SC'; font-size: 28rpx; line-height: 44rpx; font-weight: 400; }
.think-block__title--complete { color: #b8b8b8; }
.think-block__toggle-icon { width: 30rpx; height: 30rpx; flex: 0 0 30rpx; }
.think-block__body { padding-top: 16rpx; }
.think-block ::v-deep .markdown-block,
.think-block ::v-deep .markdown-block p,
.think-block ::v-deep .markdown-block li,
.think-block ::v-deep .markdown-block ul,
.think-block ::v-deep .markdown-block ol,
.think-block ::v-deep .markdown-block blockquote,
.think-block ::v-deep .markdown-block pre,
.think-block ::v-deep .markdown-block code,
.think-block ::v-deep .markdown-block th,
.think-block ::v-deep .markdown-block td { color: #b8b8b8; font-family: 'PingFang SC'; font-size: 28rpx !important; line-height: 44rpx; font-weight: 400; }
</style>

<script setup>
import { computed } from "vue";

defineOptions({ name: "SuggestionBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});
const emit = defineEmits(["suggestion-tap"]);

const items = computed(() => Array.isArray(props.payload.items) ? props.payload.items : []);

function itemKey(item, index) {
  return item && item.id ? item.id : index;
}

function itemText(item) {
  return item && typeof item === "object" ? item.text || item.label || "" : item;
}

function onSuggestionTap(item) {
  const text = itemText(item);
  console.debug("[SuggestionBlock] tap", text);
  emit("suggestion-tap", text);
}
</script>

<template>
  <view v-if="items.length" class="suggestion-block">
    <text class="suggestion-block__title">
      你还可以继续问
    </text>
    <view v-for="(item, index) in items" :key="itemKey(item, index)" class="suggestion-block__item" @tap.stop="onSuggestionTap(item)">
      <text class="suggestion-block__text">
        {{ itemText(item) }}
      </text>
      <image src="@/assets/img/icon-right.png" mode="aspectFit" class="suggestion-block__arrow" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.suggestion-block { display: flex; flex-direction: column; gap: 12rpx; background: transparent; }
.suggestion-block__title { color: #bbc0c9; font-size: 28rpx; line-height: 48rpx; }
.suggestion-block__item { display: flex; align-items: center; justify-content: space-between; gap: 12rpx; padding: 12rpx 24rpx; border-radius: 8rpx; background: #f9f9f9; }
.suggestion-block__text { flex: 1; color: #5f6775; font-size: 24rpx; line-height: 36rpx; word-break: break-word; }
.suggestion-block__arrow { width: 16rpx; height: 16rpx; flex-shrink: 0; }
</style>

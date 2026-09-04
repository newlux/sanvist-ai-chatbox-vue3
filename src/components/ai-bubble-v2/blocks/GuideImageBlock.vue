<script setup lang="ts">
import { computed } from "vue";
import { normalizeGuideUrl, previewGuideImages } from "@/utils/guide-content";

defineOptions({ name: "GuideImageBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

const items = computed(() => (Array.isArray(props.payload?.items) ? props.payload.items : [])
  .map(item => ({
    ...item,
    url: normalizeGuideUrl(item?.url),
    caption: String(item?.caption || ""),
  }))
  .filter(item => item.url)
  .slice(0, 2));

function previewImage(current: string) {
  previewGuideImages(current, items.value.map(item => item.url));
}
</script>

<template>
  <view v-if="items.length" class="guide-image-block">
    <view v-for="item in items" :key="item.chunk_id || item.url" class="guide-image-block__item">
      <image
        class="guide-image-block__image"
        :src="item.url"
        mode="widthFix"
        @tap.stop="previewImage(item.url)"
      />
      <text v-if="item.caption" class="guide-image-block__caption">
        {{ item.caption }}
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.guide-image-block {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  width: 100%;
}
.guide-image-block__item {
  overflow: hidden;
  border-radius: 16rpx;
  background: #f6f6f6;
}
.guide-image-block__image {
  display: block;
  width: 100%;
  min-height: 240rpx;
  background: #eeeeee;
}
.guide-image-block__caption {
  display: block;
  padding: 12rpx 16rpx 16rpx;
  color: #666666;
  font-size: 24rpx;
  line-height: 34rpx;
}
</style>

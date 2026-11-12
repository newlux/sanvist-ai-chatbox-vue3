<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, unref } from "vue";
import { normalizeGuideUrl, previewGuideImages } from "@/utils/guide-content";

defineOptions({ name: "GuideImageBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

/** 深色：这张块在气泡内渲染，跟随气泡 provide 的主题（与 GuideLeadBlock / GuideStepBlock 同一套取法） */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => Boolean(bubbleDark ? unref(bubbleDark) : false));

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
  <view v-if="items.length" class="guide-image-block" :class="{ 'guide-image-block--dark': isDark }">
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

/* ===== 深色：跟随气泡主题（块底 6% 白、占位底更亮一档、次要文字 45% 白） ===== */
.guide-image-block--dark {
  .guide-image-block__item {
    background: rgba(255, 255, 255, 0.06);
  }

  .guide-image-block__image {
    background: rgba(255, 255, 255, 0.12);
  }

  .guide-image-block__caption {
    color: rgba(255, 255, 255, 0.45);
  }
}
</style>

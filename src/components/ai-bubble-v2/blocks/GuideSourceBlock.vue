<script setup lang="ts">
import { computed } from "vue";
import documentIcon from "@/assets/img/guide-source-document.svg";
import imageIcon from "@/assets/img/guide-source-image.svg";
import videoIcon from "@/assets/img/guide-source-video.svg";
import { normalizeGuideUrl, openGuideResource, previewGuideImages } from "@/utils/guide-content";

defineOptions({ name: "GuideSourceBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

const evidence = computed(() => (Array.isArray(props.payload?.evidence) ? props.payload.evidence : [])
  .map(item => ({
    ...item,
    fileType: String(item?.file_type || "DOCUMENT").toUpperCase(),
    fileName: String(item?.file_name || "查看来源"),
    url: normalizeGuideUrl(item?.url),
  }))
  .filter(item => item.url));

function typeIcon(fileType: string) {
  if (fileType === "IMAGE") return imageIcon;
  if (fileType === "VIDEO") return videoIcon;
  return documentIcon;
}

function onSourceTap(item: { fileType: string; url: string }) {
  if (item.fileType === "IMAGE") {
    previewGuideImages(
      item.url,
      evidence.value.filter(source => source.fileType === "IMAGE").map(source => source.url),
    );
    return;
  }
  openGuideResource(item.url);
}
</script>

<template>
  <view v-if="evidence.length" class="guide-source-block">
    <text class="guide-source-block__title">
      参考来源
    </text>
    <view
      v-for="item in evidence"
      :key="item.chunk_id || item.url"
      class="guide-source-block__item"
      @tap.stop="onSourceTap(item)"
    >
      <image
        class="guide-source-block__type-icon"
        :src="typeIcon(item.fileType)"
        mode="aspectFit"
      />
      <text class="guide-source-block__name">
        {{ item.fileName }}
      </text>
      <text class="guide-source-block__arrow">
        ›
      </text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.guide-source-block {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  width: 100%;
}
.guide-source-block__title {
  color: #999999;
  font-size: 24rpx;
  line-height: 34rpx;
}
.guide-source-block__item {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-height: 64rpx;
  padding: 8rpx 16rpx;
  border-radius: 8rpx;
  background: #f2f7ff;
}
.guide-source-block__type-icon {
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 36rpx;
}
.guide-source-block__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #58749b;
  font-size: 24rpx;
  line-height: 34rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.guide-source-block__arrow {
  flex: 0 0 auto;
  color: #8da3bf;
  font-size: 32rpx;
}
</style>

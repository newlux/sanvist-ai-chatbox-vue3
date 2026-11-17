<script setup lang="ts">
import { computed } from "vue";
import { normalizeGuideUrl } from "@/utils/guide-content";

defineOptions({ name: "GuideVideoBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

const url = computed(() => normalizeGuideUrl(props.payload?.url));
const poster = computed(() => normalizeGuideUrl(props.payload?.poster));
const caption = computed(() => String(props.payload?.caption || ""));
</script>

<template>
  <view v-if="url" class="guide-video-block">
    <video
      class="guide-video-block__video"
      :src="url"
      :poster="poster"
      :controls="true"
      object-fit="contain"
    />
    <text v-if="caption" class="guide-video-block__caption">
      {{ caption }}
    </text>
  </view>
</template>

<style lang="scss" scoped>
.guide-video-block {
  overflow: hidden;
  width: 100%;
  border-radius: 16rpx;
  background: #111111;
}
.guide-video-block__video {
  display: block;
  width: 100%;
  height: 360rpx;
  background: #000000;
}
.guide-video-block__caption {
  display: block;
  padding: 12rpx 16rpx 16rpx;
  color: #ffffff;
  font-size: 24rpx;
  line-height: 34rpx;
}
</style>

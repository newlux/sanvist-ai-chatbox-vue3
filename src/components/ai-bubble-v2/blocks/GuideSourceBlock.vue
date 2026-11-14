<script setup lang="ts">
import { computed, inject, unref } from "vue";
import type { Ref } from "vue";
import copyIcon from "@/assets/img/icon-action-copy.svg";
import documentIcon from "@/assets/img/guide-source-document.svg";
import imageIcon from "@/assets/img/guide-source-image.svg";
import videoIcon from "@/assets/img/guide-source-video.svg";
import { copyGuideResource, normalizeGuideUrl, openGuideResource, previewGuideImages } from "@/utils/guide-content";

defineOptions({ name: "GuideSourceBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
  /**
   * 深色覆盖：气泡内由 ai-bubble-dark provide 下来即够用；
   * 独立于气泡渲染（步骤卡 / 小结卡）时拿不到 provide，由外层显式传。
   */
  dark: { type: Boolean, default: false },
});

/** 深色开关由气泡 provide 下来（见 ai-bubble-v2 的 ai-bubble-dark），参考来源跟着整条回答切换 */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => props.dark || Boolean(bubbleDark ? unref(bubbleDark) : false));

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

/**
 * PDF 不直接打开：H5 里会整页跳走或触发下载，改为复制链接，由用户自己粘贴使用。
 * 后端 file_type 若统一给 DOCUMENT，就用地址后缀兜底判断。
 */
function isPdfSource(item: { fileType: string; url: string }) {
  if (item.fileType === "PDF") return true;
  return /\.pdf(\?|#|$)/i.test(item.url);
}

function onSourceTap(item: { fileType: string; url: string }) {
  if (item.fileType === "IMAGE") {
    // 所有 IMAGE 来源一起进预览，可左右切换；captions 用各来源的 file_name，
    // 让预览层在图片下方显示名称（与正文 GuideImageBlock 传 caption 的做法一致）
    const imageSources = evidence.value.filter(source => source.fileType === "IMAGE");
    previewGuideImages(
      item.url,
      imageSources.map(source => source.url),
      imageSources.map(source => source.fileName),
    );
    return;
  }
  if (isPdfSource(item)) {
    copyGuideResource(item.url);
    return;
  }
  openGuideResource(item.url);
}
</script>

<template>
  <view
    v-if="evidence.length"
    class="guide-source-block"
    :class="{ 'guide-source-block--dark': isDark }"
  >
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
      <!-- PDF 是复制动作，用复制图标替代跳转箭头，避免看起来像能直接打开 -->
      <image
        v-if="isPdfSource(item)"
        class="guide-source-block__copy-icon"
        :src="copyIcon"
        mode="aspectFit"
      />
      <text v-else class="guide-source-block__arrow">
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
  /* 与回答正文之间留一段：滚到「回复末尾」时这段留白正好让正文最后一行
     落在输入栏上方（参考来源整段被输入栏挡掉），不至于贴着输入栏 */
  margin-top: 32rpx;
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
/* 来源条目都是可点动作（打开 / 预览 / 复制），按下给一点反馈 */
.guide-source-block__item:active {
  opacity: 0.7;
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
/* 复制图标：与气泡底部动作栏的复制图标同尺寸（32rpx），占位与箭头一致 */
.guide-source-block__copy-icon {
  flex: 0 0 32rpx;
  width: 32rpx;
  height: 32rpx;
}

/* ===== 深色：参考来源整段跟着气泡走（标题 / 条目底 / 文字 / 图标一起换） ===== */
.guide-source-block--dark {
  .guide-source-block__title {
    color: rgba(255, 255, 255, 0.45);
  }

  .guide-source-block__item {
    background: rgba(255, 255, 255, 0.06);
  }

  .guide-source-block__name {
    color: rgba(255, 255, 255, 0.72);
  }

  .guide-source-block__arrow {
    color: rgba(255, 255, 255, 0.4);
  }

  /* 图标是固定色号的 svg（#6B7A90 / #9E9E9E），深底上整体提亮一档 */
  .guide-source-block__type-icon,
  .guide-source-block__copy-icon {
    filter: brightness(1.7);
  }
}
</style>

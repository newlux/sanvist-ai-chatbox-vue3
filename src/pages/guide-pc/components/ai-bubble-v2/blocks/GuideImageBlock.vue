<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, ref, unref } from "vue";
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
  .filter(item => item.url));

/** 是否多张连续图片：多图才用左右滑动 + 圆点指示的图片堆叠（不循环），单图保持简单样式 */
const isMultiple = computed(() => items.value.length > 1);

/** 轮播圆点：当前展示的索引，用于高亮圆点（区分是否堆叠图） */
const currentIndex = ref(0);

/** 当前页图片名称：放在 swiper 外部渲染，避免被固定高度裁切（名称可自由换行） */
const activeCaption = computed(() => items.value[currentIndex.value]?.caption || "");

function onSwiperChange(e: { detail: { current: number } }) {
  currentIndex.value = e.detail.current;
}

function previewImage(current: string) {
  previewGuideImages(
    current,
    items.value.map(item => item.url),
    items.value.map(item => item.caption),
  );
}
</script>

<template>
  <view v-if="items.length" class="guide-image-block" :class="{ 'guide-image-block--dark': isDark }">
    <!-- 多张连续图片：左右滑动切换（不循环，滑到最后一张不回首图），
         底部圆点指示当前图（区分是否堆叠图）；图片名称在图片外部左下角 -->
    <swiper
      v-if="isMultiple"
      class="guide-image-block__swiper"
      @change="onSwiperChange"
    >
      <swiper-item v-for="item in items" :key="item.chunk_id || item.url">
        <view class="guide-image-block__card" @tap.stop="previewImage(item.url)">
          <image class="guide-image-block__card-image" :src="item.url" mode="aspectFill" />
        </view>
      </swiper-item>
    </swiper>

    <!-- 图片名称：图片外部左下角，随滑动切换。
         放在 swiper 外部渲染（swiper 高度固定且 overflow:hidden），名称换行也不会被裁切。
         只在多图时渲染：单图走下方 v-else 的 caption，这里若也渲染会让单图出现上下两个标题 -->
    <text v-if="isMultiple && activeCaption" class="guide-image-block__card-caption">
      {{ activeCaption }}
    </text>

    <!-- 多图圆点指示器：标出是堆叠图及当前页 -->
    <view v-if="isMultiple" class="guide-image-block__dots">
      <view
        v-for="(item, i) in items"
        :key="i"
        class="guide-image-block__dot"
        :class="{ 'guide-image-block__dot--active': i === currentIndex }"
      />
    </view>

    <!-- 单张图片：保持简单样式（图 + 标题在下方） -->
    <template v-else>
      <view
        v-for="item in items"
        :key="item.chunk_id || item.url"
        class="guide-image-block__item"
        @tap.stop="previewImage(item.url)"
      >
        <image class="guide-image-block__image" :src="item.url" mode="widthFix" />
        <text v-if="item.caption" class="guide-image-block__caption">
          {{ item.caption }}
        </text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.guide-image-block {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  width: 100%;
}

/* ===== 多图图片堆叠（左右滑动切换，不循环，无圆点；图片名称在图片外部左下角） ===== */
.guide-image-block__swiper {
  width: 100%;
  height: 400rpx; /* 只包图片卡片；名称区在 swiper 外部，可自由换行不被裁切 */
  border-radius: 16rpx;
  overflow: hidden;
}

.guide-image-block__card {
  position: relative;
  width: 100%;
  height: 400rpx;
  overflow: hidden;
  border-radius: 16rpx;
  background: #2a2a2a;
}

.guide-image-block__card-image {
  display: block;
  width: 100%;
  height: 100%;
}

/* 图片名称：图片外部左下角（卡片下方，左对齐），随滑动切换。
   顶部间距由 .guide-image-block 的 flex gap 提供，不再加 padding，换行时整体自然下移 */
.guide-image-block__card-caption {
  display: block;
  padding: 0 4rpx;
  color: #666666;
  font-size: 24rpx;
  line-height: 34rpx;
  text-align: left;
}

/* 多图圆点指示器：标出是堆叠图及当前页（区别于单图） */
.guide-image-block__dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  height: 24rpx;
}

.guide-image-block__dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.2);
  transition: background 0.2s, transform 0.2s;
}

.guide-image-block__dot--active {
  background: rgba(0, 0, 0, 0.65);
  transform: scale(1.25);
}

/* ===== 单图简单样式 ===== */
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

  .guide-image-block__caption,
  .guide-image-block__card-caption {
    color: rgba(255, 255, 255, 0.45);
  }

  .guide-image-block__dot {
    background: rgba(255, 255, 255, 0.3);
  }

  .guide-image-block__dot--active {
    background: rgba(255, 255, 255, 0.9);
  }
}
</style>

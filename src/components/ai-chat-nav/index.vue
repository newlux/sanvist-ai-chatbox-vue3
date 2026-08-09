<script setup>
import { computed } from "vue";
import iconForm from "@/assets/img/icon-form.svg";
import iconHelp from "@/assets/img/icon-help.svg";
import iconInsight from "@/assets/img/icon-insight.svg";
import iconVox from "@/assets/img/icon-vox.svg";

defineOptions({
  name: "AiChatNav",
});

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  visible: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["item-click"]);

const navItems = computed(() => {
  if (Array.isArray(props.items) && props.items.length) {
    return props.items;
  }

  return [
    {
      key: "vox-core",
      title: "AI 听播",
      desc: "日报语音播报",
      icon: iconVox,
    },
    {
      key: "slide-insight",
      title: "AI 闪鉴",
      desc: "项目洞察助手",
      icon: iconInsight,
    },
    {
      key: "fix-master-ai",
      title: "维修助手",
      desc: "快捷故障排查",
      icon: iconHelp,
    },
    {
      key: "ai-form",
      title: "AI 表单",
      desc: "语音填单",
      icon: iconForm,
    },
  ];
});

function onItemTap(item) {
  emit("item-click", item);
}
</script>

<template>
  <view v-if="visible" class="ai-chat-nav">
    <swiper
      class="ai-chat-nav__swiper"
      :indicator-dots="false"
      :autoplay="false"
      :circular="false"
      :display-multiple-items="3"
      previous-margin="24rpx"
      next-margin="24rpx"
    >
      <swiper-item v-for="item in navItems" :key="item.key">
        <view class="ai-chat-nav__slide">
          <view class="ai-chat-nav__card" @tap="onItemTap(item)">
            <view class="ai-chat-nav__card-header">
              <image
                class="ai-chat-nav__icon"
                :src="item.icon"
                mode="aspectFit"
              />
              <text class="ai-chat-nav__title">
                {{ item.title }}
              </text>
            </view>
            <text class="ai-chat-nav__desc">
              {{ item.desc }}
            </text>
          </view>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-nav {
  position: relative;
  z-index: 2;
  width: 100%;
  box-sizing: border-box;
  padding: 16rpx 0;
}

.ai-chat-nav__swiper {
  width: 100%;
  height: 144rpx;
}

.ai-chat-nav__slide {
  height: 100%;
  padding-right: 16rpx;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.ai-chat-nav__card {
  width: 100%;
  min-height: 112rpx;
  padding: 16rpx 24rpx;
  border-radius: 16rpx;
  box-sizing: border-box;
  background: #ffffff;
  display: inline-flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8rpx;
  box-shadow: inset 0 0 0 2rpx rgba(0, 0, 0, 0.05);
}

.ai-chat-nav__card-header {
  width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
}

.ai-chat-nav__icon {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
}

.ai-chat-nav__title {
  flex: 1;
  min-width: 0;
  color: #1f2937;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 32rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-chat-nav__desc {
  width: 100%;
  color: #5f6775;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 32rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

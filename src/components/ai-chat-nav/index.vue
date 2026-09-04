<script setup lang="ts">
import { computed } from "vue";
import iconForm from "@/assets/img/icon-form.svg";
import iconHelp from "@/assets/img/icon-help.svg";
import iconVox from "@/assets/img/icon-vox.svg";

/** 快捷入口。mode=page 另开专属页面（url 指向对应场景页） */
export interface NavItem {
  key: string;
  title: string;
  icon: string;
  subagent?: string;
  mode?: "page" | "inline";
  /** mode=page 时跳转的目标页面 */
  url?: string;
}

defineOptions({
  name: "AiChatNav",
});

const props = defineProps({
  items: {
    type: Array as () => NavItem[],
    default: () => [],
  },
  visible: {
    type: Boolean,
    default: true,
  },
  /** 当前高亮的智能体（如作业指导页进入即高亮「作业指导」入口） */
  activeKey: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["item-click"]);

const navItems = computed(() => {
  if (Array.isArray(props.items) && props.items.length) {
    return props.items;
  }

  // 三个入口都另开专属页面：听汇报 / 作业指导 / 任务协同
  return [
    {
      key: "vox-core",
      title: "听汇报",
      icon: iconVox,
      subagent: "report",
      mode: "page",
      url: "/pages/podcast/index",
    },
    {
      key: "fix-master-ai",
      title: "作业指导",
      icon: iconHelp,
      subagent: "guide",
      mode: "page",
      url: "/pages/guide/index",
    },
    {
      key: "ai-form",
      title: "任务协同",
      icon: iconForm,
      subagent: "task",
      mode: "page",
      url: "/pages/task/index",
    },
  ];
});

const navPages = computed(() => {
  const pages = [];
  for (let index = 0; index < navItems.value.length; index += 3) {
    pages.push(navItems.value.slice(index, index + 3));
  }
  return pages;
});

function onItemTap(item: NavItem) {
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
    >
      <swiper-item v-for="(page, pageIndex) in navPages" :key="pageIndex">
        <view class="ai-chat-nav__row">
          <view
            v-for="item in page"
            :key="item.key"
            class="ai-chat-nav__chip"
            :class="{ 'ai-chat-nav__chip--active': item.key === activeKey }"
            @tap="onItemTap(item)"
          >
            <image class="ai-chat-nav__icon" :src="item.icon" mode="aspectFit" />
            <text class="ai-chat-nav__title">
              {{ item.title }}
            </text>
          </view>
        </view>
      </swiper-item>
    </swiper>
  </view>
</template>

<style lang="scss" scoped>
.ai-chat-nav {
  position: fixed;
  right: 0;
  left: 0;
  z-index: 1;
  width: 100%;
  box-sizing: border-box;
}

.ai-chat-nav__row {
  display: flex;
  min-width: 0;
  height: 72rpx;
  align-items: center;
  gap: 16rpx;
  padding: 0 40rpx;
}

.ai-chat-nav__row .ai-chat-nav__chip {
  flex: 1 1 0;
  min-width: 0;
}

.ai-chat-nav__swiper {
  width: 100%;
  height: 72rpx;
}

.ai-chat-nav__chip {
  display: flex;
  width: 100%;
  height: 72rpx;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  padding: 0 24rpx;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  background: #fff;
  white-space: nowrap;
}

// 高亮的智能体入口：当前页对应的场景项（如作业指导页）
.ai-chat-nav__chip--active {
  border-color: #fe0000;
  background: #fff2f3;
}

.ai-chat-nav__chip--active .ai-chat-nav__icon {
  filter: brightness(0) saturate(100%) invert(11%) sepia(99%) saturate(6668%) hue-rotate(358deg) brightness(105%) contrast(113%);
}

.ai-chat-nav__chip--active .ai-chat-nav__title {
  color: #fe0000;
  font-weight: 600;
}

.ai-chat-nav__icon {
  width: 32rpx;
  height: 32rpx;
  flex-shrink: 0;
}

.ai-chat-nav__title {
  min-width: 0;
  overflow: hidden;
  color: #1a1a1a;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 32rpx;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

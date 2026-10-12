<script setup lang="ts">
import { computed, ref } from "vue";
import iconForm from "@/assets/img/icon-form.svg";
import iconHelp from "@/assets/img/icon-help.svg";
import iconRepair from "@/assets/img/icon-repair.svg";
import iconVox from "@/assets/img/icon-vox.svg";
import arrowLeftIcon from "@/assets/img/nav-arrow-left.svg";
import arrowRightIcon from "@/assets/img/nav-arrow-right.svg";
import { usePcMode } from "@/hooks/usePcMode";

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

/** swiper 同屏展示的入口数量，与模板 display-multiple-items 保持一致 */
const VISIBLE_ITEM_COUNT = 3;

const { isPc } = usePcMode();
/** 当前首个可见项下标：交给 swiper 的 current 做受控滑动（箭头点击 / 手势滑动都改它） */
const currentIndex = ref(0);

const navItems = computed(() => {
  if (Array.isArray(props.items) && props.items.length) {
    return props.items;
  }

  // 四个入口都另开专属页面：听汇报 / 作业指导 / 故障维修 / 任务协同
  const defaultItems: NavItem[] = [
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
      // 先进讲解模式选择页（新老手），选完由该页 redirect 到作业指导
      url: "/pages/users/index",
    },
    {
      key: "repair-master-ai",
      title: "维修助手",
      icon: iconRepair,
      subagent: "repair",
      mode: "page",
      url: "/pages/repair/index",
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
  return defaultItems;
});

function onItemTap(item: NavItem) {
  emit("item-click", item);
}

/** 首个可见项的最大下标：同屏 3 个，末尾 3 个对齐后就到头了 */
const maxIndex = computed(() => Math.max(0, navItems.value.length - VISIBLE_ITEM_COUNT));
/** PC 端专用左右尖括号：非 PC 不渲染；入口本来就装得下一屏时也无需渲染 */
const showArrows = computed(() => isPc.value && maxIndex.value > 0);
const canGoPrev = computed(() => currentIndex.value > 0);
const canGoNext = computed(() => currentIndex.value < maxIndex.value);

/** 手势滑动后同步下标，箭头可用态才能跟着更新 */
function onSwiperChange(event: { detail?: { current?: number } }) {
  const next = Number(event?.detail?.current);
  if (!Number.isFinite(next)) return;
  currentIndex.value = Math.max(0, Math.min(maxIndex.value, next));
}

/** 点尖括号：按一个入口宽度滑动过来 */
function onArrowTap(step: number) {
  const next = currentIndex.value + step;
  if (next < 0 || next > maxIndex.value) return;
  currentIndex.value = next;
}
</script>

<template>
  <view v-if="visible" class="ai-chat-nav">
    <view class="ai-chat-nav__track">
      <swiper
        class="ai-chat-nav__swiper"
        :indicator-dots="false"
        :autoplay="false"
        :circular="false"
        :display-multiple-items="VISIBLE_ITEM_COUNT"
        :current="currentIndex"
        previous-margin="40rpx"
        next-margin="80rpx"
        @change="onSwiperChange"
      >
        <swiper-item v-for="item in navItems" :key="item.key">
          <view class="ai-chat-nav__item">
            <view
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
      <!-- PC 端专用：点尖括号把入口滑过来；APP / 移动端不渲染，保持触摸滑动 -->
      <template v-if="showArrows">
        <view
          class="ai-chat-nav__arrow ai-chat-nav__arrow--prev"
          :class="{ 'ai-chat-nav__arrow--disabled': !canGoPrev }"
          @tap.stop="onArrowTap(-1)"
        >
          <image class="ai-chat-nav__arrow-icon" :src="arrowLeftIcon" mode="aspectFit" />
        </view>
        <view
          class="ai-chat-nav__arrow ai-chat-nav__arrow--next"
          :class="{ 'ai-chat-nav__arrow--disabled': !canGoNext }"
          @tap.stop="onArrowTap(1)"
        >
          <image class="ai-chat-nav__arrow-icon" :src="arrowRightIcon" mode="aspectFit" />
        </view>
      </template>
    </view>
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
  background: #fafafa;
  padding-top: 16rpx;
}

// 滑动轨道：swiper 铺满，左右尖括号绝对定位浮在两端
.ai-chat-nav__track {
  position: relative;
}

.ai-chat-nav__swiper {
  width: 100%;
  height: 72rpx;
}

// PC 端左右尖括号（只有 isPc 且入口可滑动时才挂载）：圆形按钮，浮在两侧边缘的
// 半露入口之上，与 chip 用同一档描边保持视觉一致
.ai-chat-nav__arrow {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: flex;
  width: 44rpx;
  height: 44rpx;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  border: 1px solid #efefef;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
  transform: translateY(-50%);
}

.ai-chat-nav__arrow--prev {
  left: 8rpx;
}

.ai-chat-nav__arrow--next {
  right: 8rpx;
}

// 到头了：变淡但仍可点（点了走空，避免误触抖动）
.ai-chat-nav__arrow--disabled {
  opacity: 0.32;
}

.ai-chat-nav__arrow-icon {
  width: 24rpx;
  height: 24rpx;
}

.ai-chat-nav__item {
  height: 72rpx;
  padding-right: 16rpx;
  box-sizing: border-box;
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

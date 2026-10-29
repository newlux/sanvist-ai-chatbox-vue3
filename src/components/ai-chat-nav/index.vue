<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import iconForm from "@/assets/img/icon-form.svg";
import iconHelp from "@/assets/img/icon-help.svg";
import iconParts from "@/assets/img/icon-parts.svg";
import iconRepair from "@/assets/img/icon-repair.svg";
import iconVox from "@/assets/img/icon-vox.svg";
import { usePcMode } from "@/hooks/usePcMode";

/** 快捷入口。mode=page 另开专属页面（url 指向对应场景页） */
export interface NavItem {
  key: string;
  /** 外部传入的固定文案（不随语言切换）；内置入口改用 titleKey */
  title?: string;
  /** 内置入口的 i18n key，渲染时按当前语言取文案 */
  titleKey?: string;
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

const { t } = useI18n();

/** swiper 同屏展示的入口数量，与模板 display-multiple-items 保持一致 */
const VISIBLE_ITEM_COUNT = 3;

const { isPc } = usePcMode();
/** 当前首个可见项下标：交给 swiper 的 current 做受控滑动（手势滑动改它） */
const currentIndex = ref(0);

// 入口：听汇报 / 作业指导 / 任务协同 / 维修助手 / 配件助手（配件助手暂为首页内联，其余另开专属页）
const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    key: "vox-core",
    titleKey: "nav-report",
    icon: iconVox,
    subagent: "report",
    mode: "page",
    url: "/pages/podcast/index",
  },
  {
    key: "fix-master-ai",
    titleKey: "nav-guide",
    icon: iconHelp,
    subagent: "guide",
    mode: "page",
    // 先选体验的设备（独立页），再进讲解模式选择页（新老手），最后进作业指导
    url: "/pages/guide-init/index",
  },
  {
    key: "ai-form",
    titleKey: "nav-task",
    icon: iconForm,
    subagent: "task",
    mode: "page",
    url: "/pages/task-init/index",
  },
  {
    key: "repair-master-ai",
    titleKey: "nav-repair",
    icon: iconRepair,
    subagent: "repair",
    mode: "page",
    url: "/pages/repair/index",
  },
  {
    key: "parts-master-ai",
    titleKey: "nav-parts",
    icon: iconParts,
    subagent: "parts",
    // 配件助手暂时没有独立页面：先作为首页内联智能体挂上去（点击切换 / 高亮，
    // 后续提问带上 subagent=parts）。等配件页就绪，改成 mode: "page" + url 即可，
    // 点击分发在 index 页的 onNavItemClick 里，不用另写。
    mode: "inline",
  },
];

/** PC 端不展示的底部入口：作业指导只在 APP 端保留。 */
const PC_HIDDEN_NAV_KEYS = new Set(["fix-master-ai"]);

const navItems = computed(() => {
  const items = Array.isArray(props.items) && props.items.length
    ? props.items
    : DEFAULT_NAV_ITEMS;

  // 仅 PC 端收起「作业指导」；APP 容器与手机浏览器 isPc=false，菜单保持原样
  if (!isPc.value) return items;
  return items.filter(item => !PC_HIDDEN_NAV_KEYS.has(item.key));
});

function onItemTap(item: NavItem) {
  emit("item-click", item);
}

/** 首个可见项的最大下标：同屏 3 个，末尾 3 个对齐后就到头了 */
const maxIndex = computed(() => Math.max(0, navItems.value.length - VISIBLE_ITEM_COUNT));

// 入口数量变化（如 PC 端收起「作业指导」）后把下标收进合法范围，避免 swiper 停在空档
watch(maxIndex, (value) => {
  if (currentIndex.value > value) currentIndex.value = Math.max(0, value);
});

/** 手势滑动后同步下标 */
function onSwiperChange(event: { detail?: { current?: number } }) {
  const next = Number(event?.detail?.current);
  if (!Number.isFinite(next)) return;
  currentIndex.value = Math.max(0, Math.min(maxIndex.value, next));
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
                {{ item.titleKey ? t(item.titleKey) : item.title }}
              </text>
            </view>
          </view>
        </swiper-item>
      </swiper>
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

// 滑动轨道：swiper 铺满
.ai-chat-nav__track {
  position: relative;
}

.ai-chat-nav__swiper {
  width: 100%;
  height: 72rpx;
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

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import iconForm from "@/assets/img/icon-form.svg";
import iconHelp from "@/assets/img/icon-help.svg";
import iconParts from "@/assets/img/icon-parts.svg";
import iconRepair from "@/assets/img/icon-repair.svg";
import iconVox from "@/assets/img/icon-vox.svg";
import { PARTS_ASSISTANT_EMBED_URL } from "@/config";
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
  /**
   * 深色主题（首页问答态 Ardot 1193:2097）：容器 722:341 用页面底 #1A1A1A，
   * 入口胶囊换 #212121 + 1px #303030（与早报卡 1193:2101 同一套材质）。
   * 默认关 —— 任务协同页也复用这条导航，那边还是浅色稿。
   */
  dark: {
    type: Boolean,
    default: false,
  },
  /**
   * 随文档流排列（首页初始页「Hey,SANI」欢迎层里用）：
   * 不 fixed、不吃 bottom 偏移，由父级 flex 列把它排在输入条上方；
   * 对话页仍用默认的 fixed 定位（按输入栏实测高度贴上去）。
   */
  flow: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["item-click"]);

const { t } = useI18n();

const { isPc } = usePcMode();

// 入口：听汇报 / 作业指导 / 任务协同 / 维修助手 / 配件助手，全部另开专属场景页
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
    // 直达作业指导对话页；引导页 /pages/guide-init/index 保留，但不再作为入口
    url: "/pages/guide/index",
  },
  {
    key: "ai-form",
    titleKey: "nav-task",
    icon: iconForm,
    subagent: "task",
    mode: "page",
    // 直达任务协同对话页；引导页 /pages/task-init/index 保留，但不再作为入口
    url: "/pages/task/index",
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
    // 与维修助手一致：另开独立场景页 /pages/parts/index，由该页全屏内嵌三方 H5
    mode: "page",
    url: `/pages/parts/index?url=${encodeURIComponent(PARTS_ASSISTANT_EMBED_URL)}`,
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
</script>

<template>
  <view
    v-if="visible"
    class="ai-chat-nav"
    :class="{ 'ai-chat-nav--dark': dark, 'ai-chat-nav--flow': flow }"
  >
    <!-- 横向滚动而不是等分 swiper：胶囊宽度跟文案走，英文（Guidance 等）不会被截断 -->
    <scroll-view class="ai-chat-nav__scroll" scroll-x :show-scrollbar="false">
      <view class="ai-chat-nav__list">
        <view
          v-for="item in navItems"
          :key="item.key"
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
    </scroll-view>
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

/* 随文档流：初始页欢迎层里由父级 flex 列排布，不再贴视口底部 */
.ai-chat-nav--flow {
  position: static;
}

// 滑动轨道：横向滚动，内容宽度由胶囊自己决定（不再等分屏宽）
.ai-chat-nav__scroll {
  width: 100%;
  height: 72rpx;
  white-space: nowrap;
}

.ai-chat-nav__list {
  display: inline-flex;
  height: 72rpx;
  box-sizing: border-box;
  align-items: center;
  padding: 0 20rpx;
}

.ai-chat-nav__chip {
  display: inline-flex;
  flex: 0 0 auto;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  height: 72rpx;
  margin-right: 16rpx;
  padding: 0 24rpx;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  background: #fff;
  white-space: nowrap;
}

// 末项右侧不留多余间距，滑到底就是最后一个胶囊
.ai-chat-nav__chip:last-child {
  margin-right: 0;
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

// 文案不做省略号：胶囊宽度跟着文字走，长词（Guidance / Reports 等）也能整词显示
.ai-chat-nav__title {
  flex: 0 0 auto;
  color: #1a1a1a;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 32rpx;
  white-space: nowrap;
}

/* ===== 深色主题：底部入口菜单（Ardot 1193:2097） =====
   深色稿没有单独画这条导航，按同一套暗色梯度推：
   容器跟页面底 #1A1A1A，入口胶囊与早报卡 1193:2101 同材质（#212121 + 1px #303030），
   高亮态沿用品牌红（描边红 + 8% 红底）。尺寸 / 间距不动 */
.ai-chat-nav--dark {
  background: #1a1a1a;

  .ai-chat-nav__chip {
    border-color: #303030;
    background: #212121;
  }

  .ai-chat-nav__title {
    color: #ffffff;
  }

  // 入口图标都是深色线条，深底下反相成白
  .ai-chat-nav__icon {
    filter: invert(1);
  }

  // 高亮态：红色描边 + 暗红底，图标用回浅色稿那颗红色 filter（见上）
  .ai-chat-nav__chip--active {
    border-color: #fe0000;
    background: rgba(254, 0, 0, 0.12);
  }

  .ai-chat-nav__chip--active .ai-chat-nav__title {
    color: #fe0000;
  }

  // 高亮图标要在反相之后覆盖回来，否则白底红字的入口配一颗白图标
  .ai-chat-nav__chip--active .ai-chat-nav__icon {
    filter: brightness(0) saturate(100%) invert(11%) sepia(99%) saturate(6668%) hue-rotate(358deg) brightness(105%) contrast(113%);
  }
}
</style>

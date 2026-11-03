<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
// 顶部状态胶囊里的三角图标：换成动态 GIF（原 header-status-logo.png 的动画版）
// 以 22×22 展示，专用小图 96×85 / 150 帧 / 约 430KB，不必拉 300px 的大图
import headerStatusLogo from "@/assets/img/sani-logo-sm.gif";
import minimizeIcon from "@/assets/img/min_icon.png";
import menuHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import menuPreferenceIcon from "@/assets/img/report-broadcast/icon-fav-setting.svg";
import menuRateIcon from "@/assets/img/report-broadcast/icon-podcast-rate.svg";
import moreIcon from "@/assets/img/report-broadcast/icon-show-more.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";
import closeDarkIcon from "@/assets/img/voice-assistant/voice-back-dark.svg";
import { useSystemStore } from "@/stores";

const props = defineProps<{
  status: string;
  qaVisible: boolean;
  active: boolean;
  /** 是否展示品牌图标（播放中 / 已暂停 / 准备中 / 播报失败）；动效只跟 active 走 */
  withIcon?: boolean;
  /** iframe 内嵌（from=sanvist_pc）时，右侧额外露出「最小化」 */
  canMinimize?: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
  minimize: [];
  "open-history": [];
  "open-preference": [];
  "open-rate": [];
}>();

/** 播放中 / 已暂停 / 准备中 / 播报失败都带品牌图标，保证胶囊形态一致；流光只给播放中 */
const showStatusLogo = computed(() => props.active || Boolean(props.withIcon));

const menuVisible = ref(false);
const { t } = useI18n();
/**
 * 外观：深色走 C 方案暗色稿 1193:2708「听播-正在播放」与 1193:1864「点击功能件-中途提问」。
 * 只换材质：状态胶囊底 / 字、功能件菜单卡、图标反白；尺寸、位置、流光动效一律不动。
 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);

/** 展开菜单三项：图标均取自设计稿，行为沿用宿主页已有事件。 */
const menuItems = [
  { key: "history", labelKey: "broadcast-menu-history", icon: menuHistoryIcon },
  { key: "preference", labelKey: "broadcast-menu-preference", icon: menuPreferenceIcon },
  { key: "rate", labelKey: "broadcast-menu-rate", icon: menuRateIcon },
] as const;

function onClose() {
  menuVisible.value = false;
  emit("dismiss-qa");
}

function toggleMenu() {
  menuVisible.value = !menuVisible.value;
}

/** 选中态由点击决定，点哪个哪个选中，不写死某一项。 */
const selectedKey = ref<string | null>(null);

/** 设计稿里那行的浅灰底还包含按下态，view 上没有 :active，用 touch 事件补即时反馈。 */
const pressedKey = ref<string | null>(null);

function onMenuSelect(key: (typeof menuItems)[number]["key"]) {
  selectedKey.value = key;
  menuVisible.value = false;
  if (key === "history") emit("open-history");
  else if (key === "preference") emit("open-preference");
  else emit("open-rate");
}

function onItemTouchStart(key: string) {
  pressedKey.value = key;
}

function onItemTouchEnd() {
  pressedKey.value = null;
}
</script>

<template>
  <view class="report-broadcast-header" :class="{ 'report-broadcast-header--dark': isDark }">
    <view class="report-broadcast-header__close" @tap="qaVisible ? onClose() : emit('exit-report')">
      <!-- 返回箭头：浅色描边 #0D0D0D，深色稿（1193:1864 左上角）描边 #FFFFFF -->
      <image
        class="report-broadcast-header__icon"
        :src="isDark ? closeDarkIcon : closeIcon"
        mode="aspectFit"
      />
    </view>
    <view
      class="report-broadcast-header__status"
      :class="{ 'report-broadcast-header__status--with-icon': showStatusLogo }"
    >
      <!-- 播放中：与首页「正在回答」同款流光描边；已暂停只留图标，不出动效 -->
      <view v-if="active" class="report-broadcast-header__status-border" />
      <image
        v-if="showStatusLogo"
        class="report-broadcast-header__status-logo"
        :src="headerStatusLogo"
        mode="aspectFit"
      />
      <text>{{ status }}</text>
    </view>
    <view class="report-broadcast-header__actions">
      <view v-if="props.canMinimize" class="report-broadcast-header__minimize" @tap="emit('minimize')">
        <image class="report-broadcast-header__minimize-icon" :src="minimizeIcon" mode="aspectFit" />
      </view>
      <view class="report-broadcast-header__more" @tap.stop="toggleMenu">
        <image class="report-broadcast-header__more-icon" :src="moreIcon" mode="aspectFit" />
      </view>
    </view>
  </view>
  <!-- 播放器 overflow:hidden，菜单必须传送到 body，否则点「偏好设置」会打在头像上。 -->
  <Teleport to="body">
    <view
      v-if="menuVisible"
      class="report-broadcast-header__menu-mask"
      @tap="menuVisible = false"
    >
      <view
        class="report-broadcast-header__menu"
        :class="{ 'report-broadcast-header__menu--dark': isDark }"
        @tap.stop
      >
        <view
          v-for="item in menuItems"
          :key="item.key"
          class="report-broadcast-header__menu-item"
          :class="{ 'report-broadcast-header__menu-item--active': selectedKey === item.key || pressedKey === item.key }"
          @touchstart="onItemTouchStart(item.key)"
          @touchend="onItemTouchEnd"
          @touchcancel="onItemTouchEnd"
          @tap.stop="onMenuSelect(item.key)"
        >
          <image class="report-broadcast-header__menu-icon" :src="item.icon" mode="aspectFit" />
          <text class="report-broadcast-header__menu-label">
            {{ t(item.labelKey) }}
          </text>
        </view>
      </view>
    </view>
  </Teleport>
</template>

<style scoped lang="scss">
.report-broadcast-header {
  position: relative;
  z-index: 5;
  box-sizing: border-box;
  display: flex;
  flex: 0 0 100rpx;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 100rpx;
  padding: 0 38rpx;
}
.report-broadcast-header__close,
.report-broadcast-header__more,
.report-broadcast-header__minimize {
  display: flex;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__actions {
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.report-broadcast-header__icon,
.report-broadcast-header__more-icon {
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__minimize-icon {
  width: 40rpx;
  height: 40rpx;
}
.report-broadcast-header__menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.report-broadcast-header__menu {
  position: absolute;
  top: calc(var(--safe-top-px, 0px) + 112rpx);
  right: 38rpx;
  box-sizing: border-box;
  width: 320rpx;
  padding: 12rpx;
  overflow: hidden;
  background: #ffffff;
  border-radius: 16rpx;
  box-shadow: 0 8rpx 24rpx rgb(0 0 0 / 8%);
}
.report-broadcast-header__menu-item {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  height: 76rpx;
  padding: 0 28rpx;
  border-radius: 12rpx;
}
.report-broadcast-header__menu-item--active {
  background: #f6f6f6;
}
.report-broadcast-header__menu-icon {
  flex: 0 0 24rpx;
  width: 24rpx;
  height: 24rpx;
}
.report-broadcast-header__menu-label {
  margin-left: 24rpx;
  font-size: 28rpx;
  line-height: 1;
  color: #1a1a1a;
}
.report-broadcast-header__status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 158rpx;
  height: 72rpx;
  overflow: hidden;
  font-size: 28rpx;
  font-weight: 500;
  color: #1a1a1a;
  background: rgb(255 255 255 / 90%);
  border-radius: 36rpx;
  box-shadow: 0 4rpx 16rpx rgb(237 26 26 / 9%);
  backdrop-filter: blur(32rpx);
}
/*
 * 播放中胶囊：与首页「正在回答」同一套视觉
 * - 品牌图标 22×22 + 6px 间距，宽度改为 hug（原固定 158rpx）
 * - 流光描边：1.5px 线性渐变环，背景取 2 倍宽度并向左位移一个周期，首尾同色无缝循环
 */
.report-broadcast-header__status--with-icon {
  position: relative;
  box-sizing: border-box;
  width: auto;
  gap: 12rpx;
  padding: 0 28rpx;
  overflow: hidden;
  box-shadow: 0 4rpx 16rpx rgb(0 0 0 / 8%);
}

.report-broadcast-header__status-border {
  position: absolute;
  z-index: 0;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 3rpx; // 1.5px 描边宽度
  border-radius: 36rpx;
  background-image: linear-gradient(
    135deg,
    #9197ea 0%,
    #4392e4 16.515%,
    #e3f1ff 24.42%,
    #f8fbff 50%,
    #e3f1ff 75.58%,
    #4392e4 83.485%,
    #9197ea 100%
  );
  background-size: 200% 100%;
  animation: report-broadcast-capsule-flow 4s linear infinite;
  will-change: background-position;
  /* 先写标准属性、再用 -webkit- 兜底：老 WebView 只认前缀版本 */
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  pointer-events: none;
}

/* 图标与文字压在描边环之上 */
.report-broadcast-header__status--with-icon > *:not(.report-broadcast-header__status-border) {
  position: relative;
  z-index: 1;
}

.report-broadcast-header__status-logo {
  width: 44rpx;
  height: 44rpx;
  flex: 0 0 44rpx;
}

@keyframes report-broadcast-capsule-flow {
  from {
    background-position: 0% 50%;
  }
  to {
    background-position: 200% 50%;
  }
}

/* 系统偏好减少动效时停在设计稿的静态渐变 */
@media (prefers-reduced-motion: reduce) {
  .report-broadcast-header__status-border {
    animation: none;
  }
}

/* ===== 深色主题：播报头部（Ardot 1193:2708 / 1193:1864）=====
   浅色稿（339:1359 系列）只给了一套白材质，深色按 C 方案暗色稿同位置节点逐项对应：
   - 状态胶囊 1193:2797：底 #0D0D0D 90%，文案 #FFFFFF，外发光 0 3px 12px 3px rgba(255,255,255,0.17)
   - 关闭 / 更多：白线（1193:1979 返回箭头、右上角更多），原图标是深色，反相处理
   胶囊宽高、圆角、流光描边环与浅色稿完全一致，不因换色改动 */
.report-broadcast-header--dark {
  .report-broadcast-header__status {
    color: #ffffff;
    background: rgb(13 13 13 / 90%);
    box-shadow: 0 6rpx 24rpx 6rpx rgb(255 255 255 / 17%);
  }

  .report-broadcast-header__more-icon,
  .report-broadcast-header__minimize-icon {
    filter: brightness(0) invert(1);
  }
}

/* ===== 深色主题：功能件菜单（Ardot 1193:1864「点击功能件-中途提问」Group 75）=====
   - 菜单卡 1193:1920：#303030 / r8 / 阴影 0 -2px 21px rgba(0,0,0,0.06)
   - 选中行 1193:1921：#212121 / r6（比卡片再压一阶，靠明度差区分选中态）
   - 文案 1193:1936 / 1193:1923 / 1193:1914：#FFFFFF 14px；图标同为白色线性图标 */
.report-broadcast-header__menu--dark {
  background: #303030;
  box-shadow: 0 -4rpx 42rpx rgb(0 0 0 / 6%);

  .report-broadcast-header__menu-item--active {
    background: #212121;
  }

  .report-broadcast-header__menu-label {
    color: #ffffff;
  }

  .report-broadcast-header__menu-icon {
    filter: brightness(0) invert(1);
  }
}
</style>

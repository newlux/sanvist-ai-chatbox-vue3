<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import minimizeIcon from "@/assets/img/min_icon.png";
import menuHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import menuPreferenceIcon from "@/assets/img/report-broadcast/icon-fav-setting.svg";
import menuRateIcon from "@/assets/img/report-broadcast/icon-podcast-rate.svg";
import moreIcon from "@/assets/img/report-broadcast/icon-show-more.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";
import closeDarkIcon from "@/assets/img/voice-assistant/voice-back-dark.svg";
import { useSystemStore } from "@/stores";

const props = defineProps<{
  /** 顶部状态胶囊已去掉，status / active / withIcon 仅为父级 props 兼容保留 */
  status?: string;
  qaVisible: boolean;
  active?: boolean;
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

const menuVisible = ref(false);
const { t } = useI18n();
/**
 * 外观：深色走 C 方案暗色稿 1193:2708「听播-正在播放」与 1193:1864「点击功能件-中途提问」。
 * 只换材质：功能件菜单卡、图标反白；尺寸、位置一律不动。
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
    <!-- 顶部中间的状态胶囊（灵动岛）已按需求去掉：头部只留返回 + 右上角功能件 -->
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
/* ===== 深色主题：播报头部（Ardot 1193:2708 / 1193:1864）=====
   浅色稿（339:1359 系列）只给了一套白材质，深色按 C 方案暗色稿同位置节点逐项对应：
   - 关闭 / 更多：白线（1193:1979 返回箭头、右上角更多），原图标是深色，反相处理 */
.report-broadcast-header--dark {
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

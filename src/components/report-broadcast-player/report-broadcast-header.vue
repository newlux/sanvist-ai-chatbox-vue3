<script setup lang="ts">
import { ref } from "vue";
import menuHistoryIcon from "@/assets/img/report-broadcast/feedback-history.svg";
import menuPreferenceIcon from "@/assets/img/report-broadcast/icon-fav-setting.svg";
import menuRateIcon from "@/assets/img/report-broadcast/icon-podcast-rate.svg";
import moreIcon from "@/assets/img/report-broadcast/icon-show-more.svg";
import closeIcon from "@/assets/img/voice-assistant/voice-back.svg";

defineProps<{
  status: string;
  qaVisible: boolean;
  active: boolean;
}>();

const emit = defineEmits<{
  "dismiss-qa": [];
  "exit-report": [];
  "open-history": [];
  "open-preference": [];
  "open-rate": [];
}>();

const menuVisible = ref(false);

/** 展开菜单三项：图标均取自设计稿，行为沿用宿主页已有事件。 */
const menuItems = [
  { key: "history", label: "历史记录", icon: menuHistoryIcon },
  { key: "preference", label: "偏好设置", icon: menuPreferenceIcon },
  { key: "rate", label: "播放倍速", icon: menuRateIcon },
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
  <view class="report-broadcast-header">
    <view class="report-broadcast-header__close" @tap="qaVisible ? onClose() : emit('exit-report')">
      <image class="report-broadcast-header__icon" :src="closeIcon" mode="aspectFit" />
    </view>
    <view class="report-broadcast-header__status">
      <text>{{ status }}</text>
      <text v-if="active" class="report-broadcast-header__status-dots">
        <text>.</text><text>.</text><text>.</text>
      </text>
    </view>
    <view class="report-broadcast-header__more" @tap.stop="toggleMenu">
      <image class="report-broadcast-header__more-icon" :src="moreIcon" mode="aspectFit" />
    </view>
  </view>
  <!-- 播放器 overflow:hidden，菜单必须传送到 body，否则点「偏好设置」会打在头像上。 -->
  <Teleport to="body">
    <view
      v-if="menuVisible"
      class="report-broadcast-header__menu-mask"
      @tap="menuVisible = false"
    >
      <view class="report-broadcast-header__menu" @tap.stop>
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
            {{ item.label }}
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
.report-broadcast-header__more {
  display: flex;
  flex: 0 0 48rpx;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__icon,
.report-broadcast-header__more-icon {
  width: 48rpx;
  height: 48rpx;
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
.report-broadcast-header__status-dots {
  display: inline-flex;
  margin-left: 2rpx;
}
.report-broadcast-header__status-dots text {
  display: inline-block;
  animation: report-broadcast-status-dot 1.2s infinite ease-in-out;
}
.report-broadcast-header__status-dots text:nth-child(2) {
  animation-delay: 0.16s;
}
.report-broadcast-header__status-dots text:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes report-broadcast-status-dot {
  0%, 60%, 100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3rpx);
  }
}
</style>

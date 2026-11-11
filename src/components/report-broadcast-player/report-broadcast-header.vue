<script setup lang="ts">
import { computed } from "vue";
import minimizeIcon from "@/assets/img/min_icon.png";
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
}>();

/**
 * 外观：深色走 C 方案暗色稿 1193:2708「听播-正在播放」与 1193:1864「点击功能件-中途提问」。
 * 只换材质：图标反白；尺寸、位置一律不动。
 */
const systemStore = useSystemStore();
const isDark = computed(() => systemStore.isDark);

function onClose() {
  emit("dismiss-qa");
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
    <!-- 顶部中间的状态胶囊（灵动岛）与右上角功能件菜单已按需求去掉：头部只留返回 -->
    <view v-if="props.canMinimize" class="report-broadcast-header__actions">
      <view class="report-broadcast-header__minimize" @tap="emit('minimize')">
        <image class="report-broadcast-header__minimize-icon" :src="minimizeIcon" mode="aspectFit" />
      </view>
    </view>
  </view>
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
.report-broadcast-header__icon {
  width: 48rpx;
  height: 48rpx;
}
.report-broadcast-header__minimize-icon {
  width: 40rpx;
  height: 40rpx;
}
/* ===== 深色主题：播报头部（Ardot 1193:2708 / 1193:1864）=====
   浅色稿（339:1359 系列）只给了一套白材质，深色按 C 方案暗色稿同位置节点逐项对应：
   - 最小化：原图标是深色，反相处理 */
.report-broadcast-header--dark {
  .report-broadcast-header__minimize-icon {
    filter: brightness(0) invert(1);
  }
}
</style>

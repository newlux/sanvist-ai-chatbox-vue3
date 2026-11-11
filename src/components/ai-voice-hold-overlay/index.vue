<script setup lang="ts">
import { Transition } from "vue";
import { useI18n } from "vue-i18n";
import voiceDiscardIcon from "@/assets/img/icon-voice-discard.svg";

defineProps({
  active: { type: Boolean, default: false },
  cancelPending: { type: Boolean, default: false },
  dark: { type: Boolean, default: false },
});
const { t } = useI18n();
</script>

<template>
  <!-- 独立挂在页面上：取消录音会立即移除录音条，遮罩仍需播完退场动画。 -->
  <Transition name="voice-hold-overlay" appear>
    <view
      v-if="active"
      class="voice-hold-overlay"
      :class="{ 'voice-hold-overlay--dark': dark, 'voice-hold-overlay--cancel': cancelPending }"
    >
      <view class="voice-hold-overlay__arc" aria-hidden="true" />
      <view class="voice-hold-overlay__hint" role="status" aria-live="polite">
        <text class="voice-hold-overlay__label">
          {{ t(cancelPending ? 'voice-hold-release-cancel' : 'voice-hold-release-send') }}
        </text>
        <view class="voice-hold-overlay__discard" aria-hidden="true">
          <image class="voice-hold-overlay__icon" :src="voiceDiscardIcon" mode="aspectFit" />
        </view>
      </view>
    </view>
  </Transition>
</template>

<style scoped lang="scss">
.voice-hold-overlay {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  height: calc(440rpx + env(safe-area-inset-bottom));
  overflow: hidden;
  background: linear-gradient(to bottom, rgb(141 188 235 / 0%), rgb(141 188 235 / 38%));
  pointer-events: none;
  transform: translate3d(0, 0, 0);
}

.voice-hold-overlay__arc {
  position: absolute;
  bottom: 0;
  left: -30%;
  width: 160%;
  height: calc(210rpx + env(safe-area-inset-bottom));
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
  background: rgb(81 132 184 / 18%);
}

.voice-hold-overlay__hint {
  position: absolute;
  right: 48rpx;
  bottom: calc(184rpx + env(safe-area-inset-bottom));
  left: 48rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  color: #171717;
  font-size: 28rpx;
  line-height: 40rpx;
  text-align: center;
  transition: color 160ms ease;
}

.voice-hold-overlay__label {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: break-word;
}

.voice-hold-overlay__discard {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #afb1b5;
  transition: background-color 160ms ease, transform 160ms ease;
}

.voice-hold-overlay__icon {
  width: 32rpx;
  height: 32rpx;
}

.voice-hold-overlay--dark {
  background: linear-gradient(to bottom, rgb(15 80 150 / 0%), rgb(15 80 150 / 48%));
}

.voice-hold-overlay--dark .voice-hold-overlay__hint {
  color: #f2f3f5;
}

.voice-hold-overlay--dark .voice-hold-overlay__discard {
  background: #686a70;
}

.voice-hold-overlay--cancel .voice-hold-overlay__hint {
  color: #ff3830;
}

.voice-hold-overlay--cancel .voice-hold-overlay__discard {
  background: #e62b26;
  transform: scale(1.08);
}

.voice-hold-overlay-enter-active {
  transition: transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 300ms ease;
}

.voice-hold-overlay-leave-active {
  transition: transform 240ms cubic-bezier(0.4, 0, 1, 1), opacity 240ms ease;
}

.voice-hold-overlay-enter-from,
.voice-hold-overlay-leave-to {
  opacity: 0;
  transform: translate3d(0, 100%, 0);
}

@media (prefers-reduced-motion: reduce) {
  .voice-hold-overlay-enter-active,
  .voice-hold-overlay-leave-active,
  .voice-hold-overlay__hint,
  .voice-hold-overlay__discard {
    transition: none;
  }
}
</style>

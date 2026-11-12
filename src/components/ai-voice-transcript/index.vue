<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { resolveMotionElement } from '@/utils/voice-message-motion';

defineProps({ text: { type: String, default: '' }, dark: { type: Boolean, default: false } });
const emit = defineEmits<{ 'height-change': [height: number] }>();
const { t } = useI18n();
const root = ref<unknown>(null);
let observer: ResizeObserver | null = null;
onMounted(async () => {
  await nextTick();
  const element = resolveMotionElement(root.value);
  if (!element) return;
  const measure = () => emit('height-change', Math.ceil(element.getBoundingClientRect().height));
  measure();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(element);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  emit('height-change', 0);
});
</script>

<template>
  <view ref="root" class="voice-live" :class="{ 'voice-live--dark': dark }">
    <view class="voice-live__box">
      <text class="voice-live__text">{{ text || t('identifying') }}<text class="voice-live__dots" aria-hidden="true"><text
        v-for="dot in 3" :key="dot" class="voice-live__dot"
      >.</text></text></text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.voice-live {
  position: absolute;
  // 130px = 与「提问顶到上方」的落点（ai-message-list 的 PIN_MESSAGE_TOP_MIN_Y_PX）同一条线，
  // 说完收成提问气泡时文字不会上下跳
  top: max(var(--chat-top-inset, 300rpx), 130px);
  right: 40rpx;
  left: 40rpx;
  z-index: 3;
  box-sizing: content-box;
  padding-bottom: 40rpx;
  background: linear-gradient(180deg, #fafafa 0%, #fafafa 80%, rgba(250, 250, 250, 0) 100%);
  pointer-events: none;
  animation: voice-live-in 180ms ease-out both;
}
.voice-live__box {
  position: relative;
  height: 96rpx;
  overflow: hidden;
}
.voice-live__text {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  color: #0d0d0d;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 48rpx;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-user-select: none;
  user-select: none;
}
.voice-live__dots {
  display: inline-block;
  margin-left: 8rpx;
  color: #8f8f8f;
  white-space: nowrap;
}
.voice-live__dot {
  display: inline-block;
  width: 12rpx;
  opacity: 0.2;
  animation: voice-live-dot-blink 1.2s ease-in-out infinite;
}
.voice-live__dot:nth-child(2) { animation-delay: 0.2s; }
.voice-live__dot:nth-child(3) { animation-delay: 0.4s; }
.voice-live--dark {
  background: linear-gradient(180deg, #1a1a1a 0%, #1a1a1a 80%, rgba(26, 26, 26, 0) 100%);
  .voice-live__text { color: #f2f3f5; }
}
@keyframes voice-live-dot-blink {
  0%, 20%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}
@keyframes voice-live-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>

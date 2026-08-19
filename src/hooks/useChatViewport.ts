import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export function useChatViewport() {
  const windowHeight = ref(0);
  const keyboardHeight = ref(0);

  const chatViewportStyle = computed(() => {
    const height = Math.max(0, windowHeight.value - keyboardHeight.value);
    return height > 0 ? { height: `${height}px` } : {};
  });

  function syncWindowHeight() {
    windowHeight.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
  }

  function onKeyboardHeightChange(event: { height?: number }) {
    keyboardHeight.value = Math.max(0, Number(event?.height) || 0);
  }

  onMounted(() => {
    syncWindowHeight();
    uni.onKeyboardHeightChange?.(onKeyboardHeightChange);
  });

  onBeforeUnmount(() => {
    uni.offKeyboardHeightChange?.(onKeyboardHeightChange);
  });

  return {
    chatViewportStyle,
    syncWindowHeight,
  };
}

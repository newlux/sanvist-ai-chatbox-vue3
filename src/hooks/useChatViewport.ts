import { computed, onBeforeUnmount, onMounted, ref } from "vue";

export function useChatViewport() {
  const windowHeight = ref(0);
  const keyboardHeight = ref(0);

  /**
   * 键盘弹起时把可视区整体压到键盘上方。
   * 输入栏是这块区域的最后一个 flex 子元素，压缩后自然贴着键盘顶边。
   */
  const chatViewportStyle = computed(() => {
    const height = Math.max(0, windowHeight.value - keyboardHeight.value);
    return height > 0 ? { height: `${height}px` } : {};
  });

  const isKeyboardOpen = computed(() => keyboardHeight.value > 0);

  function syncWindowHeight() {
    windowHeight.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
  }

  function applyKeyboardHeight(height: unknown) {
    keyboardHeight.value = Math.max(0, Number(height) || 0);
  }

  // 支付宝走页面级 onKeyboardHeight（uni 内部转发成这个回调）
  function onKeyboardHeightChange(event: { height?: number }) {
    applyKeyboardHeight(event?.height);
  }

  function resetKeyboardHeight() {
    keyboardHeight.value = 0;
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
    keyboardHeight,
    isKeyboardOpen,
    syncWindowHeight,
    resetKeyboardHeight,
  };
}

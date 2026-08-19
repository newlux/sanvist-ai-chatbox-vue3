import { computed, onBeforeUnmount, onMounted, ref } from "vue";

interface UseKeyboardViewportOptions {
  maxKeyboardHeight?: number;
}

export function useKeyboardViewport(options: UseKeyboardViewportOptions = {}) {
  const maxKeyboardHeight = options.maxKeyboardHeight ?? 600;
  const keyboardHeightPx = ref(0);
  const initialWindowHeightPx = ref(0);
  const viewportBottomOffsetPx = ref(0);
  const focusedEditable = ref(false);

  const keyboardOpen = computed(() => keyboardHeightPx.value > 0);

  function onKeyboardHeightChange(result: { height?: number }) {
    const height = Math.max(0, Math.min(Number(result.height) || 0, maxKeyboardHeight));
    keyboardHeightPx.value = height;
    viewportBottomOffsetPx.value = height;
  }

  function setFocusedEditable(value: boolean) {
    focusedEditable.value = value;
    if (!value && !keyboardOpen.value) viewportBottomOffsetPx.value = 0;
  }

  function resetKeyboardState() {
    keyboardHeightPx.value = 0;
    viewportBottomOffsetPx.value = 0;
    focusedEditable.value = false;
  }

  onMounted(() => {
    initialWindowHeightPx.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
    uni.onKeyboardHeightChange(onKeyboardHeightChange);
  });

  onBeforeUnmount(() => {
    uni.offKeyboardHeightChange?.(onKeyboardHeightChange);
  });

  return {
    keyboardHeightPx,
    initialWindowHeightPx,
    viewportBottomOffsetPx,
    keyboardOpen,
    focusedEditable,
    setFocusedEditable,
    resetKeyboardState,
  };
}

import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { isMpaasReady, onNativeEvent } from "@/utils/platform/mpaas";

type FocusOwner = "none" | "text" | "voice";

/**
 * PC H5 没有软键盘；mPaaS H5 的键盘高度只信宿主 keyboardHeightChange。
 * 宿主采用 resize 模式，聊天内容区保持初始高度，输入面板不再额外叠加 bottom 补偿。
 */
export function useChatViewport() {
  const windowHeight = ref(0);
  const focusOwner = ref<FocusOwner>("none");
  const nativeKeyboardHeight = ref(0);
  const keyboardOpenedForFocus = ref(false);
  const keyboardOverlaysViewport = ref(false);
  let disposeNativeKeyboard: (() => void) | null = null;

  const chatViewportStyle = computed(() =>
    (windowHeight.value > 0 ? { height: `${windowHeight.value}px` } : {}),
  );

  const keyboardHeight = computed(() =>
    (focusOwner.value === "text" ? nativeKeyboardHeight.value : 0),
  );

  const voiceKeyboardHeight = computed(() =>
    (focusOwner.value === "voice" ? nativeKeyboardHeight.value : 0),
  );

  function syncWindowHeight() {
    windowHeight.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
  }

  function beginFocus(owner: Exclude<FocusOwner, "none">) {
    if (focusOwner.value === owner) return;
    focusOwner.value = owner;
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
  }

  function endFocus(owner: Exclude<FocusOwner, "none">) {
    if (focusOwner.value !== owner) return;
    focusOwner.value = "none";
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
  }

  function setTextInputFocused(focused: boolean) {
    if (focused) beginFocus("text");
    else endFocus("text");
  }

  function setVoiceInputFocused(focused: boolean) {
    if (focused) beginFocus("voice");
    else endFocus("voice");
  }

  function blurActiveInput() {
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // mPaaS 个别版本没有可访问的 activeElement，状态已在本地完成归零。
    }
  }

  function onNativeKeyboardHeight(payload: { height?: number | string }) {
    const height = Math.max(0, Number(payload?.height) || 0);

    if (height > 0) {
      // 延迟到达的正高度不能重新激活已经失焦的输入框。
      if (focusOwner.value === "none") return;
      nativeKeyboardHeight.value = height;
      keyboardOpenedForFocus.value = true;
      return;
    }

    // 聚焦启动阶段宿主可能先推一次 0；只有本轮确实打开过键盘才接受关闭。
    if (!keyboardOpenedForFocus.value) return;
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
    focusOwner.value = "none";
    blurActiveInput();
  }

  function onWindowResize() {
    // PC 浏览器窗口缩放需要同步高度；mPaaS 的 resize 是软键盘行为，不能重排聊天内容区。
    if (!isMpaasReady()) syncWindowHeight();
  }

  onMounted(() => {
    syncWindowHeight();
    if (typeof window !== "undefined") window.addEventListener("resize", onWindowResize);
    disposeNativeKeyboard = onNativeEvent("keyboardHeightChange", onNativeKeyboardHeight);
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") window.removeEventListener("resize", onWindowResize);
    disposeNativeKeyboard?.();
    disposeNativeKeyboard = null;
  });

  return {
    chatViewportStyle,
    keyboardHeight,
    voiceKeyboardHeight,
    keyboardOverlaysViewport,
    syncWindowHeight,
    setTextInputFocused,
    setVoiceInputFocused,
  };
}

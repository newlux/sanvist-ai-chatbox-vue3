import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { isMpaasReady, onNativeEvent } from "@/utils/platform/mpaas";

type FocusOwner = "none" | "text" | "voice";

const HEADER_PAN_VAR = "--chat-header-pan";

/**
 * PC H5 没有软键盘；mPaaS H5 的键盘高度只信宿主 keyboardHeightChange。
 * 键盘弹起后始终按宿主整页上推处理：输入栏贴视口底部，header 用 visualViewport.offsetTop 拉回顶部。
 *
 * 上推过程用 rAF 逐帧写 CSS 变量，避免等事件再一次性 translate 造成闪动；
 * transform 始终存在（含 0），避免合成层创建/销毁闪一帧。
 */
export function useChatViewport() {
  const windowHeight = ref(0);
  const focusOwner = ref<FocusOwner>("none");
  const nativeKeyboardHeight = ref(0);
  const keyboardOpenedForFocus = ref(false);
  let disposeNativeKeyboard: (() => void) | null = null;
  let rafId = 0;
  let lastPanOffset = 0;

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

  function readViewportOffsetTop() {
    try {
      const visual = typeof window !== "undefined" && window.visualViewport
        ? Number(window.visualViewport.offsetTop) || 0
        : 0;
      const scrolled = typeof window !== "undefined"
        ? Number(window.scrollY || document.documentElement?.scrollTop || 0) || 0
        : 0;
      return Math.max(0, visual, scrolled);
    } catch {
      return 0;
    }
  }

  function applyHeaderPan(offset: number) {
    lastPanOffset = offset;
    try {
      document.documentElement.style.setProperty(HEADER_PAN_VAR, `${offset}px`);
    } catch {
      // 非 H5 运行时没有 document，header 保持在原位
    }
  }

  function shouldTrackPan() {
    return focusOwner.value !== "none" || keyboardOpenedForFocus.value || lastPanOffset > 0.5;
  }

  function tickPan() {
    rafId = 0;
    applyHeaderPan(readViewportOffsetTop());
    if (shouldTrackPan()) rafId = requestAnimationFrame(tickPan);
  }

  function startPanTracking() {
    if (typeof requestAnimationFrame !== "function") {
      applyHeaderPan(readViewportOffsetTop());
      return;
    }
    if (rafId) return;
    rafId = requestAnimationFrame(tickPan);
  }

  function stopPanTracking() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    applyHeaderPan(0);
  }

  function beginFocus(owner: Exclude<FocusOwner, "none">) {
    if (focusOwner.value === owner) return;
    focusOwner.value = owner;
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
    startPanTracking();
  }

  function endFocus(owner: Exclude<FocusOwner, "none">) {
    if (focusOwner.value !== owner) return;
    focusOwner.value = "none";
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
    // 不立刻把偏移打成 0：上推回落也要跟 rAF，否则 header 会先弹回再闪一下
    startPanTracking();
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
      if (focusOwner.value === "none") return;
      nativeKeyboardHeight.value = height;
      keyboardOpenedForFocus.value = true;
      startPanTracking();
      return;
    }

    if (!keyboardOpenedForFocus.value) return;
    nativeKeyboardHeight.value = 0;
    keyboardOpenedForFocus.value = false;
    focusOwner.value = "none";
    startPanTracking();
    blurActiveInput();
  }

  function onWindowResize() {
    if (!isMpaasReady()) syncWindowHeight();
    startPanTracking();
  }

  onMounted(() => {
    applyHeaderPan(0);
    syncWindowHeight();
    if (typeof window !== "undefined") {
      window.addEventListener("resize", onWindowResize);
      window.addEventListener("scroll", startPanTracking, { passive: true });
      window.visualViewport?.addEventListener("resize", startPanTracking);
      window.visualViewport?.addEventListener("scroll", startPanTracking);
    }
    disposeNativeKeyboard = onNativeEvent("keyboardHeightChange", onNativeKeyboardHeight);
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", startPanTracking);
      window.visualViewport?.removeEventListener("resize", startPanTracking);
      window.visualViewport?.removeEventListener("scroll", startPanTracking);
    }
    disposeNativeKeyboard?.();
    disposeNativeKeyboard = null;
    stopPanTracking();
  });

  return {
    chatViewportStyle,
    keyboardHeight,
    voiceKeyboardHeight,
    syncWindowHeight,
    setTextInputFocused,
    setVoiceInputFocused,
  };
}

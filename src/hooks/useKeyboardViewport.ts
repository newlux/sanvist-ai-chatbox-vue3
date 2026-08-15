import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { isDebugLogEnabled } from "@/utils/debug";

const KEYBOARD_THRESHOLD_PX = 60;
const KEYBOARD_MAX_HEIGHT_PX = 600;
const KEYBOARD_UPDATE_DELAY_MS = 100;
const KEYBOARD_DISMISS_DELAY_MS = 180;

interface KeyboardChangeEvent {
  height?: number;
  keyboardHeight?: number;
  detail?: { height?: number };
}

/**
 * 统一处理 WebView 键盘、视口与焦点兼容状态。
 *
 * 同时监听 visualViewport 和 uni 键盘事件，并在键盘动画收起期间冻结较小的视口更新，
 * 避免 fixed 布局提前回落。仅以注册时的同一回调定向解绑，不影响应用级监听。
 */
export function useKeyboardViewport() {
  const keyboardHeightPx = ref(0);
  const initialWindowHeightPx = ref(0);
  const viewportBottomOffsetPx = ref(0);
  const voiceInputFocused = ref(false);
  const textInputFocused = ref(false);
  const keyboardClosing = ref(false);
  // 高度写入有 100ms 合并延迟，不能用 keyboardHeightPx 判断键盘是否曾真正打开。
  // 该标记用于识别 Android 返回键收起键盘却不触发 blur 的情况。
  let keyboardWasOpened = false;

  let keyboardHeightTimer: ReturnType<typeof setTimeout> | null = null;
  let keyboardUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let viewportStableLogTimer: ReturnType<typeof setTimeout> | null = null;

  function logViewport(tag: string) {
    if (!isDebugLogEnabled() || typeof window === "undefined") return;
    try {
      const vv = window.visualViewport;
      console.info(`[viewport] ${tag}`, {
        vv: vv ? Math.round(vv.height) : "no-vv",
        vvOffsetTop: vv ? Math.round(vv.offsetTop) : "no-vv",
        inner: Math.round(window.innerHeight),
        scrollY: Math.round(window.scrollY),
        docScrollTop: Math.round(document.documentElement.scrollTop || 0),
        bodyScrollTop: Math.round(document.body?.scrollTop || 0),
      });
    }
    catch {
      // 不支持视口 API 时忽略调试日志。
    }
  }

  function getViewportHeightPx() {
    if (typeof window !== "undefined" && window.innerHeight) {
      return Number(window.innerHeight) || 0;
    }
    try {
      const info = uni?.getSystemInfoSync?.();
      return Number(info?.windowHeight) || 0;
    }
    catch (error) {
      console.error("[keyboard-viewport] getSystemInfoSync failed", error);
      return 0;
    }
  }

  function clearKeyboardDismissTimer() {
    if (keyboardHeightTimer) clearTimeout(keyboardHeightTimer);
    keyboardHeightTimer = null;
  }

  function resetKeyboardState() {
    if (keyboardUpdateTimer) clearTimeout(keyboardUpdateTimer);
    keyboardUpdateTimer = null;
    keyboardHeightPx.value = 0;
    viewportBottomOffsetPx.value = 0;
    keyboardClosing.value = false;
    keyboardWasOpened = false;
    clearKeyboardDismissTimer();
  }

  function syncFocusStateAfterKeyboardDismiss() {
    clearKeyboardDismissTimer();
    // Android 返回键在部分 WebView 中只会收起系统键盘，不会让 textarea 真正失焦；
    // 必须主动 blur 当前 DOM 焦点，否则 WebView 后续仍会将页面顶到输入框位置。
    try {
      const activeElement = document.activeElement as HTMLElement | null;
      activeElement?.blur?.();
    }
    catch {
      // 宿主未暴露 DOM 焦点时，继续按视口状态复位。
    }
    voiceInputFocused.value = false;
    textInputFocused.value = false;
    resetKeyboardState();
    logViewport("keyboard-dismissed-without-blur");
  }

  function setKeyboardHeightPx(heightPx: number) {
    const clamped = Math.max(0, Math.min(Number(heightPx) || 0, KEYBOARD_MAX_HEIGHT_PX));
    if (clamped > KEYBOARD_THRESHOLD_PX) {
      keyboardWasOpened = true;
      clearKeyboardDismissTimer();
      keyboardClosing.value = false;
    }
    else if (
      keyboardWasOpened
      && (textInputFocused.value || voiceInputFocused.value)
    ) {
      clearKeyboardDismissTimer();
      keyboardHeightTimer = setTimeout(syncFocusStateAfterKeyboardDismiss, KEYBOARD_DISMISS_DELAY_MS);
    }

    if (keyboardClosing.value && clamped < keyboardHeightPx.value) return;

    if (keyboardUpdateTimer) clearTimeout(keyboardUpdateTimer);
    keyboardUpdateTimer = setTimeout(() => {
      if (Math.abs(clamped - keyboardHeightPx.value) < 20) return;
      keyboardHeightPx.value = clamped;
      if (isDebugLogEnabled()) console.info("[kbd] keyboardHeightPx updated to", clamped);
    }, KEYBOARD_UPDATE_DELAY_MS);
  }

  function onVoiceFocus() {
    voiceInputFocused.value = true;
    logViewport("focus");
  }

  function onTextFocus() {
    textInputFocused.value = true;
    logViewport("text-focus");
  }

  function scheduleKeyboardReset(tag: string) {
    keyboardClosing.value = true;
    logViewport(tag);
    clearKeyboardDismissTimer();
    keyboardHeightTimer = setTimeout(resetKeyboardState, KEYBOARD_DISMISS_DELAY_MS);
  }

  function onVoiceBlur() {
    voiceInputFocused.value = false;
    scheduleKeyboardReset("blur");
  }

  function onTextBlur() {
    textInputFocused.value = false;
    scheduleKeyboardReset("text-blur");
  }

  function updateViewportState() {
    const vv = window.visualViewport;
    if (!vv) return;

    const delta = Math.max(0, initialWindowHeightPx.value - vv.height);
    if (keyboardClosing.value && delta < keyboardHeightPx.value) return;

    setKeyboardHeightPx(delta > KEYBOARD_THRESHOLD_PX ? delta : 0);
    if (
      delta <= KEYBOARD_THRESHOLD_PX
      && keyboardWasOpened
      && (textInputFocused.value || voiceInputFocused.value)
    ) {
      syncFocusStateAfterKeyboardDismiss();
      return;
    }

    viewportBottomOffsetPx.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  }

  const onVisualViewportResize = () => {
    updateViewportState();
    logViewport("vv-resize");
    if (viewportStableLogTimer) clearTimeout(viewportStableLogTimer);
    viewportStableLogTimer = setTimeout(() => logViewport("vv-resize-stable"), 400);
  };
  const onVisualViewportScroll = () => {
    updateViewportState();
    logViewport("vv-scroll");
  };
  const onWindowScroll = () => logViewport("window-scroll");
  const onKeyboardHeightChange = (event: KeyboardChangeEvent) => {
    const height = Number(event?.height ?? event?.keyboardHeight ?? event?.detail?.height ?? 0) || 0;
    setKeyboardHeightPx(height);
    logViewport(`uni-kbd-change h=${height}`);
  };

  onMounted(() => {
    initialWindowHeightPx.value = getViewportHeightPx();
    logViewport("mounted");
    if (typeof window !== "undefined") {
      window.visualViewport?.addEventListener("resize", onVisualViewportResize);
      window.visualViewport?.addEventListener("scroll", onVisualViewportScroll);
      window.addEventListener("scroll", onWindowScroll, { passive: true });
    }
    uni?.onKeyboardHeightChange?.(onKeyboardHeightChange);
  });

  onBeforeUnmount(() => {
    if (typeof window !== "undefined") {
      window.visualViewport?.removeEventListener("resize", onVisualViewportResize);
      window.visualViewport?.removeEventListener("scroll", onVisualViewportScroll);
      window.removeEventListener("scroll", onWindowScroll);
    }
    uni?.offKeyboardHeightChange?.(onKeyboardHeightChange);
    clearKeyboardDismissTimer();
    if (keyboardUpdateTimer) clearTimeout(keyboardUpdateTimer);
    if (viewportStableLogTimer) clearTimeout(viewportStableLogTimer);
  });

  return {
    keyboardHeightPx,
    initialWindowHeightPx,
    viewportBottomOffsetPx,
    voiceInputFocused,
    textInputFocused,
    keyboardClosing,
    voiceKeyboardOpen: computed(() => voiceInputFocused.value || keyboardHeightPx.value > 0),
    textKeyboardOpen: computed(() => textInputFocused.value || keyboardHeightPx.value > 0),
    onVoiceFocus,
    onVoiceBlur,
    onTextFocus,
    onTextBlur,
    resetKeyboardState,
  };
}

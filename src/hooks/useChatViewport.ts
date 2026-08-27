import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createLogger } from "@/utils/logger";
import { onNativeEvent } from "@/utils/platform/mpaas";

const logger = createLogger("keyboard");

type FocusOwner = "none" | "text" | "voice";

/** 收起延迟：盖过键盘动画中途插进来的那一个 0 */
const KEYBOARD_COLLAPSE_DELAY_MS = 160;
/** 低于这个高度不算键盘：地址栏收缩、工具条变化也会让可视视口变矮 */
const MIN_KEYBOARD_HEIGHT_PX = 80;
/**
 * 兜底键盘高度：部分安卓 WebView 既不支持 visualViewport，也不会缩布局视口，
 * 高度就完全测不出来。与其让输入框被盖住，不如按屏高比例估一个。
 */
const FALLBACK_KEYBOARD_RATIO = 0.42;
const FALLBACK_KEYBOARD_RANGE = { min: 260, max: 360 };
/** 聚焦后等这么久还测不到高度，就认为这台设备测不出来，启用兜底值 */
const FALLBACK_DELAY_MS = 450;

/**
 * 键盘高度来源与 ea39b9e 一致：visualViewport 反推 + 宿主推送 + 估高兜底。
 * 页面高度不随键盘压缩；输入栏用 bottom 抬到键盘上方。
 */
export function useChatViewport() {
  /** 输入栏实测高度；尚未量到时用一个接近胶囊+页脚的兜底值 */
  const FALLBACK_DOCK_HEIGHT_PX = 120;
  /** 消息区在输入栏高度之外再留一点空隙，避免最后一条贴着输入栏 */
  const MESSAGE_LIST_EXTRA_GAP_PX = 16;

  const windowHeight = ref(0);
  const inputDockHeight = ref(0);
  const measuredKeyboardHeight = ref(0);
  const focusOwner = ref<FocusOwner>("none");
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let inputFocused = false;
  let usingFallbackHeight = false;
  let nativeKeyboardSupported = false;
  let disposeNativeKeyboard: (() => void) | null = null;
  let baseViewportHeight = 0;

  const chatViewportStyle = computed(() =>
    (windowHeight.value > 0 ? { height: `${windowHeight.value}px` } : {}),
  );

  const keyboardHeight = computed(() =>
    (focusOwner.value === "voice" ? 0 : measuredKeyboardHeight.value),
  );

  const voiceKeyboardHeight = computed(() =>
    (focusOwner.value === "voice" ? measuredKeyboardHeight.value : 0),
  );

  const composerBottomInset = computed(() => {
    const lift = Math.max(0, Number(measuredKeyboardHeight.value) || 0);
    const dock = inputDockHeight.value || FALLBACK_DOCK_HEIGHT_PX;
    return `${dock + MESSAGE_LIST_EXTRA_GAP_PX + lift}px`;
  });

  const composerDockOffset = computed(() => {
    const dock = inputDockHeight.value || FALLBACK_DOCK_HEIGHT_PX;
    return `${dock}px`;
  });

  function setInputDockHeight(height: number) {
    const next = Math.max(0, Math.round(Number(height) || 0));
    if (next !== inputDockHeight.value) inputDockHeight.value = next;
  }

  function syncWindowHeight() {
    windowHeight.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
  }

  function normalizeKeyboardHeight(height: unknown) {
    const raw = Math.max(0, Number(height) || 0);
    const limit = windowHeight.value > 0 ? windowHeight.value * 0.6 : 0;
    return limit > 0 && raw > limit ? limit : raw;
  }

  function applyKeyboardHeight(height: unknown) {
    const next = normalizeKeyboardHeight(height);
    if (next > 0) usingFallbackHeight = false;
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    if (next > 0) {
      if (Math.abs(next - measuredKeyboardHeight.value) < 4) return;
      measuredKeyboardHeight.value = next;
      return;
    }

    if (measuredKeyboardHeight.value === 0) return;
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      const live = readViewportKeyboardHeight();
      measuredKeyboardHeight.value = live > 0 ? live : 0;
      if (live <= 0) focusOwner.value = "none";
    }, KEYBOARD_COLLAPSE_DELAY_MS);
  }

  function estimateKeyboardHeight() {
    const base = windowHeight.value || window.innerHeight || 0;
    if (!base) return FALLBACK_KEYBOARD_RANGE.min;
    const estimated = Math.round(base * FALLBACK_KEYBOARD_RATIO);
    return Math.min(FALLBACK_KEYBOARD_RANGE.max, Math.max(FALLBACK_KEYBOARD_RANGE.min, estimated));
  }

  function readViewportKeyboardHeight() {
    if (typeof window === "undefined") return 0;
    const viewport = window.visualViewport;
    if (!viewport) {
      const shrunk = baseViewportHeight - window.innerHeight;
      return shrunk > MIN_KEYBOARD_HEIGHT_PX ? Math.round(shrunk) : 0;
    }
    const layoutHeight = Math.max(window.innerHeight, baseViewportHeight);
    const occluded = layoutHeight - viewport.height - viewport.offsetTop;
    if (occluded > MIN_KEYBOARD_HEIGHT_PX) return Math.round(occluded);
    baseViewportHeight = Math.max(baseViewportHeight, viewport.height);
    return 0;
  }

  function pinLayoutViewport() {
    if (typeof window === "undefined") return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
  }

  function resolveFocusOwner(target: EventTarget | null): FocusOwner {
    const el = target as HTMLElement | null;
    if (!el) return "none";
    const attr = el.getAttribute?.("data-voice-confirm-input")
      || el.closest?.("[data-voice-confirm-input]")?.getAttribute("data-voice-confirm-input");
    if (attr) return "voice";
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "INPUT" || el.closest?.("uni-textarea, uni-input, textarea, input")) {
      return "text";
    }
    return "none";
  }

  function onViewportChange() {
    const height = readViewportKeyboardHeight();
    if (height > 0) pinLayoutViewport();
    if (inputFocused || height > 0) applyKeyboardHeight(height);
  }

  function onFocusIn(event?: FocusEvent) {
    const owner = resolveFocusOwner(event?.target || null);
    if (owner !== "none") focusOwner.value = owner;
    inputFocused = true;
    pinLayoutViewport();
    applyKeyboardHeight(readViewportKeyboardHeight());
    [60, 260].forEach((delay) => {
      setTimeout(() => {
        pinLayoutViewport();
        applyKeyboardHeight(readViewportKeyboardHeight());
      }, delay);
    });

    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!inputFocused || measuredKeyboardHeight.value > 0 || nativeKeyboardSupported) return;
      const estimated = estimateKeyboardHeight();
      usingFallbackHeight = true;
      measuredKeyboardHeight.value = estimated;
      logger.warn("量不到键盘高度，启用兜底估算值", {
        estimated,
        windowHeight: windowHeight.value,
        hasVisualViewport: Boolean(window.visualViewport),
      });
    }, FALLBACK_DELAY_MS);
  }

  function onFocusOut() {
    inputFocused = false;
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (usingFallbackHeight) {
      usingFallbackHeight = false;
      applyKeyboardHeight(0);
    }
  }

  function onWindowScroll() {
    if (measuredKeyboardHeight.value > 0) pinLayoutViewport();
  }

  function forceCollapse() {
    if (measuredKeyboardHeight.value <= 0) return;
    usingFallbackHeight = false;
    inputFocused = false;
    measuredKeyboardHeight.value = 0;
    focusOwner.value = "none";
    try {
      uni.hideKeyboard();
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // 个别容器没有 activeElement，忽略
    }
  }

  function onDocumentTouchStart(event: TouchEvent) {
    if (measuredKeyboardHeight.value <= 0) return;
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (!touch) return;
    const keyboardTop = window.innerHeight - measuredKeyboardHeight.value;
    if (touch.clientY > keyboardTop) forceCollapse();
  }

  function onNativeKeyboardHeight(payload: { height?: number | string }) {
    const height = Number(payload?.height);
    if (!Number.isFinite(height)) return;
    nativeKeyboardSupported = true;
    if (height <= 0) {
      forceCollapse();
      return;
    }
    applyKeyboardHeight(height);
  }

  function onKeyboardHeightChange(event: { height?: number }) {
    applyKeyboardHeight(event?.height);
  }

  function resetKeyboardHeight() {
    applyKeyboardHeight(0);
  }

  function setTextInputFocused(focused: boolean) {
    if (focused) {
      focusOwner.value = "text";
      inputFocused = true;
      pinLayoutViewport();
      applyKeyboardHeight(readViewportKeyboardHeight());
      return;
    }
    resetKeyboardHeight();
  }

  function setVoiceInputFocused(focused: boolean) {
    if (focused) {
      focusOwner.value = "voice";
      inputFocused = true;
      pinLayoutViewport();
      applyKeyboardHeight(readViewportKeyboardHeight());
      return;
    }
    resetKeyboardHeight();
  }

  onMounted(() => {
    syncWindowHeight();
    baseViewportHeight = Number(window?.visualViewport?.height) || Number(window?.innerHeight) || 0;
    uni.onKeyboardHeightChange?.(onKeyboardHeightChange);
    if (typeof window !== "undefined") {
      window.addEventListener("scroll", onWindowScroll, { passive: true });
      window.addEventListener("resize", onViewportChange);
      document.addEventListener("focusin", onFocusIn);
      document.addEventListener("focusout", onFocusOut);
      document.addEventListener("touchstart", onDocumentTouchStart, { passive: true });
      window.visualViewport?.addEventListener("resize", onViewportChange);
      window.visualViewport?.addEventListener("scroll", onViewportChange);
    }
    disposeNativeKeyboard = onNativeEvent("keyboardHeightChange", onNativeKeyboardHeight);
  });

  onBeforeUnmount(() => {
    if (collapseTimer) clearTimeout(collapseTimer);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    uni.offKeyboardHeightChange?.(onKeyboardHeightChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchstart", onDocumentTouchStart);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    }
    disposeNativeKeyboard?.();
    disposeNativeKeyboard = null;
  });

  return {
    chatViewportStyle,
    keyboardHeight,
    voiceKeyboardHeight,
    composerBottomInset,
    composerDockOffset,
    syncWindowHeight,
    setInputDockHeight,
    setTextInputFocused,
    setVoiceInputFocused,
    resetKeyboardHeight,
  };
}

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
 * 键盘高度来源：visualViewport 反推 + 宿主推送。
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
  let inputFocused = false;
  let h5KeyboardAuthoritative = false;
  let disposeNativeKeyboard: (() => void) | null = null;
  let disposeH5Keyboard: (() => void) | null = null;
  let baseViewportHeight = 0;

  /** 设备像素比（物理像素 / CSS 像素）。H5/WebView 里 window.devicePixelRatio 最权威。 */
  function readDevicePixelRatio(): number {
    const dpr =
      Number(window?.devicePixelRatio)
      || Number(document?.defaultView?.devicePixelRatio)
      || Number(uni.getSystemInfoSync?.()?.pixelRatio)
      || 0;
    return dpr > 0 ? dpr : 1;
  }

  /**
   * 原生回调的键盘高度是「物理像素」，布局用的是 CSS 像素，这里是单位换算。
   * 直接用 window.devicePixelRatio（物理像素 / CSS 像素）换算。
   * 不要用 nativeViewportHeight / baseViewportHeight 反推缩放比：baseViewportHeight 是页面
   * 挂载早期一次性量到的快照，未必等于原生 viewportHeight 对应的 CSS 视口高（实测会偏大），
   * 用它反推会得到偏小的缩放比、把键盘高度算大（如 774/2.835≈273，正确应为 774/3=258）。
   */
  function cssKeyboardHeightFromNative(physical: number): number {
    const phys = Math.max(0, Number(physical) || 0);
    if (phys <= 0) return 0;
    const dpr = readDevicePixelRatio();
    return Math.round(phys / (dpr > 0 ? dpr : 1));
  }

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

  function applyKeyboardHeight(height: unknown, fromNative = false) {
    if (h5KeyboardAuthoritative && !fromNative) return;
    const next = normalizeKeyboardHeight(height);
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
  }

  function onFocusOut() {
    inputFocused = false;
  }

  function onWindowScroll() {
    if (measuredKeyboardHeight.value > 0) pinLayoutViewport();
  }

  function forceCollapse() {
    if (measuredKeyboardHeight.value <= 0) return;
    inputFocused = false;
    h5KeyboardAuthoritative = false;
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
    if (height <= 0) {
      forceCollapse();
      return;
    }
    h5KeyboardAuthoritative = true;
    // 原生推的是物理像素 → 换算成 CSS 像素再进布局
    applyKeyboardHeight(cssKeyboardHeightFromNative(height), true);
  }

  /**
   * mPaaS 容器里 Native 主动调用前端页面走的是 document 上派发的 DOM 事件
   * （参考 h5NetworkChange 的注册方式），payload 在 event.data / event.detail / event 本身上。
   */
  function onH5KeyboardChangeEvent(event: Event) {
    const source = event as { data?: unknown; detail?: unknown };
    const payload = (source?.data || source?.detail || event || {}) as Parameters<typeof onH5KeyboardChange>[0];
    onH5KeyboardChange(payload);
  }

  function onH5KeyboardChange(payload: {
    visible?: boolean;
    top?: number | string;
    height?: number | string;
    reportedHeight?: number | string;
    viewportHeight?: number | string;
    unit?: string;
  }) {
    logger.info("[h5KeyboardChange] 收到回调", payload);
    if (typeof payload?.visible !== "boolean") {
      logger.warn("[h5KeyboardChange] payload 缺少 visible 字段，直接忽略", payload);
      return;
    }
    if (!payload.visible) {
      logger.info("[h5KeyboardChange] 键盘收起，forceCollapse");
      forceCollapse();
      return;
    }

    const top = Number(payload.top);
    const viewportHeight = Number(payload.viewportHeight);
    const reportedHeight = Number(payload.height ?? payload.reportedHeight);
    const physical = Number.isFinite(top) && Number.isFinite(viewportHeight)
      ? viewportHeight - top
      : reportedHeight;
    // 原生推的是物理像素 → 换算成 CSS 像素再进布局
    const height = cssKeyboardHeightFromNative(physical);
    if (height > 0) {
      logger.info("[h5KeyboardChange] 计算键盘高度", {
        top,
        viewportHeight,
        reportedHeight,
        physical,
        height,
        dpr: readDevicePixelRatio(),
      });
      pinLayoutViewport();
      h5KeyboardAuthoritative = true;
      applyKeyboardHeight(height, true);
    } else {
      logger.info("[h5KeyboardChange] 计算键盘高度为 0，不处理", { top, viewportHeight, reportedHeight, physical });
    }
  }

  function onKeyboardHeightChange(event: { height?: number }) {
    // uni.onKeyboardHeightChange 已在内部归一成 CSS px；优先级低于 mPaaS 原生通道，
    // 一旦 h5KeyboardChange / keyboardHeightChange 可信就不再覆盖，也不抢占「原生权威」身份
    if (h5KeyboardAuthoritative) return;
    applyKeyboardHeight(Number(event?.height) || 0, false);
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
      // H5 容器中 Native 主动推送的前端事件，用 document.addEventListener 注册
      document.addEventListener("h5KeyboardChange", onH5KeyboardChangeEvent);
      logger.info("[h5KeyboardChange] 已通过 document.addEventListener 注册监听");
      disposeH5Keyboard = () => {
        document.removeEventListener("h5KeyboardChange", onH5KeyboardChangeEvent);
        logger.info("[h5KeyboardChange] 已解绑 document.addEventListener 监听");
      };
    }
    disposeNativeKeyboard = onNativeEvent("keyboardHeightChange", onNativeKeyboardHeight);
  });

  onBeforeUnmount(() => {
    if (collapseTimer) clearTimeout(collapseTimer);
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
    disposeH5Keyboard?.();
    disposeH5Keyboard = null;
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

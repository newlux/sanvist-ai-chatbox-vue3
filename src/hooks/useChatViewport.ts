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
export function useChatViewport(options: { recoverKeyboardOnBlur?: () => boolean } = {}) {
  const recoverKeyboard = () => options.recoverKeyboardOnBlur?.() === true;
  /** 输入栏实测高度；尚未量到时用一个接近胶囊+页脚的兜底值 */
  const FALLBACK_DOCK_HEIGHT_PX = 120;

  const windowHeight = ref(0);
  const inputDockHeight = ref(0);
  const measuredKeyboardHeight = ref(0);
  const focusOwner = ref<FocusOwner>("none");
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let inputFocused = false;
  let h5KeyboardAuthoritative = false;
  let viewportSawKeyboard = false;
  let focusGeneration = 0;
  let keyboardClosedAt = -Infinity;
  let disposeNativeKeyboard: (() => void) | null = null;
  let disposeH5Keyboard: (() => void) | null = null;
  let disposeNativeResume: (() => void) | null = null;
  let viewportObserver: ResizeObserver | null = null;
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

  /**
   * 固定底部 UI 盖住消息列表的高度（输入栏 + 键盘抬升）。
   *
   * 这里只报「被盖住」的高度，不含最后一条与输入栏之间的空隙：
   * 消息列表按这个值算「参考来源该藏到哪」，再自己加空隙当 padding。
   * 混在一起的话，回复末尾会对齐到「遮挡 + 空隙」的位置，参考来源的头几个像素
   * 正好露在空隙里，看着像被输入栏裁掉一行。
   */
  const composerBottomInset = computed(() => {
    const lift = Math.max(0, Number(measuredKeyboardHeight.value) || 0);
    const dock = inputDockHeight.value || FALLBACK_DOCK_HEIGHT_PX;
    return `${dock + lift}px`;
  });

  const composerDockOffset = computed(() => {
    const dock = inputDockHeight.value || FALLBACK_DOCK_HEIGHT_PX;
    return `${dock}px`;
  });

  function setInputDockHeight(height: number) {
    const next = Math.max(0, Math.round(Number(height) || 0));
    if (next !== inputDockHeight.value) inputDockHeight.value = next;
  }

  /**
   * 页面高度连量三次的原因：宿主转屏是异步的。
   *
   * 从横屏调度视图（pushWindow 开的场景窗口）返回本页时，onShow 往往在设备转回竖屏之前就触发了，
   * 这一刻拿到的可能仍是横屏高度。返回信号先补量，视口尺寸真的变化时再同步一次。
   */
  const WINDOW_HEIGHT_RETRY_DELAYS = [120, 400];

  let heightSyncTimers: Array<ReturnType<typeof setTimeout>> = [];

  function clearHeightSyncTimers() {
    heightSyncTimers.forEach(timer => clearTimeout(timer));
    heightSyncTimers = [];
  }

  /** 真正读取并写入高度（不变就不触发重渲染） */
  function applyWindowHeight() {
    if (recoverKeyboard() && Date.now() - keyboardClosedAt < KEYBOARD_COLLAPSE_DELAY_MS) return;
    const next = Number(uni.getSystemInfoSync().windowHeight) || 0;
    if (next <= 0) return;
    if (Math.abs(next - windowHeight.value) < 1) return;
    logger.debug("同步页面高度", { from: windowHeight.value, to: next });
    windowHeight.value = next;
  }

  function syncWindowHeight() {
    if (!measuredKeyboardHeight.value) applyWindowHeight();
    if (typeof window === "undefined") return;
    clearHeightSyncTimers();
    WINDOW_HEIGHT_RETRY_DELAYS.forEach((delay) => {
      heightSyncTimers.push(setTimeout(() => {
        // 键盘弹着的时候可视区高度会被压缩，不能跟着改（输入栏自己按键盘高度抬升）
        if (measuredKeyboardHeight.value > 0) return;
        applyWindowHeight();
      }, delay));
    });
  }

  function normalizeKeyboardHeight(height: unknown) {
    const raw = Math.max(0, Number(height) || 0);
    const limit = windowHeight.value > 0 ? windowHeight.value * 0.6 : 0;
    return limit > 0 && raw > limit ? limit : raw;
  }

  function applyKeyboardHeight(height: unknown, fromNative = false) {
    if (recoverKeyboard() && !inputFocused) return;
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
      if (live <= 0 && (!recoverKeyboard() || !inputFocused)) focusOwner.value = "none";
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
    if (!inputFocused && !measuredKeyboardHeight.value) {
      if (recoverKeyboard() && Date.now() - keyboardClosedAt < KEYBOARD_COLLAPSE_DELAY_MS) return;
      // 转屏也会改变可视高度。未编辑时用新视口重建基线，避免拿竖屏高度猜出一个键盘。
      baseViewportHeight = Number(window.visualViewport?.height) || window.innerHeight;
      applyWindowHeight();
      return;
    }
    const height = readViewportKeyboardHeight();
    if (height > 0) {
      viewportSawKeyboard = true;
      pinLayoutViewport();
    }
    else if (recoverKeyboard() && viewportSawKeyboard) {
      // 曾实测视口被键盘压缩，现在已恢复；即使宿主漏发高度 0 也能收尾。
      h5KeyboardAuthoritative = false;
      viewportSawKeyboard = false;
    }
    applyKeyboardHeight(height);
  }

  function onViewportReturn() {
    if (typeof document === "undefined" || document.hidden) return;
    onViewportChange();
    syncWindowHeight();
  }

  /** 方向变化：页面高度会跟着变，多量两帧等它稳定 */
  function onOrientationChange() {
    if (measuredKeyboardHeight.value > 0) return;
    onViewportReturn();
  }

  function onFocusIn(event?: FocusEvent) {
    const owner = resolveFocusOwner(event?.target || null);
    if (recoverKeyboard() && owner === "none") return;
    if (owner !== "none") focusOwner.value = owner;
    inputFocused = true;
    const generation = ++focusGeneration;
    pinLayoutViewport();
    applyKeyboardHeight(readViewportKeyboardHeight());
    [60, 260].forEach((delay) => {
      setTimeout(() => {
        if (recoverKeyboard() && (!inputFocused || generation !== focusGeneration)) return;
        pinLayoutViewport();
        applyKeyboardHeight(readViewportKeyboardHeight());
      }, delay);
    });
  }

  function onFocusOut(event: FocusEvent) {
    inputFocused = false;
    if (recoverKeyboard() && resolveFocusOwner(event.target) !== "none") {
      resetKeyboardHeight();
    }
  }

  function onWindowScroll() {
    if (measuredKeyboardHeight.value > 0) pinLayoutViewport();
  }

  function clearKeyboardState() {
    if (recoverKeyboard() && measuredKeyboardHeight.value) keyboardClosedAt = Date.now();
    inputFocused = false;
    focusGeneration += 1;
    h5KeyboardAuthoritative = false;
    viewportSawKeyboard = false;
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = null;
    measuredKeyboardHeight.value = 0;
    focusOwner.value = "none";
  }

  function forceCollapse() {
    if (recoverKeyboard()) {
      const activeInput = document.activeElement as HTMLElement | null;
      const wasOpen = measuredKeyboardHeight.value > 0;
      clearKeyboardState();
      // iOS 原生收起可能仍保留焦点。释放本次焦点，让再次点同一个输入框能重新测量。
      if (wasOpen && resolveFocusOwner(activeInput) !== "none") activeInput?.blur();
      return;
    }
    if (measuredKeyboardHeight.value <= 0) return;
    clearKeyboardState();
    try {
      uni.hideKeyboard();
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // 个别容器没有 activeElement，忽略
    }
  }

  function onDocumentTouchStart(event: TouchEvent) {
    if (recoverKeyboard()) return;
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
    if (recoverKeyboard() && !inputFocused) return;
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
    if (recoverKeyboard() && !inputFocused) return;

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
    if (recoverKeyboard()) {
      clearKeyboardState();
      return;
    }
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
      window.addEventListener("orientationchange", onOrientationChange);
      window.addEventListener("pageshow", onViewportReturn);
      document.addEventListener("visibilitychange", onViewportReturn);
      document.addEventListener("focusin", onFocusIn);
      document.addEventListener("focusout", onFocusOut);
      document.addEventListener("touchstart", onDocumentTouchStart, { passive: true });
      window.visualViewport?.addEventListener("resize", onViewportChange);
      window.visualViewport?.addEventListener("scroll", onViewportChange);
      if (typeof ResizeObserver !== "undefined") {
        viewportObserver = new ResizeObserver(onViewportChange);
        viewportObserver.observe(document.documentElement);
      }
      // H5 容器中 Native 主动推送的前端事件，用 document.addEventListener 注册
      document.addEventListener("h5KeyboardChange", onH5KeyboardChangeEvent);
      logger.info("[h5KeyboardChange] 已通过 document.addEventListener 注册监听");
      disposeH5Keyboard = () => {
        document.removeEventListener("h5KeyboardChange", onH5KeyboardChangeEvent);
        logger.info("[h5KeyboardChange] 已解绑 document.addEventListener 监听");
      };
    }
    disposeNativeKeyboard = onNativeEvent("keyboardHeightChange", onNativeKeyboardHeight);
    // 独立甘特图容器关闭时，原 WebView 有时只收到宿主 resume。
    disposeNativeResume = onNativeEvent("resume", onViewportReturn);
  });

  onBeforeUnmount(() => {
    if (recoverKeyboard()) clearKeyboardState();
    if (collapseTimer) clearTimeout(collapseTimer);
    clearHeightSyncTimers();
    uni.offKeyboardHeightChange?.(onKeyboardHeightChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.removeEventListener("pageshow", onViewportReturn);
      document.removeEventListener("visibilitychange", onViewportReturn);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("touchstart", onDocumentTouchStart);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    }
    disposeNativeKeyboard?.();
    disposeNativeKeyboard = null;
    disposeNativeResume?.();
    viewportObserver?.disconnect();
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

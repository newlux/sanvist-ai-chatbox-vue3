import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createLogger } from "@/utils/logger";

const logger = createLogger("keyboard");

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

export function useChatViewport() {
  const windowHeight = ref(0);
  const keyboardHeight = ref(0);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let inputFocused = false;
  /** 当前用的是估算值而不是实测值：失焦时要主动清 */
  let usingFallbackHeight = false;
  /**
   * 没有键盘时的可视高度基准。
   * 安卓部分浏览器弹键盘时会把布局视口一起缩掉，此时 innerHeight 和 visualViewport.height
   * 一样高，差值恒为 0，键盘就被算成「没弹」。记一个基准值才能算出真实占用高度。
   */
  let baseViewportHeight = 0;

  /**
   * 页面高度始终占满窗口，不随键盘压缩。
   * 键盘弹起由输入栏自己 translateY 上移（见 ai-chat-input），
   * 整页缩放会让消息列表跟着重排，长列表上一次抖动很明显。
   */
  const chatViewportStyle = computed(() =>
    windowHeight.value > 0 ? { height: `${windowHeight.value}px` } : {},
  );

  const isKeyboardOpen = computed(() => keyboardHeight.value > 0);

  function syncWindowHeight() {
    windowHeight.value = Number(uni.getSystemInfoSync().windowHeight) || 0;
  }

  /** 夹到合理区间，超过窗口 60% 的值一律按异常处理 */
  function normalizeKeyboardHeight(height: unknown) {
    const raw = Math.max(0, Number(height) || 0);
    const limit = windowHeight.value > 0 ? windowHeight.value * 0.6 : 0;
    return limit > 0 && raw > limit ? limit : raw;
  }

  /**
   * 键盘动画期间会连着回调好几次，中间还会夹一个 0（尤其是焦点从一个输入框切到另一个时）。
   * 直接照单全收，输入栏就会跟着上下弹。
   * 规则：抬起立即跟手，落下延后 160ms 确认，期间只要来了正值就作废这次收起；
   * 几像素的抖动直接忽略。
   */
  function applyKeyboardHeight(height: unknown) {
    const next = normalizeKeyboardHeight(height);
    // 实测值一到就接管，估算值让位
    if (next > 0) usingFallbackHeight = false;
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    if (next > 0) {
      if (Math.abs(next - keyboardHeight.value) < 4) return;
      keyboardHeight.value = next;
      return;
    }

    if (keyboardHeight.value === 0) return;
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      // blur 不等于键盘真的收了：焦点在两个输入框之间转移时键盘一直在，
      // 这时候归零，之后又等不到新的 visualViewport 回调，输入栏就再也浮不起来了。
      // 落听之前以实际视口为准复核一次。
      const live = readViewportKeyboardHeight();
      keyboardHeight.value = live > 0 ? live : 0;
    }, KEYBOARD_COLLAPSE_DELAY_MS);
  }

  /**
   * 浏览器不会告诉你键盘多高，只能靠 visualViewport 反推：
   * 键盘占掉的高度 = 布局视口高 - 可视视口高 - 可视视口相对布局视口的偏移。
   * 这是 H5 上唯一可靠的口径，iOS（键盘覆盖内容）和安卓（缩可视视口）都适用。
   */
  /** 估一个键盘高度：屏高的 42%，夹在 260~360px 之间 */
  function estimateKeyboardHeight() {
    const base = windowHeight.value || window.innerHeight || 0;
    if (!base) return FALLBACK_KEYBOARD_RANGE.min;
    const estimated = Math.round(base * FALLBACK_KEYBOARD_RATIO);
    return Math.min(FALLBACK_KEYBOARD_RANGE.max, Math.max(FALLBACK_KEYBOARD_RANGE.min, estimated));
  }

  function readViewportKeyboardHeight() {
    const viewport = window.visualViewport;
    // 没有 visualViewport（老安卓 WebView）：退而求其次，看布局视口有没有被缩掉
    if (!viewport) {
      const shrunk = baseViewportHeight - window.innerHeight;
      return shrunk > MIN_KEYBOARD_HEIGHT_PX ? Math.round(shrunk) : 0;
    }
    const layoutHeight = Math.max(window.innerHeight, baseViewportHeight);
    const occluded = layoutHeight - viewport.height - viewport.offsetTop;
    if (occluded > MIN_KEYBOARD_HEIGHT_PX) return Math.round(occluded);
    // 判定为无键盘时顺带校准基准，覆盖旋转屏、地址栏收缩等情况
    baseViewportHeight = Math.max(baseViewportHeight, viewport.height);
    return 0;
  }

  /**
   * 把布局视口按回原点。
   * iOS 在输入框聚焦时会先把整页往上推一段再弹键盘，推的是 window/scrollingElement，
   * 和我们自己改 bottom 的位移叠加就会顶过头。body 已经 position:fixed 锁死，
   * 这里再兜一道，覆盖个别容器仍能滚动的情况。
   */
  function pinLayoutViewport() {
    if (typeof window === "undefined") return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller && scroller.scrollTop !== 0) scroller.scrollTop = 0;
  }

  function onViewportChange() {
    const height = readViewportKeyboardHeight();
    if (height > 0) pinLayoutViewport();
    applyKeyboardHeight(height);
  }

  /**
   * 聚焦瞬间就把页面按住，不等 visualViewport 回调（那时候页面已经被推上去了）。
   * 同时主动读一次实际高度：键盘本来就没收起来的情况下不会再有 resize 事件，
   * 只靠事件驱动会一直停在 0。
   */
  function onFocusIn() {
    inputFocused = true;
    pinLayoutViewport();
    applyKeyboardHeight(readViewportKeyboardHeight());
    [60, 260].forEach((delay) => {
      setTimeout(() => {
        pinLayoutViewport();
        applyKeyboardHeight(readViewportKeyboardHeight());
      }, delay);
    });

    // 兜底：等键盘动画结束后仍然量不到高度，说明这台设备测不出来，用估算值顶上
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!inputFocused || keyboardHeight.value > 0) return;
      const estimated = estimateKeyboardHeight();
      usingFallbackHeight = true;
      keyboardHeight.value = estimated;
      logger.warn("量不到键盘高度，启用兜底估算值", {
        estimated,
        windowHeight: windowHeight.value,
        hasVisualViewport: Boolean(window.visualViewport),
      });
    }, FALLBACK_DELAY_MS);
  }

  /** 失焦：兜底值必须跟着清掉，否则输入栏会一直悬在半空 */
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
    if (keyboardHeight.value > 0) pinLayoutViewport();
  }

  // 小程序 / App 走平台回调；H5 上这个 API 是空实现，不会触发
  function onKeyboardHeightChange(event: { height?: number }) {
    applyKeyboardHeight(event?.height);
  }

  /** 失焦、点遮罩的主动收起：同样走延迟通道，避免和紧接着的聚焦事件打架 */
  function resetKeyboardHeight() {
    applyKeyboardHeight(0);
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
      window.visualViewport?.addEventListener("resize", onViewportChange);
      window.visualViewport?.addEventListener("scroll", onViewportChange);
    }
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
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    }
  });

  return {
    chatViewportStyle,
    keyboardHeight,
    isKeyboardOpen,
    syncWindowHeight,
    resetKeyboardHeight,
  };
}

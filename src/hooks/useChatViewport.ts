import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createLogger } from "@/utils/logger";
import { onNativeEvent } from "@/utils/platform/mpaas";

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
/** 聚焦启动窗口内原生常先推一次 0；这不是收起事件。 */
const VOICE_FOCUS_SETTLE_MS = 700;

export function useChatViewport() {
  const windowHeight = ref(0);
  const keyboardHeight = ref(0);
  const voiceKeyboardHeight = ref(0);
  /** WebView 未随键盘缩小时为覆盖模式，需要由输入栏 fixed 上移。 */
  const keyboardOverlaysViewport = ref(true);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceCollapseTimer: ReturnType<typeof setTimeout> | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let voiceFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let inputFocused = false;
  /** 语音确认框使用真实键盘编辑，但不能驱动普通 chat-input 的浮动布局。 */
  let ignoreKeyboardLayout = false;
  /** 组件显式声明当前处于语音编辑（经 touchstart 提前置位，避免 DOM 判定不可靠）。 */
  let voiceEditingActive = false;
  /** 当前用的是估算值而不是实测值：失焦时要主动清 */
  let usingFallbackHeight = false;
  /** 语音编辑同样可能只能估算键盘高度；此时不能用视口 0 误判为收起。 */
  let usingVoiceFallbackHeight = false;
  /** 本轮语音编辑是否已经收到过一次可信的正键盘高度。 */
  let voicePositiveHeightObserved = false;
  /** 本轮语音编辑开始时间，过滤聚焦动画起步阶段的零高度事件。 */
  let voiceFocusStartedAt = 0;
  /** 宿主推过键盘高度：推过就以它为准，不再启用估算值 */
  let nativeKeyboardSupported = false;
  let disposeNativeKeyboard: (() => void) | null = null;
  /** 无键盘时的布局/可视视口基准，必须分开记录，不能混用两种口径。 */
  let baseLayoutHeight = 0;
  let baseVisualHeight = 0;

  /**
   * resize 模式下跟随宿主缩小后的布局视口；overlay 模式仍保持初始窗口高度，
   * 由输入栏 fixed 到键盘上沿。两种模式不能同时补偿，否则输入栏会被重复抬高。
   */
  const chatViewportStyle = computed(() => {
    if (windowHeight.value <= 0) return {};
    if (!keyboardOverlaysViewport.value && typeof window !== "undefined") {
      return { height: `${window.innerHeight}px` };
    }
    return { height: `${windowHeight.value}px` };
  });

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

  function collapseVoiceKeyboard(reason: string) {
    if (!voiceEditingActive && voiceKeyboardHeight.value <= 0) return;
    logger.info("收起语音编辑键盘", { reason, voiceKeyboardHeight: voiceKeyboardHeight.value });
    voiceEditingActive = false;
    ignoreKeyboardLayout = false;
    inputFocused = false;
    usingVoiceFallbackHeight = false;
    voicePositiveHeightObserved = false;
    voiceFocusStartedAt = 0;
    voiceKeyboardHeight.value = 0;
    try {
      uni.hideKeyboard();
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // 个别容器没有 activeElement，忽略
    }
  }

  /**
   * 键盘动画期间会连着回调好几次，中间还会夹一个 0（尤其是焦点从一个输入框切到另一个时）。
   * 直接照单全收，输入栏就会跟着上下弹。
   * 规则：抬起立即跟手，落下延后 160ms 确认，期间只要来了正值就作废这次收起；
   * 几像素的抖动直接忽略。
   */
  function canCollapseVoiceFromZeroHeight() {
    const focusSettled = voiceFocusStartedAt > 0
      && Date.now() - voiceFocusStartedAt >= VOICE_FOCUS_SETTLE_MS;
    return voicePositiveHeightObserved && focusSettled && !usingVoiceFallbackHeight;
  }

  function applyVoiceKeyboardHeight(height: unknown) {
    const next = normalizeKeyboardHeight(height);
    if (next > 0) {
      // 一旦拿到实测高度，估算值立即让位，后续 0 才可以参与真实收起判定。
      usingVoiceFallbackHeight = false;
      voicePositiveHeightObserved = true;
      if (voiceCollapseTimer) {
        clearTimeout(voiceCollapseTimer);
        voiceCollapseTimer = null;
      }
      if (Math.abs(next - voiceKeyboardHeight.value) >= 4) voiceKeyboardHeight.value = next;
      return;
    }
    if (!ignoreKeyboardLayout) {
      usingVoiceFallbackHeight = false;
      voiceKeyboardHeight.value = 0;
      return;
    }
    // 聚焦启动期的 0，以及从未观察到正高度的 0，都不能证明键盘已收起。
    // 完全量不到高度的设备会走 fallback；它们同样不能靠 0 判断收起。
    if (!canCollapseVoiceFromZeroHeight()) return;
    // Android 返回键只会收键盘，不一定触发 textarea blur。延迟复核一次，
    // 排除键盘动画中间态的 0；确认已收起后主动摘掉焦点，复用现有 blur 链路。
    if (voiceKeyboardHeight.value <= 0 || voiceCollapseTimer) return;
    voiceCollapseTimer = setTimeout(() => {
      voiceCollapseTimer = null;
      if (!voiceEditingActive || readViewportKeyboardHeight() > 0) return;
      collapseVoiceKeyboard("viewport-zero");
    }, KEYBOARD_COLLAPSE_DELAY_MS);
  }

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
      if (ignoreKeyboardLayout) {
        keyboardHeight.value = 0;
        return;
      }
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
    const layoutShrink = baseLayoutHeight - window.innerHeight;

    // 没有 visualViewport（老安卓 WebView）：退而求其次，看布局视口有没有被缩掉
    if (!viewport) {
      keyboardOverlaysViewport.value = layoutShrink <= MIN_KEYBOARD_HEIGHT_PX;
      return layoutShrink > MIN_KEYBOARD_HEIGHT_PX ? Math.round(layoutShrink) : 0;
    }

    const visualShrink = baseVisualHeight - viewport.height - viewport.offsetTop;
    const height = Math.max(layoutShrink, visualShrink);
    // 只要布局视口或可视视口已经缩小，就由 WebView 自己承接键盘位移。
    // 此时再给 fixed 面板加 bottom=键盘高度，会出现一整段重复补偿空白。
    keyboardOverlaysViewport.value = height <= MIN_KEYBOARD_HEIGHT_PX;
    if (height > MIN_KEYBOARD_HEIGHT_PX) return Math.round(height);

    // 只有没有任何输入焦点和键盘占位时才能校准基准。键盘动画刚开始时会短暂
    // 报很小的高度甚至 0；此时重置基准会把正常弹起误判为收起。
    if (!inputFocused && !voiceEditingActive && keyboardHeight.value <= 0 && voiceKeyboardHeight.value <= 0) {
      baseLayoutHeight = window.innerHeight;
      baseVisualHeight = viewport.height;
      keyboardOverlaysViewport.value = true;
    }
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
    if (ignoreKeyboardLayout) {
      applyVoiceKeyboardHeight(height);
      return;
    }
    applyKeyboardHeight(height);
  }

  /**
   * 聚焦瞬间就把页面按住，不等 visualViewport 回调（那时候页面已经被推上去了）。
   * 同时主动读一次实际高度：键盘本来就没收起来的情况下不会再有 resize 事件，
   * 只靠事件驱动会一直停在 0。
   */
  function onFocusIn(event: FocusEvent) {
    const target = event.target as HTMLElement | null;
    const domVoice = Boolean(target?.closest?.("[data-voice-confirm-input=\"true\"]"));
    if (domVoice && !voiceEditingActive) {
      voiceEditingActive = true;
      voicePositiveHeightObserved = false;
      voiceFocusStartedAt = Date.now();
    }
    ignoreKeyboardLayout = voiceEditingActive || domVoice;
    inputFocused = !ignoreKeyboardLayout;
    pinLayoutViewport();
    if (ignoreKeyboardLayout) {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      keyboardHeight.value = 0;
      applyVoiceKeyboardHeight(readViewportKeyboardHeight());
      return;
    }
    voiceKeyboardHeight.value = 0;
    applyKeyboardHeight(readViewportKeyboardHeight());
    [60, 260].forEach((delay) => {
      setTimeout(() => {
        if (!inputFocused || ignoreKeyboardLayout) return;
        pinLayoutViewport();
        applyKeyboardHeight(readViewportKeyboardHeight());
      }, delay);
    });

    // 兜底：等键盘动画结束后仍然量不到高度，说明这台设备测不出来，用估算值顶上
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!inputFocused || keyboardHeight.value > 0 || nativeKeyboardSupported) return;
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

  /**
   * uni-app 的 textarea 会包一层自定义元素，原生 focusin 目标在部分 WebView 中无法可靠识别。
   * 组件通过该入口显式声明语音编辑焦点，并独立测量/兜底键盘高度。
   */
  function setVoiceInputFocused(focused: boolean) {
    const startingVoiceEdit = focused && !voiceEditingActive;
    if (voiceFallbackTimer) {
      clearTimeout(voiceFallbackTimer);
      voiceFallbackTimer = null;
    }
    if (!focused && voiceCollapseTimer) {
      clearTimeout(voiceCollapseTimer);
      voiceCollapseTimer = null;
    }
    voiceEditingActive = focused;
    ignoreKeyboardLayout = focused;
    inputFocused = false;
    if (!focused) {
      if (voiceFallbackTimer) {
        clearTimeout(voiceFallbackTimer);
        voiceFallbackTimer = null;
      }
      usingVoiceFallbackHeight = false;
      voicePositiveHeightObserved = false;
      voiceFocusStartedAt = 0;
      voiceKeyboardHeight.value = 0;
      return;
    }
    if (startingVoiceEdit) {
      voicePositiveHeightObserved = false;
      voiceFocusStartedAt = Date.now();
    }
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
    keyboardHeight.value = 0;

    [0, 60, 260].forEach((delay) => {
      setTimeout(() => {
        if (!ignoreKeyboardLayout) return;
        pinLayoutViewport();
        applyVoiceKeyboardHeight(readViewportKeyboardHeight());
      }, delay);
    });

    voiceFallbackTimer = setTimeout(() => {
      voiceFallbackTimer = null;
      if (!ignoreKeyboardLayout || voiceKeyboardHeight.value > 0) return;
      usingVoiceFallbackHeight = true;
      voiceKeyboardHeight.value = estimateKeyboardHeight();
    }, FALLBACK_DELAY_MS);
  }

  /** 失焦：兜底值必须跟着清掉，否则输入栏会一直悬在半空 */
  function onFocusOut() {
    inputFocused = false;
    if (!ignoreKeyboardLayout) voiceKeyboardHeight.value = 0;
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

  /**
   * 主动收起：把焦点也一起摘掉，否则输入框还持有焦点，
   * 下次点它不会再触发 focusin，输入栏就浮不起来了。
   */
  function forceCollapse(reason: string) {
    if (keyboardHeight.value <= 0) return;
    logger.info("收起键盘", { reason, keyboardHeight: keyboardHeight.value });
    usingFallbackHeight = false;
    inputFocused = false;
    keyboardHeight.value = 0;
    try {
      uni.hideKeyboard();
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      // 个别容器没有 activeElement，忽略
    }
  }

  /**
   * 「键盘区域收到了触摸」＝ 键盘其实已经不在了。
   *
   * 安卓用返回键收起输入法时既不触发 blur，也没有任何视口变化，端上完全无感知。
   * 但有一点是确定的：键盘真盖在那儿的时候，那块区域的触摸事件归输入法，
   * WebView 收不到。所以只要我们认为「键盘占着」的那段高度里冒出了 touch，
   * 就说明它已经收了 —— 据此把状态归位。
   */
  function onDocumentTouchStart(event: TouchEvent) {
    const activeHeight = voiceEditingActive ? voiceKeyboardHeight.value : keyboardHeight.value;
    if (activeHeight <= 0) return;
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (!touch) return;
    const viewportBase = baseLayoutHeight || window.innerHeight;
    const keyboardTop = viewportBase - activeHeight;
    if (touch.clientY <= keyboardTop) return;
    if (voiceEditingActive) collapseVoiceKeyboard("touch-in-keyboard-zone");
    else forceCollapse("touch-in-keyboard-zone");
  }

  /**
   * 宿主如果主动推键盘高度，一律以它为准 —— 这是唯一能精确拿到高度、
   * 也是唯一能感知「返回键收起输入法」的通道。约定：事件名 keyboardHeightChange，
   * payload 形如 { height: 0 | 正数 }（单位 px）。宿主没推就是空转。
   */
  function onNativeKeyboardHeight(payload: { height?: number | string }) {
    const height = Number(payload?.height);
    if (!Number.isFinite(height)) return;
    if (ignoreKeyboardLayout) {
      if (height <= 0) {
        if (canCollapseVoiceFromZeroHeight()) collapseVoiceKeyboard("native-event");
      } else {
        // 原生事件可能先于 resize 到达；主动读一次视口只用于判断是否需要手动抬升。
        readViewportKeyboardHeight();
        applyVoiceKeyboardHeight(height);
      }
      return;
    }
    logger.info("收到宿主推送的键盘高度", { height });
    nativeKeyboardSupported = true;
    if (height <= 0) {
      forceCollapse("native-event");
      return;
    }
    applyKeyboardHeight(height);
  }

  /** 失焦、点遮罩的主动收起：同样走延迟通道，避免和紧接着的聚焦事件打架 */
  function resetKeyboardHeight() {
    applyKeyboardHeight(0);
  }

  onMounted(() => {
    syncWindowHeight();
    baseLayoutHeight = Number(window?.innerHeight) || 0;
    baseVisualHeight = Number(window?.visualViewport?.height) || baseLayoutHeight;
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
    ignoreKeyboardLayout = false;
    if (collapseTimer) clearTimeout(collapseTimer);
    if (voiceCollapseTimer) clearTimeout(voiceCollapseTimer);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (voiceFallbackTimer) clearTimeout(voiceFallbackTimer);
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
    keyboardOverlaysViewport,
    isKeyboardOpen,
    syncWindowHeight,
    resetKeyboardHeight,
    setVoiceInputFocused,
  };
}

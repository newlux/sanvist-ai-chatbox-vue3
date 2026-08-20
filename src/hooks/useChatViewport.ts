import { computed, onBeforeUnmount, onMounted, ref } from "vue";

/** 收起延迟：盖过基础库在键盘动画中途插入的那一个 0 */
const KEYBOARD_COLLAPSE_DELAY_MS = 160;

export function useChatViewport() {
  const windowHeight = ref(0);
  const keyboardHeight = ref(0);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * 归一化键盘高度。
   * 各基础库回调的单位并不统一：有的给 px，有的给 rpx（数值约为 px 的两倍）。
   * 直接拿来做位移就会「先窜到顶再落回来」，所以超过窗口 60% 的值一律按 rpx 换算，
   * 再统一夹到合理区间。原始值一并打日志，真机上一看就知道走的是哪种单位。
   */
  function normalizeKeyboardHeight(height: unknown) {
    const raw = Math.max(0, Number(height) || 0);
    const limit = windowHeight.value > 0 ? windowHeight.value * 0.6 : 0;
    let next = raw;
    if (limit > 0 && raw > limit) {
      const converted = Number(uni.upx2px?.(raw)) || 0;
      next = converted > 0 && converted <= limit ? converted : limit;
    }
    if (raw !== next) {
      console.info("[keyboard] 高度已归一化", { raw, next, windowHeight: windowHeight.value });
    }
    return next;
  }

  /**
   * 键盘动画期间基础库会连着回调好几次，中间还会夹一个 0（尤其是聚焦从一个输入框
   * 切到另一个时）。直接照单全收，输入栏就会跟着上下弹。
   * 规则：抬起立即跟手，落下延后 160ms 确认，期间只要来了正值就作废这次收起；
   * 几像素的抖动直接忽略。
   */
  function applyKeyboardHeight(height: unknown) {
    const next = normalizeKeyboardHeight(height);
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
      keyboardHeight.value = 0;
    }, KEYBOARD_COLLAPSE_DELAY_MS);
  }

  // 支付宝走页面级 onKeyboardHeight（uni 内部转发成这个回调）
  function onKeyboardHeightChange(event: { height?: number }) {
    // 抖动多半来自基础库的回调序列，原始值先记下来，真机上一看便知
    console.info("[keyboard] onKeyboardHeight", event?.height);
    applyKeyboardHeight(event?.height);
  }

  /** 失焦/点遮罩的主动收起：同样走延迟通道，避免和紧接着的聚焦事件打架 */
  function resetKeyboardHeight() {
    applyKeyboardHeight(0);
  }

  onMounted(() => {
    syncWindowHeight();
    uni.onKeyboardHeightChange?.(onKeyboardHeightChange);
  });

  onBeforeUnmount(() => {
    if (collapseTimer) clearTimeout(collapseTimer);
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

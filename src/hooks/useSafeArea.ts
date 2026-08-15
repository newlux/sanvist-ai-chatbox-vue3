import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSystemStore } from "@/stores/modules/system";
import { isDebugLogEnabled } from "@/utils/debug";

export interface UseSafeAreaOptions {
  /**
   * iOS mPaaS WebView 下所有可信安全区数据缺失时的保守兜底（单位 px）。
   * 传 0 可禁用兜底，默认 20。
   */
  mpaasFallbackPx?: number;
}

/**
 * 底部安全区 hook，供各页面/组件复用。
 *
 * 多级数据源（优先级从高到低）：
 * 1. uni.getSystemInfoSync().safeAreaInsets.bottom
 * 2. screenHeight - safeArea.bottom
 * 3. mPaaS getPhoneSizesInfo 的 tabbarHeight（systemStore）
 * 4. iOS mPaaS 环境固定兜底（mpaasFallbackPx）
 *
 * 同时输出 rpx 与 px：普通文档流布局可继续使用 --safe-bottom，
 * position: fixed 与键盘/visualViewport 相关布局应使用 --safe-bottom-px。
 */
export function useSafeArea(options: UseSafeAreaOptions = {}) {
  const { mpaasFallbackPx = 20 } = options;
  const systemStore = useSystemStore();
  const safeBottomPx = ref(0);
  const safeBottomRpx = ref(0);
  let refreshFrame = 0;

  function computeSafeBottom() {
    try {
      const info = typeof uni !== "undefined" ? uni.getSystemInfoSync?.() : null;
      const windowWidth = Number(info?.windowWidth) || 375;
      const screenHeight = Number(info?.screenHeight) || 0;
      const innerHeight = typeof window !== "undefined" ? window.innerHeight : 0;
      let px = Number(info?.safeAreaInsets?.bottom) || 0;
      let source = px > 0 ? "safeAreaInsets.bottom" : "";

      if (px <= 0) {
        const safeAreaBottom = Number(info?.safeArea?.bottom) || 0;
        if (safeAreaBottom > 0 && screenHeight > safeAreaBottom) {
          px = screenHeight - safeAreaBottom;
          source = "screenHeight-safeArea.bottom";
        }
      }

      const alipayJSBridge = globalThis as typeof globalThis & { AlipayJSBridge?: unknown };
      if (px <= 0 && systemStore.isIOS) {
        const tabbarHeight = Number(systemStore.tabbarHeight) || 0;
        if (tabbarHeight > 0) {
          px = tabbarHeight;
          source = "tabbarHeight";
        }
      }

      if (px <= 0 && systemStore.isIOS && mpaasFallbackPx > 0 && alipayJSBridge.AlipayJSBridge) {
        px = mpaasFallbackPx;
        source = "iosMpaasFallback";
      }

      safeBottomPx.value = Math.max(0, Math.round(px));
      safeBottomRpx.value = safeBottomPx.value > 0
        ? Math.round((safeBottomPx.value * 750) / windowWidth)
        : 0;

      if (isDebugLogEnabled()) {
        console.info("[safe-area]", {
          source: source || "none",
          finalPx: safeBottomPx.value,
          finalRpx: safeBottomRpx.value,
          safeAreaInsets: info?.safeAreaInsets ?? null,
          safeArea: info?.safeArea ?? null,
          screenHeight: info?.screenHeight ?? null,
          windowWidth: info?.windowWidth ?? null,
          windowHeight: info?.windowHeight ?? null,
          innerHeight,
          tabbarHeight: systemStore.tabbarHeight,
          isIOS: systemStore.isIOS,
        });
      }
    }
    catch {
      safeBottomPx.value = 0;
      safeBottomRpx.value = 0;
    }
  }

  function scheduleRefresh() {
    if (typeof window === "undefined") {
      computeSafeBottom();
      return;
    }
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      computeSafeBottom();
    });
  }

  watch(() => [systemStore.tabbarHeight, systemStore.isIOS], scheduleRefresh);

  onMounted(() => {
    computeSafeBottom();
    if (typeof window === "undefined") return;

    window.addEventListener("resize", scheduleRefresh);
    window.addEventListener("orientationchange", scheduleRefresh);
    window.visualViewport?.addEventListener("resize", scheduleRefresh);
  });

  onBeforeUnmount(() => {
    if (typeof window === "undefined") return;
    window.removeEventListener("resize", scheduleRefresh);
    window.removeEventListener("orientationchange", scheduleRefresh);
    window.visualViewport?.removeEventListener("resize", scheduleRefresh);
    if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
  });

  /** 注入安全区 CSS 变量，可展开合并到任意根节点的 style 绑定。 */
  const safeAreaStyle = computed<Record<string, string>>(() => {
    const style: Record<string, string> = {
      "--safe-bottom-px": `${safeBottomPx.value}px`,
    };
    if (safeBottomRpx.value > 0) {
      style["--safe-bottom"] = `${safeBottomRpx.value}rpx`;
    }
    return style;
  });

  return {
    safeBottomPx,
    safeBottomRpx,
    safeAreaStyle,
    refreshSafeArea: computeSafeBottom,
  };
}

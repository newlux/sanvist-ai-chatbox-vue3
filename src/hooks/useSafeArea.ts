import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSystemStore } from "@/stores/modules/system";
import { isDebugLogEnabled } from "@/utils/debug";

function normalizeInset(rawValue: unknown) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 安全区 hook，供各页面/组件复用。
 *
 * 顶部状态栏高度优先级：
 * 1. `systemStore.statusBarHeight`（mPaaS JSBridge `getPhoneSizesInfo`）—— 启动时异步初始化
 * 2. `uni.getSystemInfoSync().statusBarHeight` —— 支付宝小程序返回
 * 3. `safeAreaInsets.top`
 * 4. `safeArea.top`
 * 5. `screen.height - window.innerHeight`（视口反推兜底——小米等 mPaaS 容器不返回 statusBarHeight 时使用）
 * 6. 0
 *
 * 底部安全区优先级：
 * 1. `safeAreaInsets.bottom`
 * 2. `screenHeight - safeArea.bottom`
 * 3. 0
 *
 * 统一使用 px，不涉及 rpx 换算；H5 环境动态注入的 CSS 变量也用 px。
 */
export function useSafeArea() {
  const systemStore = useSystemStore();
  const safeTopPx = ref(0);
  const safeBottomPx = ref(0);
  let refreshFrame = 0;

  function computeSafeArea() {
    try {
      const info = typeof uni !== "undefined" ? uni.getSystemInfoSync?.() : null;
      const screenHeight = Number(info?.screenHeight) || 0;
      const rawTopInsetsPx = normalizeInset(info?.safeAreaInsets?.top);
      const rawSafeAreaTopPx = normalizeInset(info?.safeArea?.top);
      const rawStatusBarPx = normalizeInset(info?.statusBarHeight);
      // mPaaS JSBridge 拿到的状态栏高度是权威值，优先于 uni 返回值。
      const rawStoreStatusBarPx = normalizeInset(systemStore.statusBarHeight);
      // 兜底：所有 JS API 在小米等机型的 mPaaS 容器里都返回 0，
      // 但容器实际并没避让状态栏——通过 screen.height - window.innerHeight 反推。
      const screenPhysical = Number((typeof screen !== "undefined" && screen?.height) || 0);
      const innerPx = typeof window !== "undefined" ? Number(window.innerHeight) || 0 : 0;
      const rawFallbackTopPx =
        screenPhysical > 0 && innerPx > 0 && screenPhysical > innerPx
          ? screenPhysical - innerPx
          : 0;
      // 反推出来的值如果远大于 80px 可能是含了导航栏，不适合做针尖状态栏。
      const cappedFallbackTopPx = rawFallbackTopPx > 0 && rawFallbackTopPx <= 80
        ? rawFallbackTopPx
        : 0;
      const topPx = rawStoreStatusBarPx
        || rawStatusBarPx
        || rawTopInsetsPx
        || rawSafeAreaTopPx
        || cappedFallbackTopPx;
      const topSource = rawStoreStatusBarPx > 0
        ? "mpaas.statusBarHeight"
        : rawStatusBarPx > 0
          ? "statusBarHeight"
          : rawTopInsetsPx > 0
            ? "safeAreaInsets.top"
            : rawSafeAreaTopPx > 0
              ? "safeArea.top"
              : cappedFallbackTopPx > 0
                ? "screenHeight-innerHeight"
                : "";

      const rawBottomInsetsPx = Number(info?.safeAreaInsets?.bottom) || 0;
      let rawBottomPx = rawBottomInsetsPx;
      let px = normalizeInset(rawBottomPx);
      let source = px > 0 ? "safeAreaInsets.bottom" : "";
      if (px <= 0) {
        const safeAreaBottom = Number(info?.safeArea?.bottom) || 0;
        if (safeAreaBottom > 0 && screenHeight > safeAreaBottom) {
          rawBottomPx = screenHeight - safeAreaBottom;
          px = normalizeInset(rawBottomPx);
          source = "screenHeight-safeArea.bottom";
        }
      }

      safeTopPx.value = Math.max(0, Math.round(topPx));
      safeBottomPx.value = Math.max(0, Math.round(px));

      if (isDebugLogEnabled()) {
        console.info("[safe-area]", {
          topSource: topSource || "none",
          topRawPx: {
            mpaas: rawStoreStatusBarPx,
            safeAreaInsets: rawTopInsetsPx,
            safeArea: rawSafeAreaTopPx,
            statusBarHeight: rawStatusBarPx,
            screenMinusInner: rawFallbackTopPx,
          },
          topPx: safeTopPx.value,
          bottomSource: source || "none",
          bottomRawPx: rawBottomPx,
          bottomPx: safeBottomPx.value,
          safeAreaInsets: info?.safeAreaInsets ?? null,
          safeArea: info?.safeArea ?? null,
          statusBarHeight: info?.statusBarHeight ?? null,
          screenHeight: info?.screenHeight ?? null,
          windowHeight: info?.windowHeight ?? null,
          screenPhysicalHeight: screenPhysical || null,
          windowInnerHeight: innerPx || null,
        });
      }
    } catch {
      safeTopPx.value = 0;
      safeBottomPx.value = 0;
    }
  }

  function scheduleRefresh() {
    if (typeof window === "undefined") {
      computeSafeArea();
      return;
    }
    if (refreshFrame) return;
    refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      computeSafeArea();
    });
  }

  onMounted(() => {
    computeSafeArea();
    // mPaaS getPhoneSizesInfo 是异步返回的，store 更新后需要重算顶部状态栏高度。
    watch(() => systemStore.statusBarHeight, scheduleRefresh);
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
  const safeAreaStyle = computed<Record<string, string>>(() => ({
    "--safe-top-px": `${safeTopPx.value}px`,
    "--safe-bottom-px": `${safeBottomPx.value}px`,
    // 运行时注入的内联样式不会经过 uni-app 的 rpx 编译转换，H5 必须使用标准 CSS 单位。
    "--safe-top": `${safeTopPx.value}px`,
    "--safe-bottom": `${safeBottomPx.value}px`,
  }));

  return {
    safeTopPx,
    safeBottomPx,
    safeAreaStyle,
    refreshSafeArea: computeSafeArea,
  };
}

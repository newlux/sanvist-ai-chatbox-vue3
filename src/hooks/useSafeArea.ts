import { computed, onMounted, ref } from "vue";
import { useSystemStore } from "@/stores/modules/system";

function normalizeInset(rawValue: unknown) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 通过支付宝小程序系统信息计算顶部状态栏和底部安全区。
 * 所有输出均为 px，供组件运行时样式使用。
 */
export function useSafeArea() {
  const systemStore = useSystemStore();
  const safeTopPx = ref(0);
  const safeBottomPx = ref(0);

  function refreshSafeArea() {
    try {
      const info = uni.getSystemInfoSync();
      const screenHeight = normalizeInset(info.screenHeight || info.windowHeight);
      const safeAreaBottom = normalizeInset(info.safeArea?.bottom);
      const safeAreaInsetBottom = normalizeInset(info.safeAreaInsets?.bottom);

      safeTopPx.value = Math.round(
        normalizeInset(info.statusBarHeight) || normalizeInset(systemStore.statusBarHeight),
      );
      safeBottomPx.value = Math.round(
        safeAreaInsetBottom || Math.max(0, screenHeight - safeAreaBottom),
      );
    } catch {
      safeTopPx.value = normalizeInset(systemStore.statusBarHeight);
      safeBottomPx.value = 0;
    }
  }

  refreshSafeArea();
  onMounted(refreshSafeArea);

  const safeAreaStyle = computed<Record<string, string>>(() => ({
    "--safe-top-px": `${safeTopPx.value}px`,
    "--safe-bottom-px": `${safeBottomPx.value}px`,
  }));

  return {
    safeTopPx,
    safeBottomPx,
    safeAreaStyle,
    refreshSafeArea,
  };
}

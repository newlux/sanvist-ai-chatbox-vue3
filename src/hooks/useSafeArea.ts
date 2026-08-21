import { computed, onMounted, ref } from "vue";
import { useSystemStore } from "@/stores/modules/system";
import { createLogger } from "@/utils/logger";

const logger = createLogger("safe-area");

/**
 * 拿不到真实值时的兜底状态栏高度（CSS px）。
 * 安卓状态栏标准是 24dp，挖孔屏普遍 28~36dp，取 28 兼顾两类机型：
 * 少留几像素会压住内容，多留几像素只是空一点，宁可后者。
 */
const FALLBACK_STATUS_BAR_PX = { android: 28, ios: 44, other: 20 };

function normalizeInset(rawValue: unknown) {
  const value = Number(rawValue);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function detectPlatform(): keyof typeof FALLBACK_STATUS_BAR_PX {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

/**
 * 读 CSS 环境变量 env(safe-area-inset-*) 的实际像素值。
 * 探针塞进 body 量一次就删；安卓 WebView 上这个值经常是 0（不支持或没开 viewport-fit），
 * 所以它只是链条里的一环，拿不到还要继续往下兜。
 */
function readCssInset(side: "top" | "bottom") {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText = `position:absolute;visibility:hidden;height:env(safe-area-inset-${side});`;
  document.body.appendChild(probe);
  const value = normalizeInset(Number.parseFloat(getComputedStyle(probe).height));
  probe.remove();
  return value;
}

/**
 * 顶部状态栏 / 底部安全区高度（px）。
 *
 * 取值优先级：宿主注入 > uni 系统信息 > CSS 环境变量 > 平台默认值。
 * 内嵌 webview 里前三条经常同时为 0（H5 的 statusBarHeight 恒为 0，
 * 安卓 WebView 又常不支持 safe-area-inset），没有兜底就会顶到状态栏底下。
 */
export function useSafeArea() {
  const systemStore = useSystemStore();
  const safeTopPx = ref(0);
  const safeBottomPx = ref(0);

  function refreshSafeArea() {
    const platform = detectPlatform();
    let source = "fallback";
    let top = 0;
    let bottom = 0;

    try {
      const info = uni.getSystemInfoSync();
      const screenHeight = normalizeInset(info.screenHeight || info.windowHeight);
      const safeAreaBottom = normalizeInset(info.safeArea?.bottom);
      const safeAreaInsetBottom = normalizeInset(info.safeAreaInsets?.bottom);

      // 宿主通过启动参数注入的最准，其次才是 uni 自己报的
      top = normalizeInset(systemStore.statusBarHeight) || normalizeInset(info.statusBarHeight);
      if (top > 0) source = "host";
      bottom = normalizeInset(systemStore.tabbarHeight)
        || safeAreaInsetBottom
        || Math.max(0, screenHeight - safeAreaBottom);
    } catch (error) {
      logger.warn("读取系统信息失败，改用 CSS 环境变量", error);
    }

    if (top <= 0) {
      top = readCssInset("top");
      if (top > 0) source = "css-env";
    }
    if (bottom <= 0) bottom = readCssInset("bottom");

    if (top <= 0) {
      top = FALLBACK_STATUS_BAR_PX[platform];
      source = "fallback";
      logger.warn("拿不到状态栏高度，使用兜底值", { platform, top });
    }

    safeTopPx.value = Math.round(top);
    safeBottomPx.value = Math.round(bottom);
    logger.debug("safe area", { platform, source, top: safeTopPx.value, bottom: safeBottomPx.value });
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

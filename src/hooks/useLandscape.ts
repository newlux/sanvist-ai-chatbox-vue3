import { onBeforeUnmount, onMounted, ref } from "vue";

import { createLogger } from "@/utils/logger";

const logger = createLogger("landscape");

/**
 * 进入页面自动横屏，离开时还原。
 *
 * 默认走 **CSS 旋转模拟**（推荐，各端一致）：
 * 把 body 整体旋转 90°、按「宽=100vh、高=100vw」铺开 —— 设备保持竖屏持握，视觉上就是横屏。
 * 不需要全屏权限、不弹全屏、iOS Safari / 各种 WebView 都稳；代价是手势方向跟着转
 * （屏幕上左右 ↔ 内容里上下），所以页面最好能在横屏内一屏放下，否则滚动方向会反直觉。
 *
 * 打开 `lock: true` 时改为「真锁方向」，逐级兜底：
 * - App（HTML5+）：`plus.screen.lockOrientation("landscape-primary")`；
 * - H5：`screen.orientation.lock("landscape")`，Chrome 要求先全屏（会抛 NotSupportedError），
 *   失败后「请求全屏 + 重试一次」；仍失败再退回 CSS 旋转；
 * - 小程序：方向由 `pages.json` 的 `pageOrientation: "landscape"` 控制，这里不处理。
 *
 * @param onReflow 方向/尺寸变化后的重排回调（尺寸变了要自己重新测量的画布 / 图表用；当前无页面传入）
 * @param options.lock 是否尝试真正锁定屏幕方向（默认 false：只用旋转模拟）
 */
export function useLandscape(onReflow?: () => void, options: { lock?: boolean } = {}) {
  /** 是否走了 CSS 旋转（此时页面按横屏尺寸铺开） */
  const rotated = ref(false);
  /** 锁方向失败时的兜底：进入全屏重试 */
  let requestedFullscreen = false;
  let locked = false;
  const shouldLock = Boolean(options.lock);

  function viewportIsPortrait() {
    if (typeof window === "undefined") return false;
    return window.innerHeight >= window.innerWidth;
  }

  /** 判断当前是否已经处于横屏可视区（含用户自己把设备转过去的情况） */
  function refreshRotateState() {
    if (typeof window === "undefined") return;
    // 已经锁住方向、或可视区本来就是横的，都不需要旋转
    rotated.value = !locked && viewportIsPortrait();
  }

  function applyBodyRotation(on: boolean) {
    if (typeof document === "undefined" || !document.body) return;
    const { style } = document.body;
    const root = document.documentElement;
    if (on) {
      // 局部坐标系按横屏尺寸铺开，再整体顺时针旋转 90° 铺满竖屏视口
      root.style.overflow = "hidden";
      style.position = "fixed";
      style.top = "0";
      style.left = "0";
      style.width = "100vh";
      style.height = "100vw";
      style.transformOrigin = "left top";
      style.transform = "rotate(90deg) translateY(-100%)";
      style.overflow = "hidden";
      return;
    }
    root.style.overflow = "";
    style.position = "";
    style.top = "";
    style.left = "";
    style.width = "";
    style.height = "";
    style.transformOrigin = "";
    style.transform = "";
    style.overflow = "";
  }

  async function lockOrientation() {
    if (!shouldLock) return;

    // #ifdef APP-PLUS
    try {
      const plusApi = (globalThis as unknown as { plus?: { screen?: { lockOrientation?: (value: string) => void } } }).plus;
      plusApi?.screen?.lockOrientation?.("landscape-primary");
      locked = true;
    } catch (error) {
      logger.warn("App 锁定横屏失败，改用旋转兜底", error);
    }
    // #endif

    // #ifdef H5
    if (!locked && typeof screen !== "undefined") {
      const orientation = (screen as unknown as { orientation?: { lock?: (value: string) => Promise<void> } }).orientation;
      if (orientation?.lock) {
        try {
          await orientation.lock("landscape");
          locked = true;
        } catch {
          // 浏览器要求全屏才允许锁方向：进全屏后重试一次
          try {
            const target = document.documentElement as unknown as { requestFullscreen?: () => Promise<void> };
            if (target.requestFullscreen) {
              await target.requestFullscreen();
              requestedFullscreen = true;
              await orientation.lock("landscape");
              locked = true;
            }
          } catch (error) {
            logger.warn("H5 锁定横屏失败，改用旋转兜底", error);
          }
        }
      }
    }
    // #endif
  }

  function onViewportChange() {
    refreshRotateState();
    applyBodyRotation(rotated.value);
    onReflow?.();
  }

  async function enterLandscape() {
    await lockOrientation();
    refreshRotateState();
    applyBodyRotation(rotated.value);
    // 旋转/全屏会改变可视区尺寸，下一帧再重排一次，避免画布尺寸算错
    setTimeout(onReflow, 60);

    if (typeof window !== "undefined") {
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("orientationchange", onViewportChange);
    }
  }

  function exitLandscape() {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
    }

    // #ifdef APP-PLUS
    try {
      const plusApi = (globalThis as unknown as { plus?: { screen?: { unlockOrientation?: () => void } } }).plus;
      plusApi?.screen?.unlockOrientation?.();
    } catch {
      // 忽略：原生不支持解锁时无需处理
    }
    // #endif

    // #ifdef H5
    try {
      (screen as unknown as { orientation?: { unlock?: () => void } }).orientation?.unlock?.();
    } catch {
      // 忽略：未锁定过时调用会抛错
    }
    if (requestedFullscreen && typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    // #endif

    locked = false;
    requestedFullscreen = false;
    rotated.value = false;
    applyBodyRotation(false);
  }

  onMounted(() => {
    void enterLandscape();
  });

  onBeforeUnmount(() => {
    exitLandscape();
  });

  return { rotated, exitLandscape };
}

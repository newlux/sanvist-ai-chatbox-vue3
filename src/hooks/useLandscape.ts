import { onBeforeUnmount, onMounted, ref } from "vue";

import { createLogger } from "@/utils/logger";
import { setLandscapeFullscreen } from "@/utils/platform/mpaas";

const logger = createLogger("landscape");

/**
 * 进入页面自动横屏，离开时还原。
 *
 * 方向切换优先交给宿主原生：进入时调 `landscapeFullscreen({ enable: true })`，退出时
 * `{ enable: false }`（见 utils/platform/mpaas）。原生转屏成功后可视区本身就是横的，
 * 下面的 CSS 旋转会自动让位（rotated=false），页面按真实横屏尺寸铺开。
 *
 * 宿主没实现该 JSAPI 时降级为 **CSS 旋转模拟**（各端一致）：
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

  /**
   * 等可视区真的恢复竖屏。
   *
   * 原生横屏（`landscapeFullscreen(false)`）是异步生效的：接口一返回不代表屏幕已经转回来，
   * 此时直接跳页 / 发送问题，对话页和键盘会落在还没转完的横屏里（键盘弹出后布局错乱）。
   * 这里用 resize / orientationchange 事件 + 50ms 轮询双保险，超时也返回（不卡死流程）。
   *
   * @returns 是否已确认竖屏；超时返回 false（调用方通常仍继续返回，只记录日志）
   */
  function waitForPortrait(timeoutMs = 1000): Promise<boolean> {
    if (typeof window === "undefined") return Promise.resolve(false);
    if (viewportIsPortrait()) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const startedAt = Date.now();
      let timer = 0;
      let done = false;

      const onViewport = () => {
        if (viewportIsPortrait()) cleanup(true);
      };

      const cleanup = (restored: boolean) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        window.removeEventListener("resize", onViewport);
        window.removeEventListener("orientationchange", onViewport);
        resolve(restored);
      };

      const tick = () => {
        if (viewportIsPortrait()) {
          cleanup(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          cleanup(false);
          return;
        }
        timer = window.setTimeout(tick, 50);
      };

      window.addEventListener("resize", onViewport);
      window.addEventListener("orientationchange", onViewport);
      tick();
    });
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
    console.log("enterLandscape");
    // 先让宿主把屏幕转过去（原生横屏全屏）；宿主没实现时这一步静默失败，下面照旧走旋转兜底
    setLandscapeFullscreen(true);
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

  /**
   * 退出横屏：通知宿主把原生横屏置为 false（`landscapeFullscreen({ enable: false })`），
   * 撤掉 CSS 旋转 / 解锁方向 / 退全屏，然后**等可视区真的回到竖屏**再返回。
   *
   * 调用方（返回按钮、语音/键盘提问后的自动返回、页面卸载）拿到 Promise 后再跳页或发送问题，
   * 避免对话页在还没转回来的横屏里渲染、键盘弹出时布局错乱。
   *
   * @returns 是否已确认恢复竖屏；等待超时返回 false（调用方仍可继续，只记录日志）
   */
  async function exitLandscape() {
    // 退出横屏：通知宿主恢复竖屏（离开调度视图 / 点返回 / 页面卸载都会走到这里）
    setLandscapeFullscreen(false);

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

    // 原生转屏是异步的：等可视区真的变回竖屏（竖屏下这一步立刻返回 true）
    const restored = await waitForPortrait();
    if (restored) logger.debug("退出横屏：已确认恢复竖屏");
    else logger.warn("退出横屏：等待竖屏超时，继续后续流程");
    return restored;
  }

  onMounted(() => {
    void enterLandscape();
  });

  onBeforeUnmount(() => {
    void exitLandscape();
  });

  return { rotated, exitLandscape };
}

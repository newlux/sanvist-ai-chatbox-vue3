import { onBeforeUnmount, onMounted, ref } from "vue";

import { shouldEnterLandscape } from "@/utils/landscape-device";
import { createLogger } from "@/utils/logger";

const logger = createLogger("landscape");

/**
 * 横屏页（schedule / schedule-pre / schedule-gantt）的版面处理。
 *
 * 方向不再由前端申请：宿主用 openH5Container 打开甘特图应用时本身就是全屏横屏，
 * 这里不再下发 `landscapeFullscreen`（原来进页 enable:true、离页 enable:false 都去掉）。
 *
 * 只保留两件事：
 * 1. 宿主没给出横屏可视区时（站内 pushWindow / uni.navigateTo 的回退路径、语音进入等），
 *    把 body 整体旋转 90° 模拟横屏：局部坐标系按「宽=100vh、高=100vw」铺开 ——
 *    设备保持竖屏持握，视觉上就是横屏，不需要全屏权限、不弹全屏，各端都稳；
 *    代价是手势方向跟着转，所以页面最好能在横屏内一屏放下。
 * 2. 方向 / 尺寸变化后回调 `onReflow`，让页面重新测量画布 / 刻度 / 任务条位置。
 *
 * 不做 `screen.orientation.lock` / `requestFullscreen`（Chrome 必须先全屏才允许锁方向，
 * 会弹系统级提示、也会把宿主容器层级搞乱）。
 *
 * 网页环境（浏览器 / PC 内嵌）与本身是横屏画布的机型（智慧屏 / 电视）一律不旋转，
 * 判据见 utils/landscape-device。
 *
 * @param onReflow 方向/尺寸变化后的重排回调（尺寸变了要自己重新测量画布 / 图表 / 行位置）
 */
export function useLandscape(onReflow?: () => void) {
  /** 是否走了 CSS 旋转（此时页面按横屏尺寸铺开） */
  const rotated = ref(false);
  /**
   * 本页的横屏状态：
   * - `pending`：还在等设备信息（大屏横屏设备要跳过整套旋转，不能先转了再撤）；
   * - `on`：可视区不是横屏时按需做 CSS 旋转；
   * - `off`：网页环境 / 设备本身是横屏画布，什么都不做。
   */
  let mode: "pending" | "on" | "off" = "pending";
  /** 组件已卸载：设备信息回来得比卸载晚时，不要再动版面 */
  let disposed = false;

  function viewportIsPortrait() {
    if (typeof window === "undefined") return false;
    return window.innerHeight >= window.innerWidth;
  }

  /** 当前是否已经处于横屏可视区（宿主给的就是横屏，或用户自己把设备转过去） */
  function refreshRotateState() {
    if (typeof window === "undefined") return;
    rotated.value = viewportIsPortrait();
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

  function onViewportChange() {
    // 大屏横屏设备（mode=off）不跟方向，只让页面自己重排
    if (mode === "on") {
      refreshRotateState();
      applyBodyRotation(rotated.value);
    }
    onReflow?.();
  }

  /**
   * 页面被切走 / 被销毁时的同步复原（宿主手势关窗、系统返回键、刷新）。
   * webview 可能直接被杀掉，这里不做任何异步等待。
   */
  function restoreSync(reason: string) {
    rotated.value = false;
    applyBodyRotation(false);
    logger.debug(`版面复原：${reason}`);
  }

  function onVisibilityChange() {
    if (typeof document === "undefined" || mode !== "on") return;
    // 切后台 / 被上层场景窗口盖住：版面先复原，回来再按新的可视区重排
    if (document.visibilityState === "hidden") {
      rotated.value = false;
      applyBodyRotation(false);
      return;
    }
    refreshRotateState();
    applyBodyRotation(rotated.value);
    setTimeout(() => onReflow?.(), 60);
  }

  /** 页面即将卸载 / 被宿主销毁：同步复原，别等异步流程 */
  function onPageHide() {
    restoreSync("页面 pagehide");
  }

  function attachListeners() {
    if (typeof window !== "undefined") {
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("orientationchange", onViewportChange);
      window.addEventListener("pagehide", onPageHide);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
  }

  function detachListeners() {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      window.removeEventListener("pagehide", onPageHide);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  }

  async function enterLandscape() {
    // 先看环境 / 设备：网页环境（浏览器 / PC 内嵌）不做旋转；智慧屏 / 电视这类本身是
    // 横屏画布的机器同样放弃（见 utils/landscape-device）。设备信息在 App 启动时预热过。
    mode = (await shouldEnterLandscape()) ? "on" : "off";
    if (disposed) return;
    if (mode === "off") {
      logger.info("网页环境或该机型本身就是横屏画布：不做 CSS 旋转兜底");
      rotated.value = false;
      applyBodyRotation(false);
      // 不旋转，但尺寸可能和设计基准不同，仍让页面自己量一次
      setTimeout(() => onReflow?.(), 0);
      return;
    }

    // 宿主已经给了横屏可视区就不旋转（rotated=false），只有竖屏视口才走旋转兜底
    refreshRotateState();
    applyBodyRotation(rotated.value);
    // 这条日志能直接回答「为什么走了 CSS 转向」：竖屏视口 = 没拿到全屏横屏容器
    if (rotated.value) {
      logger.warn("可视区是竖屏（没拿到全屏横屏容器），用 CSS 旋转模拟横屏", {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
    }
    else {
      logger.info("可视区已是横屏，不做 CSS 旋转", {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      });
    }
    // 旋转会改变可视区尺寸，下一帧再重排一次，避免画布尺寸算错
    setTimeout(onReflow, 60);
    attachListeners();
  }

  /**
   * 离开横屏页：撤掉 CSS 旋转（方向由宿主容器自己管，这里不再等下屏）。
   *
   * 保留 Promise 返回值是为了兼容既有调用方（`await exitLandscape()`），
   * 现在同步完成，恒为 true。
   */
  function exitLandscape(): Promise<boolean> {
    detachListeners();
    rotated.value = false;
    applyBodyRotation(false);
    return Promise.resolve(true);
  }

  onMounted(() => {
    void enterLandscape();
  });

  onBeforeUnmount(() => {
    disposed = true;
    // 兜底：正常返回按钮已经走过 exitLandscape，这里再同步复原一次（幂等）
    detachListeners();
    restoreSync("页面卸载");
  });

  return { rotated, exitLandscape };
}

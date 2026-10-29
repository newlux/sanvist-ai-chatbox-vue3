import { onBeforeUnmount, onMounted, ref } from "vue";

import { shouldEnterLandscape } from "@/utils/landscape-device";
import { createLogger } from "@/utils/logger";
import { setLandscapeFullscreen } from "@/utils/platform/mpaas";

const logger = createLogger("landscape");

/** 退出横屏后等可视区恢复竖屏的时长（原生转屏是异步的） */
const PORTRAIT_WAIT_MS = 1200;
/** 第一轮没恢复竖屏时补发一次转屏指令，再等这一轮 */
const PORTRAIT_RETRY_WAIT_MS = 800;

/**
 * 横屏申请落在本地存储里，记「当前是谁申请了横屏」（每个横屏页实例一个 id）。
 *
 * 为什么需要：横屏页是独立场景窗口（pushWindow）里的新 webview，跟对话页是两个 JS 上下文，
 * 中间还夹着宿主转场动画。没有归属判断时会出现这种时序：
 *   旧窗口的 exitLandscape / 页面销毁兜底晚一步执行 → 一个 enable:false 落到新窗口刚设好的横屏上，
 *   日志里就是「true 一次、false 一次」，页面莫名其妙转回竖屏。
 * 有了归属：只有当前持有者才能撤，别人（含已经死掉的旧窗口）撤不动。
 */
const LANDSCAPE_OWNER_KEY = "landscape-owner";

/** 同一上下文的同值请求不重复下发（重新挂载 / 事件抖动会连着收 true、true） */
let lastRequested: boolean | null = null;

function readOwner() {
  try {
    return String(uni.getStorageSync(LANDSCAPE_OWNER_KEY) || "");
  }
  catch {
    return "";
  }
}

function claimLandscape(ownerId: string) {
  try {
    uni.setStorageSync(LANDSCAPE_OWNER_KEY, ownerId);
  }
  catch {
    // 存储不可用时退化成「无归属」：仍然允许申请，只是防不住旧窗口的晚到撤销
  }
}

/**
 * 释放归属。返回 true 表示可以撤（当前没有别的持有者，或持有者就是自己）；
 * 返回 false 表示横屏已经被更晚的页面接管（比如旧窗口在关窗途中的迟到回调），此时不要动方向。
 */
function releaseLandscape(ownerId: string) {
  const current = readOwner();
  if (current && current !== ownerId) return false;
  try {
    uni.removeStorageSync(LANDSCAPE_OWNER_KEY);
  }
  catch {
    // 删不掉不影响判断（下次申请会覆盖）
  }
  return true;
}

/**
 * 下发一次方向指令，带原因日志（真机上对着 `[landscape]` 就能看出是谁调的）。
 * 同上下文同值直接跳过，避免一次进页面连着下发好几次。
 */
function callLandscape(enable: boolean, reason: string) {
  if (lastRequested === enable) {
    logger.debug(`横屏申请${enable ? "开" : "关"}：${reason}（同值，跳过）`);
    return;
  }
  lastRequested = enable;
  logger.info(`横屏申请${enable ? "开" : "关"}：${reason}`);
  setLandscapeFullscreen(enable);
}

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
 * 不做 `screen.orientation.lock` / `requestFullscreen`：Chrome 必须先全屏才允许锁方向，
 * 进全屏会弹系统级提示、也会把宿主容器的层级搞乱，而原生 JSAPI + CSS 旋转已经覆盖两端。
 *
 * @param onReflow 方向/尺寸变化后的重排回调（尺寸变了要自己重新测量画布 / 图表 / 行位置）
 */
export function useLandscape(onReflow?: () => void) {
  /** 是否走了 CSS 旋转（此时页面按横屏尺寸铺开） */
  const rotated = ref(false);
  /** 本实例的归属 id：只有它能撤掉自己申请的横屏 */
  const ownerId = `landscape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /**
   * 本页的横屏状态：
   * - `pending`：还在等设备信息（大屏横屏设备要跳过整套转屏，不能先转了再撤）；
   * - `on`：正常走「原生转屏 + CSS 旋转兜底」；
   * - `off`：设备本身是横屏画布，什么都不做（不调 native，也不旋转）。
   */
  let mode: "pending" | "on" | "off" = "pending";
  /** 组件已卸载：设备信息回来得比卸载晚时，不要再动方向 */
  let disposed = false;
  /** 已经在走退出流程：设备信息晚到也不能再申请横屏 */
  let exiting = false;

  function viewportIsPortrait() {
    if (typeof window === "undefined") return false;
    return window.innerHeight >= window.innerWidth;
  }

  /** 判断当前是否已经处于横屏可视区（原生转屏成功、或用户自己把设备转过去） */
  function refreshRotateState() {
    if (typeof window === "undefined") return;
    rotated.value = viewportIsPortrait();
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
  function waitForPortrait(timeoutMs = PORTRAIT_WAIT_MS): Promise<boolean> {
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
   *
   * 这些路径不会再给 `exitLandscape()` 里的 await 机会：webview 可能直接被杀掉，
   * 所以这里不做任何异步等待，同步撤掉旋转、释放归属并把方向置回竖屏。
   * 若横屏已被更晚的页面接管（releaseLandscape 返回 false），只撤自己的旋转，不动方向。
   */
  function restoreSync(reason: string) {
    rotated.value = false;
    applyBodyRotation(false);
    // 没进过横屏（大屏设备 / 还在等设备信息）就不去碰宿主方向
    if (mode !== "on") return;
    if (releaseLandscape(ownerId)) callLandscape(false, reason);
    else logger.info(`横屏复原：${reason}（已被其它页面接管，不动方向）`);
  }

  function onVisibilityChange() {
    if (typeof document === "undefined" || mode !== "on") return;
    if (document.visibilityState === "hidden") {
      // 切后台 / 被上层场景窗口盖住 / 关窗前：先把方向交还竖屏（归属不释放，回来还能继续用）
      callLandscape(false, "页面切到后台");
      return;
    }
    // 回到前台：重新申请横屏，并按新的可视区重排一次
    callLandscape(true, "页面回到前台");
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
    // 先看设备：智慧屏 / 电视这类本身就是横屏画布的机器，直接放弃整套转屏（见 utils/landscape-device）。
    // 设备信息在 App 启动时就预热过，正常情况下这一步几乎是同步的。
    mode = (await shouldEnterLandscape()) ? "on" : "off";
    if (disposed || exiting) return;
    if (mode === "off") {
      logger.info("该机型本身就是横屏画布：跳过原生转屏与 CSS 旋转兜底");
      rotated.value = false;
      applyBodyRotation(false);
      // 不跟方向，但尺寸可能和设计基准不同，仍让页面自己量一次
      setTimeout(() => onReflow?.(), 0);
      return;
    }

    // 占住「横屏持有者」，再让宿主把屏幕转过去；宿主没实现时静默失败，下面照旧走旋转兜底
    claimLandscape(ownerId);
    callLandscape(true, "进入横屏页");
    refreshRotateState();
    applyBodyRotation(rotated.value);
    // 旋转/全屏会改变可视区尺寸，下一帧再重排一次，避免画布尺寸算错
    setTimeout(onReflow, 60);
    attachListeners();
  }

  /**
   * 退出横屏：释放归属、通知宿主置回竖屏、撤掉 CSS 旋转，然后**等可视区真的回到竖屏**再返回。
   *
   * 原生转屏偶发被吞（页面刚建好、bridge 刚 ready、宿主转场动画没结束）：
   * 第一轮等不到竖屏就补发一次 `landscapeFullscreen(false)` 再等一轮，
   * 仍失败才放行 —— 调用方拿到 false 时至少知道这次没复原成功（会打 warn 日志）。
   *
   * @returns 是否已确认恢复竖屏；等待超时返回 false（调用方仍可继续，只记录日志）
   */
  async function exitLandscape() {
    exiting = true;
    detachListeners();
    // 没进过横屏（大屏设备 / 页面在等设备信息就退出）：直接放行，不碰宿主方向、也不用等竖屏
    if (mode !== "on") {
      rotated.value = false;
      applyBodyRotation(false);
      return true;
    }
    if (releaseLandscape(ownerId)) callLandscape(false, "离开横屏页");
    else logger.info("横屏复原：离开横屏页时已被其它页面接管，不动方向");

    rotated.value = false;
    applyBodyRotation(false);

    let restored = await waitForPortrait(PORTRAIT_WAIT_MS);
    if (!restored) {
      logger.warn("退出横屏：第一轮未恢复竖屏，补发一次转屏指令");
      // 补发不受同值去重限制（上一轮的值可能已被宿主吞掉）
      lastRequested = null;
      callLandscape(false, "离开横屏页（补发）");
      restored = await waitForPortrait(PORTRAIT_RETRY_WAIT_MS);
    }
    if (restored) logger.debug("退出横屏：已确认恢复竖屏");
    else logger.warn("退出横屏：等待竖屏超时，继续后续流程");
    return restored;
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

import { onBeforeUnmount, onMounted } from "vue";

/**
 * 旋转横屏排程页的触摸手势接管。
 *
 * 背景：这两张排程页用 `useLandscape()` 把页面整体 CSS 旋转 90° 来模拟横屏
 * （body 变成 `position: fixed` + `transform`），真机浏览器在这种页面上滚动容器
 * 常常收不到手势 / 容器本身算不出可滚高度（PC 上用鼠标模拟反而正常），所以：
 *
 * - **横向（时间轴）**：直接改横向滚动容器的 `scrollLeft`；
 * - **纵向（内容区）**：不再依赖原生滚动，用 `transform: translateY()` 平移内容
 *   （左列 `.schedule__side-list` 同步平移，两栏保持行对齐），滚动上限由
 *   「内容高度 - 裁剪视口高度」实时算出。
 *
 * 方向映射（页面旋转 90° 后）：屏幕**竖向**滑动 = 时间轴横向滚动；
 * 屏幕**横向**滑动 = 内容区纵向滚动。命中方向后 `preventDefault()`，不和原生滚动叠加。
 *
 * **双指捏合**：旋转页面里浏览器原生双指缩放同样不生效，这里自己算两指间距的变化比例，
 * 通过 `onPinch` 交给页面缩时间轴（页面把「每小时像素宽」按比例调大 / 调小，捏合中心的时刻保持不动）。
 *
 * 每一步都打 `[schedule-gesture]` 日志（debug 关掉即静音），真机上可看：
 * 有没有绑上、方向判定成哪一路、容器尺寸、上限（max）与滚动前后位置。
 */
/** 双指捏合的一次增量：只需按比例缩放，不做绝对尺寸 */
export interface SchedulePinchEvent {
  /** 相对上一次回调的缩放比例（> 1 放大、< 1 缩小） */
  scale: number;
  /** 捏合中心在时间轴内容坐标里的位置（px，缩放前） */
  contentX: number;
  /** 捏合中心在时间轴可视区里的横向偏移（px，缩放前），用于缩放后把它滚回原位 */
  localX: number;
}

export interface ScheduleGesturesOptions {
  /** 横向滚动容器（时间轴）的 DOM id（uni-app 里 scroll-view 的 id） */
  gridId: string;
  /** 内容区裁剪视口选择器，默认 `.schedule__rows` */
  rowsSelector?: string;
  /** 内容区被平移的元素选择器，默认 `.schedule__rows-inner` */
  rowsInnerSelector?: string;
  /** 左列需要同步平移的元素选择器，默认 `.schedule__side-list` */
  sideSelector?: string;
  /** 是否打印排查日志，默认 true；排查完传 false 即可 */
  debug?: boolean;
  /** 判定成拖动所需的最小位移（px），默认 6 */
  threshold?: number;
  /** 页面是否处于 CSS 旋转横屏：决定捏合中心映射到时间轴的哪个屏幕轴，默认 false */
  isRotated?: () => boolean;
  /** 双指捏合回调（不传则不接管双指手势） */
  onPinch?: (event: SchedulePinchEvent) => void;
  /** 纵向偏移变化回调（页面用它同步「每行箭头」的纵向位置） */
  onRowsOffset?: (offset: number) => void;
}

/** 两指在屏幕上的直线距离（旋转不改变长度，直接按屏幕坐标算即可） */
function touchDistance(touches: TouchList) {
  const [a, b] = [touches[0], touches[1]];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function useScheduleGestures(options: ScheduleGesturesOptions) {
  const rowsSelector = options.rowsSelector || ".schedule__rows";
  const rowsInnerSelector = options.rowsInnerSelector || ".schedule__rows-inner";
  const sideSelector = options.sideSelector || ".schedule__side-list";
  const threshold = options.threshold ?? 6;
  const debug = options.debug ?? true;

  function log(...args: unknown[]) {
    if (debug) console.log("[schedule-gesture]", ...args);
  }

  let cleanup: (() => void) | null = null;

  /**
   * uni-app 的 scroll-view 在 H5 下不一定是根节点自己滚（可能是内层 div），
   * 从给定节点往下找一个「内容确实超出可视区」的元素来滚，找不到就用它自己。
   */
  function resolveScroller(root: HTMLElement | null, axis: "x" | "y"): HTMLElement | null {
    if (!root) return null;
    const overflow = (el: HTMLElement) =>
      axis === "x" ? el.scrollWidth > el.clientWidth + 2 : el.scrollHeight > el.clientHeight + 2;
    if (overflow(root)) return root;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("div"));
    return nodes.find(overflow) || root;
  }

  function bind(): boolean {
    // #ifdef H5
    const gridRoot = document.getElementById(options.gridId);
    if (!gridRoot) {
      log("未找到时间轴容器，稍后重试", { gridId: options.gridId });
      return false;
    }
    const grid = resolveScroller(gridRoot, "x");
    const rowsBox = gridRoot.querySelector<HTMLElement>(rowsSelector);
    const rowsInner = rowsBox?.querySelector<HTMLElement>(rowsInnerSelector) || rowsBox;
    const pageRoot = gridRoot.closest(".schedule") || document;
    const sideList = pageRoot.querySelector<HTMLElement>(sideSelector);

    /** 纵向可滚上限 = 内容高度 - 裁剪视口高度（实时算，数据/折叠变化后依然准） */
    const rowsMax = () => Math.max(0, (rowsInner?.scrollHeight || 0) - (rowsBox?.clientHeight || 0));
    let rowsOffset = 0;
    /** 平移内容区，并让左列同步（返回实际生效的偏移） */
    const applyRowsOffset = (offset: number) => {
      const next = Math.min(Math.max(0, Math.round(offset)), rowsMax());
      rowsOffset = next;
      if (rowsInner) rowsInner.style.transform = `translateY(${-next}px)`;
      if (sideList) sideList.style.transform = `translateY(${-next}px)`;
      options.onRowsOffset?.(next);
      return next;
    };

    log("绑定手势", {
      gridId: options.gridId,
      gridIsRoot: grid === gridRoot,
      gridClientWidth: grid.clientWidth,
      gridScrollWidth: grid.scrollWidth,
      rowsBox: rowsBox?.className,
      rowsBoxClientHeight: rowsBox?.clientHeight,
      rowsInner: rowsInner?.className,
      rowsInnerScrollHeight: rowsInner?.scrollHeight,
      rowsMax: rowsMax(),
      sideList: sideList?.className,
    });

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let axis: "time" | "rows" | null = null;
    /** 上一次的双指间距（0 = 当前不在捏合中） */
    let pinchDistance = 0;

    /**
     * 捏合中心 → 时间轴可视区偏移 / 内容坐标。
     * 旋转 90° 后屏幕竖向才是时间轴方向（layout x = screen y），所以取中心点的 Y；
     * 未旋转（宿主真转屏）时直接取 X。两种情况下 rect 的对应边都是可视区左缘。
     */
    const pinchFocus = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      if (!a || !b) return { localX: 0, contentX: grid.scrollLeft };
      const centerX = (a.clientX + b.clientX) / 2;
      const centerY = (a.clientY + b.clientY) / 2;
      const rect = grid.getBoundingClientRect();
      const raw = options.isRotated?.() ? centerY - rect.top : centerX - rect.left;
      const localX = Math.min(Math.max(raw, 0), grid.clientWidth);
      return { localX, contentX: grid.scrollLeft + localX };
    };

    const onStart = (event: TouchEvent) => {
      // 双指按下：进入捏合，先把单指拖动的方向状态清掉
      if (options.onPinch && event.touches.length >= 2) {
        axis = null;
        pinchDistance = touchDistance(event.touches);
        // 双指一落下就拦掉默认行为：iOS 上浏览器原生的放大镜 / 页面缩放会抢手势
        if (event.cancelable) event.preventDefault();
        log("双指按下", { distance: pinchDistance });
        return;
      }
      const touch = event.touches?.[0];
      if (!touch) return;
      pinchDistance = 0;
      startX = touch.clientX;
      startY = touch.clientY;
      startLeft = grid.scrollLeft;
      startTop = rowsOffset;
      axis = null;
      log("touchstart", {
        x: startX,
        y: startY,
        scrollLeft: startLeft,
        rowsOffset: startTop,
        target: (event.target as HTMLElement | null)?.className,
      });
    };

    const onMove = (event: TouchEvent) => {
      // 双指捏合：按两指间距的变化比例缩放时间轴（页面自己改每小时像素宽）
      if (options.onPinch && event.touches.length >= 2) {
        const distance = touchDistance(event.touches);
        // 第二根手指可能是在拖动途中落下的：以这一刻为新基准，避免比例突变
        if (!pinchDistance) {
          pinchDistance = distance;
          axis = null;
        }
        if (pinchDistance > 0 && distance > 0) {
          const scale = distance / pinchDistance;
          pinchDistance = distance;
          if (Math.abs(scale - 1) > 0.001) {
            const focus = pinchFocus(event.touches);
            options.onPinch({ scale, ...focus });
            if (debug) log("双指缩放", { scale, ...focus });
          }
        }
        if (event.cancelable) event.preventDefault();
        return;
      }

      const touch = event.touches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        axis = Math.abs(dy) >= Math.abs(dx) ? "time" : "rows";
        log("方向判定", { axis, dx, dy });
      }
      if (axis === "time") {
        const max = Math.max(0, grid.scrollWidth - grid.clientWidth);
        const next = Math.min(Math.max(0, startLeft - dy), max);
        grid.scrollLeft = next;
        if (debug) log("滚时间轴", { dy, from: startLeft, to: next, max });
      } else {
        const to = applyRowsOffset(startTop + dx);
        if (debug) log("滚内容区", { dx, from: startTop, to, max: rowsMax() });
      }
      // 命中方向后阻止默认行为，避免和浏览器原生滚动叠加（双倍滚动/回弹）
      if (event.cancelable) event.preventDefault();
    };

    const onEnd = (event: TouchEvent) => {
      log("touchend", { scrollLeft: grid.scrollLeft, rowsOffset });
      pinchDistance = 0;
      axis = null;
      // 双指抬起一根后剩下那根继续单指拖动：以当前位置为新起点，避免画面跳一下
      const touch = event.touches?.[0];
      if (touch) {
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = grid.scrollLeft;
        startTop = rowsOffset;
      }
    };

    // 挂在外层容器上：横向滚动容器可能被拆成「固定刻度条 + 滚动区」两层，
    // 绑在滚动区里的话，手指落在刻度条上起手就收不到事件（事件从内部冒泡上来，绑外层都能接住）
    gridRoot.addEventListener("touchstart", onStart, { passive: false });
    gridRoot.addEventListener("touchmove", onMove, { passive: false });
    gridRoot.addEventListener("touchend", onEnd, { passive: true });
    gridRoot.addEventListener("touchcancel", onEnd, { passive: true });

    // 内容区与左列在窗口尺寸变化后重新按上限归位
    const onResize = () => applyRowsOffset(rowsOffset);

    cleanup = () => {
      gridRoot.removeEventListener("touchstart", onStart);
      gridRoot.removeEventListener("touchmove", onMove);
      gridRoot.removeEventListener("touchend", onEnd);
      gridRoot.removeEventListener("touchcancel", onEnd);
      // #ifdef H5
      window.removeEventListener("resize", onResize);
      // #endif
    };
    // #ifdef H5
    window.addEventListener("resize", onResize);
    // #endif
    applyRowsOffset(0);
    return true;
    // #endif
    return false;
  }

  onMounted(() => {
    if (bind()) return;
    // 首屏偶尔晚一帧，延迟再试一次
    setTimeout(() => {
      if (bind()) log("延迟绑定成功");
    }, 300);
  });

  onBeforeUnmount(() => {
    cleanup?.();
    cleanup = null;
    log("解绑手势");
  });

  return { bind };
}

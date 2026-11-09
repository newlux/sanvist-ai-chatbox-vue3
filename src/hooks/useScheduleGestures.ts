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
 * 方向映射看页面是否处于 CSS 旋转（`isRotated`）：
 * - 旋转模拟横屏（页面转了 90°）：屏幕**竖向**滑动 = 时间轴横向滚动，屏幕**横向**滑动 = 内容区纵向滚动；
 * - 宿主原生转屏全屏（页面没转）：屏幕**横向**滑动 = 时间轴横向滚动，屏幕**竖向**滑动 = 内容区纵向滚动。
 * 命中方向后 `preventDefault()`，不和原生滚动叠加。
 *
 * **双指捏合**：旋转页面里浏览器原生双指缩放同样不生效，这里自己算两指间距的变化比例，
 * 通过 `onPinch` 交给页面缩时间轴（页面把「每小时像素宽」按比例调大 / 调小，捏合中心的时刻保持不动）。
 * 间距与中心点都只取「时间轴方向」的一根屏幕轴（旋转模拟横屏取纵向、未旋转取横向），
 * 垂直于时间轴的左右开合不会被误判成缩放，缩放锚点也就不会跟着手指乱跳。
 *
 * **鼠标拖动（H5 / PC 网页）**：网页里没有触摸，鼠标也拖不动 scroll-view，
 * 所以补一套左键拖动 —— 水平方向滚时间轴、竖直方向平移内容区，**两个方向同时生效**，
 * 拖到哪跟到哪；拖动越过阈值后吞掉松手补出来的 click，点任务条仍然照常打开详情。
 * 方向映射与触摸共用同一套（旋转模拟横屏时屏幕竖向 = 时间轴）。
 *
 * 双指缩放只打 `[zoom]` 短日志（console.warn，发布包可见），真机上可看：
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
  /** 兼容保留：手势日志已精简为固定的 `[zoom]` 短日志，该开关不再生效 */
  debug?: boolean;
  /** 判定成拖动所需的最小位移（px），默认 6 */
  threshold?: number;
  /**
   * 时间轴在屏幕上是否沿竖向：CSS 旋转模拟横屏（页面整体转了 90°）时为 true。
   * 为 true 时双指间距 / 捏合中心 / 拖动增量都改用 clientY，否则用 clientX。
   */
  isRotated?: () => boolean;
  /**
   * 是否只在「内容行区」内才接管双指捏合（默认 false：整块网格都响应）。
   * 为 true 时，双指落在刻度条 / 空白区不会触发缩放——按 rowsSelector 命中的元素做包含判断。
   */
  pinchOnlyInRows?: boolean;
  /** 双指捏合回调（不传则不接管双指手势）：返回缩放后的目标横向滚动位置（页面维护缩放锚点）；
   *  不返回（或返回 undefined）则本次缩放不改变滚动位置 */
  onPinch?: (event: SchedulePinchEvent) => number | void;
  /** 双指捏合会话开始（第二根手指落下）：页面用它在捏合期间关掉滚动动画 */
  onPinchStart?: () => void;
  /** 双指捏合会话结束（抬起至少一根手指）：页面用它恢复滚动动画 */
  onPinchEnd?: () => void;
  /** 纵向偏移变化回调（页面用它同步「每行箭头」的纵向位置） */
  onRowsOffset?: (offset: number) => void;
}

/**
 * 双指间距 —— 捏合缩放的唯一度量：两指**直线距离**，不投影到某根屏幕轴。
 *
 * 曾经按「时间轴方向的投影」取间距，斜向张开时只有一部分位移参与计算，
 * 体感就是不跟手（沿时间轴张开的响应反而最差）。直线距离与手指位移一一对应，
 * 无论朝哪个方向张开都 1:1 跟随；缩放方向仍是时间轴（页面改每小时像素宽），
 * 锚点也仍沿时间轴方向取（见 pinchFocus），只是手势度量不再区分屏幕朝向。
 */
function pinchDistanceOf(touches: TouchList) {
  const [a, b] = [touches[0], touches[1]];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** 两指至少要拉开这么多才认作「在捏合」：手指刚落下时距离很小，
 *  用它当基准会让第一帧的比例失真（画面猛跳一下） */
const MIN_PINCH_SPAN = 12;

export function useScheduleGestures(options: ScheduleGesturesOptions) {
  const rowsSelector = options.rowsSelector || ".schedule__rows";
  const rowsInnerSelector = options.rowsInnerSelector || ".schedule__rows-inner";
  const sideSelector = options.sideSelector || ".schedule__side-list";
  const threshold = options.threshold ?? 6;

  /**
   * 缩放排查日志：只保留双指相关的几行，短、单行，用 console.warn 保证
   * 发布包 / vConsole 都留得住（console.log 在产物里可能被裁掉）。
   */
  function zoomLog(...args: unknown[]) {
    console.warn("[zoom]", ...args);
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
      return false;
    }
    const grid = resolveScroller(gridRoot, "x");
    const rowsBox = gridRoot.querySelector<HTMLElement>(rowsSelector);
    const rowsInner = rowsBox?.querySelector<HTMLElement>(rowsInnerSelector) || rowsBox;
    const pageRoot = gridRoot.closest(".schedule") || document;
    const sideList = pageRoot.querySelector<HTMLElement>(sideSelector);

    /** 纵向可滚上限 = 内容高度 - 裁剪视口高度（实时算，数据/折叠变化后依然准） */
    const rowsMax = () => Math.max(0, (rowsInner?.scrollHeight || 0) - (rowsBox?.clientHeight || 0));

    /**
     * 时间轴在屏幕上是否竖向：CSS 旋转模拟横屏时为 true。
     * 捏合间距、捏合锚点、拖动增量全部由它决定，避免多处各判一套导致方向不一致。
     */
    const timelineVertical = () => options.isRotated?.() ?? false;

    /** 缩放区域限制：只认落在内容行区（任务条区域）里的双指 */
    const pinchAllowed = (event: TouchEvent) =>
      !options.pinchOnlyInRows || !rowsBox || rowsBox.contains(event.target as Node);
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

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let axis: "time" | "rows" | null = null;
    /** 本次手势开始时页面是否处于 CSS 旋转（决定屏幕方向与内容方向的映射） */
    let startRotated = false;
    /** 上一次的时间轴方向间距（0 = 当前不在捏合中） */
    let pinchSpanValue = 0;
    /** 本次捏合是否沿屏幕竖向取时间轴（开始时定一次，间距与锚点共用同一套映射） */
    let pinchVertical = false;
    /** 捏合会话的理论滚动位置：缩放中用它算中心锚点，避免连续缩放时 DOM scrollLeft 尚未生效导致的漂移 */
    let pinchScrollLeft = 0;
    /** 当前是否处于双指捏合会话（用于触发 onPinchStart / onPinchEnd） */
    let pinching = false;

    /**
     * 捏合中心 → 时间轴可视区偏移 / 内容坐标：与间距取同一根轴。
     * 竖向时间轴取两指中心的 Y（扣可视区上边），横向取 X（扣可视区左边）。
     */
    const pinchFocus = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      if (!a || !b) return { localX: 0, contentX: pinchScrollLeft };
      const rect = grid.getBoundingClientRect();
      const center = pinchVertical
        ? (a.clientY + b.clientY) / 2 - rect.top
        : (a.clientX + b.clientX) / 2 - rect.left;
      const localX = Math.min(Math.max(center, 0), grid.clientWidth);
      return { localX, contentX: pinchScrollLeft + localX };
    };

    const onStart = (event: TouchEvent) => {
      // ② 双指：进入捏合缩放（清掉单指拖动的方向状态）
      if (options.onPinch && event.touches.length >= 2) {
        if (!pinchAllowed(event)) {
          zoomLog("skip", "outside-rows", (event.target as HTMLElement | null)?.className);
          if (event.cancelable) event.preventDefault();
          return;
        }
        const [t0, t1] = [event.touches[0], event.touches[1]];
        axis = null;
        pinchVertical = timelineVertical();
        pinchSpanValue = pinchDistanceOf(event.touches);
        pinchScrollLeft = grid.scrollLeft;
        pinching = true;
        options.onPinchStart?.();
        // 双指落下即拦默认行为：原生页面缩放 / 放大镜 / 回弹不能抢手势
        if (event.cancelable) event.preventDefault();
        zoomLog(
          "start",
          `anchor=${pinchVertical ? "Y" : "X"}`,
          `span=${Math.round(pinchSpanValue)}`,
          `t0=(${Math.round(t0?.clientX ?? 0)},${Math.round(t0?.clientY ?? 0)})`,
          `t1=(${Math.round(t1?.clientX ?? 0)},${Math.round(t1?.clientY ?? 0)})`,
        );
        return;
      }

      // ① 单指：拖动平移（沿时间轴方向滚时间轴，另一方向滚内容区）
      const touch = event.touches?.[0];
      if (!touch) return;
      pinchSpanValue = 0;
      pinching = false;
      startX = touch.clientX;
      startY = touch.clientY;
      startLeft = grid.scrollLeft;
      startTop = rowsOffset;
      axis = null;
      startRotated = timelineVertical();
    };

    const onMove = (event: TouchEvent) => {
      // ② 双指：按「时间轴方向间距」的变化比例缩放（页面改每小时像素宽）
      // 注意：捏合会话一旦开始就不再检查区域——touchmove 的 target 可能因缩放重渲染
      // 被替换，逐帧检查会让会话在第一帧后静默中断（跨度很大却只缩一点点）
      if (options.onPinch && event.touches.length >= 2) {
        // 第二根手指可能是在单指拖动途中落下的：这一刻重新定轴（间距与锚点必须同轴）
        if (!pinchSpanValue) {
          pinchVertical = timelineVertical();
          pinchScrollLeft = grid.scrollLeft;
        }
        const span = pinchDistanceOf(event.touches);
        if (span < MIN_PINCH_SPAN) {
          // 沿时间轴方向还没张开：不算缩放；清基准，等真正张开时重取，避免接近 0 的间距导致比例突变
          zoomLog("skip", `span<${MIN_PINCH_SPAN}`, `anchor=${pinchVertical ? "Y" : "X"}`, `span=${Math.round(span)}`);
          pinchSpanValue = 0;
          if (event.cancelable) event.preventDefault();
          return;
        }
        // 首次取得基准（或被清掉后刚张开）：以这一刻为零点
        if (!pinchSpanValue) {
          pinchSpanValue = span;
          pinching = true;
          options.onPinchStart?.();
          axis = null;
        }
        const scale = span / pinchSpanValue;
        pinchSpanValue = span;
        if (Math.abs(scale - 1) > 0.001) {
          const focus = pinchFocus(event.touches);
          const next = options.onPinch({ scale, ...focus });
          if (typeof next === "number") pinchScrollLeft = next;
          zoomLog("step", `scale=${scale.toFixed(3)}`, `span=${Math.round(span)}`);
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
        // 旋转 90° 模拟横屏：屏幕方向与内容方向互换（竖滑滚时间轴、横滑滚内容区）；
        // 宿主原生转屏全屏（未旋转）：屏幕方向与内容方向一致（横滑滚时间轴、竖滑滚内容区）
        const vertical = Math.abs(dy) >= Math.abs(dx);
        axis = (startRotated ? vertical : !vertical) ? "time" : "rows";
      }
      if (axis === "time") {
        const max = Math.max(0, grid.scrollWidth - grid.clientWidth);
        // 旋转时时间轴沿屏幕竖向，未旋转时沿屏幕横向；内容跟手方向都是「减」
        const delta = startRotated ? dy : dx;
        const next = Math.min(Math.max(0, startLeft - delta), max);
        grid.scrollLeft = next;
      } else {
        // 旋转时内容区沿屏幕横向（+），未旋转时沿屏幕竖向（跟手即取反）
        const delta = startRotated ? dx : -dy;
        const to = applyRowsOffset(startTop + delta);
      }
      // 命中方向后阻止默认行为，避免和浏览器原生滚动叠加（双倍滚动/回弹）
      if (event.cancelable) event.preventDefault();
    };

    const onEnd = (event: TouchEvent) => {
      if (pinching) {
        pinching = false;
        // 事件类型打出来：touchcancel（浏览器/宿主接管手势）与 touchend 一眼区分
        zoomLog("end", event.type);
        options.onPinchEnd?.();
      }
      pinchSpanValue = 0;
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

    /* ---------- 鼠标拖动：H5 / PC 网页里按住左键拖动 = 上下左右平移 ----------
       网页环境没有触摸手势，鼠标也拖不动 scroll-view（原生只认滚轮 / 滚动条），
       所以这里补一套鼠标拖动：水平方向滚时间轴、竖直方向平移内容区，
       一次拖动**两个方向同时生效**（不再像触摸那样先锁定单一方向）。
       旋转模拟横屏时与触摸同一套方向映射（屏幕竖向 = 时间轴）。 */
    let mouseDragging = false;
    /** 本次拖动是否已越过阈值：越过才吞掉松手后补出来的 click，避免顺带打开任务详情 */
    let mouseMoved = false;
    /** 拖动期间恢复 body 的 user-select（防止拖拽时整页选中文字） */
    let restoreUserSelect = "";

    /** 拖动结束后浏览器还会补一个 click：捕获阶段一次性吞掉，晚到没有就超时自动撤 */
    const guardClick = () => {
      let timer = 0;
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
        remove();
      };
      const remove = () => {
        document.removeEventListener("click", swallow, true);
        window.clearTimeout(timer);
      };
      document.addEventListener("click", swallow, true);
      timer = window.setTimeout(remove, 300);
    };

    const onMouseDown = (event: MouseEvent) => {
      // 只认左键；正在双指捏合 / 触摸拖动时不抢
      if (event.button !== 0 || pinching || mouseDragging) return;
      mouseDragging = true;
      mouseMoved = false;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = grid.scrollLeft;
      startTop = rowsOffset;
      axis = null;
      startRotated = timelineVertical();
      // 阻止文字选中 / 原生图片拖拽；不影响随后的 click（点任务条仍然能打开详情）
      event.preventDefault();
      if (document.body) {
        restoreUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";
      }
      gridRoot.style.cursor = "grabbing";
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!mouseDragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!mouseMoved) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        mouseMoved = true;
      }
      // 与触摸同一套映射：旋转模拟横屏时屏幕方向与内容方向互换
      const timeDelta = startRotated ? dy : dx;
      const rowsDelta = startRotated ? dx : -dy;
      const max = Math.max(0, grid.scrollWidth - grid.clientWidth);
      grid.scrollLeft = Math.min(Math.max(0, startLeft - timeDelta), max);
      applyRowsOffset(startTop + rowsDelta);
    };

    const onMouseUp = () => {
      if (!mouseDragging) return;
      mouseDragging = false;
      gridRoot.style.cursor = "grab";
      if (document.body) document.body.style.userSelect = restoreUserSelect;
      if (mouseMoved) guardClick();
      mouseMoved = false;
    };

    // 挂在外层容器上：横向滚动容器可能被拆成「固定刻度条 + 滚动区」两层，
    // 绑在滚动区里的话，手指落在刻度条上起手就收不到事件（事件从内部冒泡上来，绑外层都能接住）
    gridRoot.addEventListener("touchstart", onStart, { passive: false });
    gridRoot.addEventListener("touchmove", onMove, { passive: false });
    gridRoot.addEventListener("touchend", onEnd, { passive: true });
    gridRoot.addEventListener("touchcancel", onEnd, { passive: true });

    // 鼠标：按下绑在容器上，移动 / 松手绑在 window 上（拖出容器再松手也能正常收尾）；
    // 窗口失焦（松手落在浏览器外）同样按结束处理，避免拖动状态卡住
    gridRoot.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("blur", onMouseUp);
    // 抓手光标：告诉 PC 用户这块可以按住拖
    gridRoot.style.cursor = "grab";

    // 内容区与左列在窗口尺寸变化后重新按上限归位
    const onResize = () => applyRowsOffset(rowsOffset);

    cleanup = () => {
      gridRoot.removeEventListener("touchstart", onStart);
      gridRoot.removeEventListener("touchmove", onMove);
      gridRoot.removeEventListener("touchend", onEnd);
      gridRoot.removeEventListener("touchcancel", onEnd);
      // #ifdef H5
      gridRoot.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("blur", onMouseUp);
      gridRoot.style.cursor = "";
      // 拖动中被卸载：把临时关掉的选中一并恢复，别让整页一直选不中文字
      if (mouseDragging && document.body) {
        document.body.style.userSelect = restoreUserSelect;
        mouseDragging = false;
      }
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
      bind();
    }, 300);
  });

  onBeforeUnmount(() => {
    cleanup?.();
    cleanup = null;
  });

  return { bind };
}

import type { Ref } from "vue";
import { computed } from "vue";

/**
 * 「左右两侧还有被挡住的任务」提示箭头（稿子 6832:720 / 6832:721：28×28 白底方按钮 + 深色箭头）。
 *
 * 提供两套结果（同一套判定逻辑）：
 * - 按行版 `rowHints` / `jumpToRow`：某一行在可视窗外还有任务条，就在那一行的左右边缘各浮
 *   一个箭头；多行有隐藏任务时会出现多对箭头（甘特页用）。
 * - 全局版 `globalHint` / `showLeftHint` / `showRightHint` / `jumpToHidden`：把整条时间轴
 *   当一组看，整条轴上还有没看完的任务就浮一对箭头（预排草案 / 重排页用）。
 *
 * 判定方式：用当前滚动窗口 `[scrollLeft, scrollLeft + viewportWidth]` 去比任务条的像素区间。
 * **只要任务没看全就算该侧还有任务**：起点被裁在左缘外（`x1 < start`）、终点被裁在右缘外
 * （`x2 > end`）都算 —— 露半截时用户同样看不到全貌，箭头要提示。
 * 目标滚动位把该条的起点/终点对到对应边缘（结果夹在 `[0, maxScroll]` 内）。
 *
 * 任务条的像素算法与页面里的 `barStyle()` 保持一致（最小半格宽），
 * 每次滚动 / 折叠展开后自动重算，不需要页面手动刷新。
 */
export interface EdgeHintBar {
  /** 起点（当天分钟数） */
  startMin: number;
  /** 终点（当天分钟数） */
  endMin: number;
}

/** 单行（一个资源行）的提示结果 */
export interface EdgeHintRowResult {
  /** 该行左侧是否还有被挡住的任务 */
  left: boolean;
  /** 该行右侧是否还有被挡住的任务 */
  right: boolean;
  /** 点左箭头时滚动到的 scrollLeft */
  leftTarget: number;
  /** 点右箭头时滚动到的 scrollLeft */
  rightTarget: number;
}

export interface TimelineEdgeHintOptions {
  /** 行数据（每行取 bars 里的任务条；数组顺序即渲染顺序，与行 Y 坐标一一对应） */
  rows: () => ReadonlyArray<{ bars: ReadonlyArray<EdgeHintBar> }>;
  /** 时间轴最左刻度对应的分钟数 */
  dayStartMin: number;
  /** 每小时像素宽 */
  hourWidth: number;
  /** 当前滚动位置（px） */
  scrollLeft: Ref<number>;
  /** 时间轴可视宽度（px） */
  viewportWidth: Ref<number>;
  /** 时间轴内容总宽（px） */
  contentWidth: () => number;
  /** 点击箭头时执行的滚动（页面把「开动画 + 赋值 scroll-left」接在这里） */
  scrollTo: (left: number) => void;
  /** 跳过去后任务条与边缘留的空隙（px），默认 8 */
  margin?: number;
}

export function useTimelineEdgeHint(options: TimelineEdgeHintOptions) {
  const margin = options.margin ?? 8;

  function range(bar: EdgeHintBar) {
    const x1 = ((bar.startMin - options.dayStartMin) / 60) * options.hourWidth;
    const width = Math.max(
      ((bar.endMin - bar.startMin) / 60) * options.hourWidth,
      options.hourWidth / 2,
    );
    return { x1, x2: x1 + width };
  }

  const maxScroll = computed(() =>
    Math.max(0, options.contentWidth() - Math.max(0, options.viewportWidth.value)));

  function clamp(left: number) {
    return Math.min(Math.max(0, Math.round(left)), maxScroll.value);
  }

  function emptyRow(): EdgeHintRowResult {
    return { left: false, right: false, leftTarget: 0, rightTarget: 0 };
  }

  /**
   * 一组任务条的左右提示判定与目标滚动位（start/end 为可视窗口，viewport 为可视宽）。
   *
   * 统计**没看全**的任务条：起点被裁在左缘外（`x1 < start - 1`）算左侧、终点被裁在右缘外
   * （`x2 > end + 1`）算右侧；一长条两端都被裁时两侧都要提示，所以两条判定各自独立。
   * 左侧取 `x1` 最大（起点离视口最近）的那条，把它的起点对到左缘；
   * 右侧取 `x2` 最小（终点离视口最近）的那条，把它的终点对到右缘。
   */
  function computeHint(
    bars: ReadonlyArray<EdgeHintBar>,
    start: number,
    end: number,
    viewport: number,
  ): EdgeHintRowResult {
    let nearestLeft: { x1: number; x2: number } | null = null;
    let nearestRight: { x1: number; x2: number } | null = null;

    for (const bar of bars) {
      const box = range(bar);
      if (box.x1 < start - 1) {
        if (!nearestLeft || box.x1 > nearestLeft.x1) nearestLeft = box;
      }
      if (box.x2 > end + 1) {
        if (!nearestRight || box.x2 < nearestRight.x2) nearestRight = box;
      }
    }

    return {
      left: Boolean(nearestLeft),
      right: Boolean(nearestRight),
      leftTarget: nearestLeft ? clamp(nearestLeft.x1 - margin) : 0,
      rightTarget: nearestRight ? clamp(nearestRight.x2 + margin - viewport) : 0,
    };
  }

  /** 每行一组结果，顺序与 rows() 完全一致（甘特页「每行浮箭头」用） */
  const rowHints = computed<EdgeHintRowResult[]>(() => {
    const viewport = Math.max(0, options.viewportWidth.value);
    // 可视宽度还没量到（首帧）时不判定，否则右侧会被误判成「有隐藏任务」
    if (viewport <= 0) return options.rows().map(() => emptyRow());

    const start = Math.max(0, options.scrollLeft.value);
    const end = start + viewport;

    return options.rows().map(row => computeHint(row.bars, start, end, viewport));
  });

  /** 全局一组（所有行合起来看）：给「整条时间轴只有一个滚动条」的页面用（如预排草案） */
  const globalHint = computed<EdgeHintRowResult>(() => {
    const viewport = Math.max(0, options.viewportWidth.value);
    if (viewport <= 0) return emptyRow();

    const start = Math.max(0, options.scrollLeft.value);
    const end = start + viewport;

    const bars: EdgeHintBar[] = [];
    for (const row of options.rows()) bars.push(...row.bars);
    return computeHint(bars, start, end, viewport);
  });

  const showLeftHint = computed(() => globalHint.value.left);
  const showRightHint = computed(() => globalHint.value.right);

  /** 跳到指定行离视口最近的那条隐藏任务（按行版） */
  function jumpToRow(direction: -1 | 1, rowIndex: number) {
    const row = rowHints.value[rowIndex];
    if (!row) return;
    options.scrollTo(direction === -1 ? row.leftTarget : row.rightTarget);
  }

  /** 跳到（全局）离视口最近的那条隐藏任务（整条时间轴版） */
  function jumpToHidden(direction: -1 | 1) {
    options.scrollTo(direction === -1 ? globalHint.value.leftTarget : globalHint.value.rightTarget);
  }

  return { rowHints, jumpToRow, globalHint, showLeftHint, showRightHint, jumpToHidden };
}

<script setup lang="ts">
import { computed, inject } from "vue";

defineOptions({ name: "TableBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});
/**
 * 是否渲染在深色 AI 气泡里（Ardot 1193:5104）：由 AiBubbleV2 provide。
 * 表格不是 markdown 的 HTML 表格，而是结构化 table 块，配色走这个组件的样式表，
 * 没有 provide 的场景（浅色稿）默认 false。
 */
const darkContainer = inject("ai-bubble-dark", computed(() => false));

const rawColumns = computed(() =>
  Array.isArray(props.payload?.columns) ? props.payload.columns : [],
);
const rawRows = computed(() =>
  Array.isArray(props.payload?.rows) ? props.payload.rows.filter(Array.isArray) : [],
);
const columnCount = computed(() => Math.max(
  rawColumns.value.length,
  ...rawRows.value.map(row => row.length),
  1,
));
const columns = computed(() => Array.from(
  { length: columnCount.value },
  (_, index) => String(rawColumns.value[index] ?? ""),
));
const rows = computed(() => rawRows.value.map(row => Array.from(
  { length: columnCount.value },
  (_, index) => String(row[index] ?? ""),
)));
const tableWidth = computed(() => `${columnCount.value * 180}rpx`);

/**
 * 竖向手势放行（H5）。
 *
 * 表格是横向滚动容器：uni 的 scroll-view 在 H5 下把内层 div 写成
 * `overflow-x: auto; overflow-y: hidden`。只要表格比气泡宽（列多 / 单元格长），
 * 浏览器在 touchstart 就把握住这次手势锁给这个横向容器，竖向拖动不再冒到外层消息列表 ——
 * 表现就是「手指按在表格里往上滑，列表纹丝不动」。
 *
 * 处理：只对「横向确实能滚」的表格（就是会出问题的那一类）接管竖向手势 ——
 * 判定为竖向后 preventDefault 掉横向容器的默认接管，位移直接写给外层滚动容器，
 * 1:1 跟手；横向手势完全不动，窄表格（不需要横滚）依旧走原生。
 */
const GESTURE_AXIS_THRESHOLD = 8;
/** 本次手势判定出的主方向；空串 = 还没判定 */
let gestureAxis: "" | "x" | "y" = "";
let gestureStartX = 0;
let gestureStartY = 0;
let gestureLastY = 0;
/** 接管竖向手势时要驱动的外层滚动容器（消息列表），拿不到就交还原生 */
let gestureScroller: HTMLElement | null = null;
/** 按下时外层的滚动位置：用来判断浏览器是不是已经把原生滚动带起来了 */
let gestureStartScrollTop = 0;

/** 外层能竖向滚的祖先：消息列表的内层滚动 div */
function findScrollableAncestor(from: HTMLElement | null) {
  let node = from?.parentElement || null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * 找到真正横向滚动的内层 div。
 * H5 下 `<scroll-view>` 里有两层同名 class 的 div（wrap + main），
 * 只有 main 带 `overflow-x: auto` 且内容溢出；不能按顺序盲取第一层。
 */
function findHorizontalScroller(root: HTMLElement | null) {
  if (!root) return null;
  const nodes: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("div"))];
  for (const node of nodes) {
    const { overflowX } = getComputedStyle(node);
    if (overflowX !== "auto" && overflowX !== "scroll") continue;
    if (node.scrollWidth > node.clientWidth + 1) return node;
  }
  return null;
}

function onTableTouchStart(event: TouchEvent) {
  gestureAxis = "";
  gestureScroller = null;
  // 只服务 H5；小程序端没有 DOM 度量能力，整段交还原生
  if (typeof document === "undefined") return;
  const touch = event.touches?.[0];
  if (!touch) return;
  const root = event.currentTarget as HTMLElement | null;
  const scroller = findHorizontalScroller(root);
  // 横向滚不动的表格不会锁手势，交给浏览器原生处理，别自作聪明
  if (!scroller) return;
  gestureStartX = touch.clientX;
  gestureStartY = touch.clientY;
  gestureLastY = touch.clientY;
  gestureScroller = findScrollableAncestor(scroller);
  gestureStartScrollTop = gestureScroller ? gestureScroller.scrollTop : 0;
}

function onTableTouchMove(event: TouchEvent) {
  if (!gestureScroller) return;
  const touch = event.touches?.[0];
  if (!touch) return;
  if (!gestureAxis) {
    const dx = Math.abs(touch.clientX - gestureStartX);
    const dy = Math.abs(touch.clientY - gestureStartY);
    if (dx < GESTURE_AXIS_THRESHOLD && dy < GESTURE_AXIS_THRESHOLD) return;
    gestureAxis = dy > dx ? "y" : "x";
    /**
     * 判定的同一拍里外层已经在动了，说明这次浏览器没被表格锁住（原生滚动正常工作），
     * 再自己写 scrollTop 就成了双倍速度 —— 直接交还原生。
     */
    if (gestureAxis === "y" && Math.abs(gestureScroller.scrollTop - gestureStartScrollTop) > 1) {
      gestureScroller = null;
      return;
    }
  }
  // 横向手势留给表格自己滚
  if (gestureAxis !== "y") return;
  // 拦住横向容器对本次手势的接管，位移自己写给外层列表（不 prevent 会两边同时滚）
  if (event.cancelable) event.preventDefault();
  const delta = gestureLastY - touch.clientY;
  gestureLastY = touch.clientY;
  if (delta) gestureScroller.scrollTop += delta;
}

function onTableTouchEnd() {
  gestureAxis = "";
  gestureScroller = null;
}
</script>

<template>
  <scroll-view
    class="table-block"
    :class="{ 'table-block--dark': darkContainer }"
    scroll-x
    :show-scrollbar="false"
    enhanced
    @touchstart="onTableTouchStart"
    @touchmove="onTableTouchMove"
    @touchend="onTableTouchEnd"
    @touchcancel="onTableTouchEnd"
  >
    <view class="table-block__table" :style="{ minWidth: tableWidth }">
      <view class="table-block__row table-block__row--head">
        <text
          v-for="(column, index) in columns"
          :key="`${column}-${index}`"
          class="table-block__cell"
        >
          {{ column }}
        </text>
      </view>
      <view v-for="(row, rowIndex) in rows" :key="rowIndex" class="table-block__row">
        <text v-for="(cell, cellIndex) in row" :key="cellIndex" class="table-block__cell">
          {{ cell }}
        </text>
      </view>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
/* 表格：正文底色跟随外层 AI 气泡（#F3F3F3，见 ai-bubble-v2 的回答卡），
   表头第一行铺淡蓝底 #E1F0FF，所有描边（外框 + 行分隔线 + 列分隔线）统一 #E8E8E8 */
.table-block {
  width: 100%;
  overflow: hidden;
  border: 1px solid #e8e8e8;
  border-radius: 20rpx;
  background: transparent;
}
.table-block__table {
  width: 100%;
}
.table-block__row {
  display: flex;
  border-top: 1px solid #e8e8e8;
  color: #1a1a1e;
}
.table-block__row:first-child {
  border-top: 0;
}
/* 表头（第一行）：铺 #E1F0FF，再靠加粗与正文区分 */
.table-block__row--head {
  color: #1a1a1e;
  font-weight: 600;
  background: #e1f0ff;
}
.table-block__cell {
  flex: 1 1 0;
  min-width: 0;
  padding: 24rpx;
  box-sizing: border-box;
  /* 列分隔线：与行分隔线同色；首列左边由表格外框负责，不重复画 */
  border-left: 1px solid #e8e8e8;
  font-size: 24rpx;
  line-height: 36rpx;
  word-break: break-word;
}
.table-block__cell:first-child {
  border-left: 0;
}

/* ===== 深色主题：结构化表格块（Ardot 1193:5104 → 回复卡 1193:5116）=====
   单元格文字与表格外的正文同色（1193:5140 = #FFFFFF 80%），
   描边换成分隔线同值 #303030；尺寸 / 间距 / 字号不动 */
.table-block--dark {
  border-color: #303030;

  .table-block__row {
    border-top-color: #303030;
    color: rgba(255, 255, 255, 0.8);
  }

  // 列分隔线跟随深色稿分隔线 #303030
  .table-block__cell {
    border-left-color: #303030;
  }

  // 表头只靠字重区分，颜色与正文完全一致；
  // 浅色稿的 #E1F0FF 表头底在深底下要顶掉，否则白字压淡蓝看不清
  .table-block__row--head {
    color: rgba(255, 255, 255, 0.8);
    background: transparent;
  }
}
</style>

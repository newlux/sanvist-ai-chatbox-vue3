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
 * 竖向滚动放行（H5）。
 *
 * 表格是横向滚动容器：uni 的 scroll-view 在 H5 下把内层 div 写成
 * `overflow-x: auto; overflow-y: hidden`。浏览器里 `hidden` 同样是「滚动容器」，
 * 该容器的纵向滚动链到它就断了 —— 手指竖滑 / 鼠标滚轮都被它吃掉，
 * 既不滚表格（纵向没有可滚空间）也不滚外层，表现就是「按在表格中间滚不动」。
 *
 * 两条路分开处理：
 * - **手指**交给 CSS（见样式表的 `touch-action: pan-x`）：浏览器只把横向手势给表格，
 *   纵向手势直接由外层消息列表处理，不经过 JS，跟手且不会被 preventDefault 拖慢；
 * - **鼠标滚轮** CSS 管不到，这里把纵向 deltaY 转给外层滚动容器。
 */
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

/** 横向 wheel（deltaX 为主）留给表格自己滚；纵向一律转给外层列表 */
function onTableWheel(event: WheelEvent) {
  // 只服务 H5；小程序端没有 wheel，也没有 DOM 度量
  if (typeof document === "undefined") return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  const scroller = findScrollableAncestor(event.currentTarget as HTMLElement | null);
  if (!scroller) return;
  if (event.cancelable) event.preventDefault();
  scroller.scrollTop += event.deltaY;
}
</script>

<template>
  <scroll-view
    class="table-block"
    :class="{ 'table-block--dark': darkContainer }"
    scroll-x
    :show-scrollbar="false"
    enhanced
    @wheel="onTableWheel"
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

  /**
   * 只把横向手势交给这个滚动容器：`pan-x` 下浏览器不为该元素处理纵向平移，
   * 竖滑直接由外层消息列表接管，不会被 `overflow-y: hidden` 的内层 div 截断。
   * 内层 div 是 uni 运行时生成的，得穿透 scoped 才命中。
   */
  :deep(.uni-scroll-view) {
    touch-action: pan-x;
  }
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

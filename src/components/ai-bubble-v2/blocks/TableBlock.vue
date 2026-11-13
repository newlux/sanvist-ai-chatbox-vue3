<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useVerticalScrollGesture } from "@/hooks/useVerticalScrollGesture";

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

const tableRoot = ref<unknown>(null);
useVerticalScrollGesture(tableRoot);
</script>

<template>
  <scroll-view
    ref="tableRoot"
    class="table-block"
    :class="{ 'table-block--dark': darkContainer }"
    scroll-x
    :show-scrollbar="false"
    enhanced
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

  // 横向由浏览器滚表格，纵向由捕获监听显式转给外层，避免安卓嵌套滚动截断。
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
   单元格文字与表格外的正文同色（实色 #FFFFFF，与 markdown 正文一致）；
   外框 + 行分隔线 + 列分隔线一律 #303030；表头铺深蓝底 #173859；
   尺寸 / 间距 / 字号不动 */
.table-block--dark {
  border-color: #303030;

  .table-block__row {
    border-top-color: #303030;
    color: #ffffff;
  }

  // 列分隔线（表格内部竖线）跟随 #303030
  .table-block__cell {
    border-left-color: #303030;
  }

  // 表头：深蓝底 #173859 + 白字加粗；浅色稿的 #E1F0FF 在这里顶掉
  .table-block__row--head {
    color: #ffffff;
    background: #173859;
  }
}
</style>

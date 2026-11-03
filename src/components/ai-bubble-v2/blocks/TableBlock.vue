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
</script>

<template>
  <scroll-view
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
/* 表格：底色跟随外层 AI 气泡（#F3F3F3，见 ai-bubble-v2 的回答卡），
   表格本身不铺白底、表头也不再压深，只用描边和字重区分行列 */
.table-block {
  width: 100%;
  overflow: hidden;
  border: 1px solid #efefef;
  border-radius: 20rpx;
  background: transparent;
}
.table-block__table {
  width: 100%;
}
.table-block__row {
  display: flex;
  border-top: 1px solid #e5e5e5;
  color: #1a1a1e;
}
.table-block__row:first-child {
  border-top: 0;
}
/* 表头：不再铺 #F9F9F9，与正文同底色，靠加粗和深一档的文字色区分 */
.table-block__row--head {
  color: #1a1a1e;
  font-weight: 600;
}
.table-block__cell {
  flex: 1 1 0;
  min-width: 0;
  padding: 24rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 36rpx;
  word-break: break-word;
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

  // 表头只靠字重区分，颜色与正文完全一致
  .table-block__row--head {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>

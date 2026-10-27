<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "TableBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

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
  <scroll-view class="table-block" scroll-x :show-scrollbar="false" enhanced>
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
</style>

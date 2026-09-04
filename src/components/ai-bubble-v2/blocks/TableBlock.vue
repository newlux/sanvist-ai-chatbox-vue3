<script setup lang="ts">
import { computed } from "vue";

defineOptions({ name: "TableBlock" });

const props = defineProps({
  payload: { type: Object, default: () => ({}) },
});

const columnCount = computed(() => {
  const headerCount = Array.isArray(props.payload?.columns) ? props.payload.columns.length : 0;
  const rowCount = Array.isArray(props.payload?.rows)
    ? Math.max(...props.payload.rows.map((row: unknown) => (Array.isArray(row) ? row.length : 0)), 0)
    : 0;
  return Math.max(headerCount, rowCount, 1);
});
const tableWidth = computed(() => `${columnCount.value * 180}rpx`);
</script>

<template>
  <scroll-view class="table-block" scroll-x :show-scrollbar="false" enhanced>
    <view class="table-block__table" :style="{ width: tableWidth }">
      <view class="table-block__row table-block__row--head">
        <text
          v-for="(column, index) in payload.columns || []"
          :key="`${column}-${index}`"
          class="table-block__cell"
        >
          {{ column }}
        </text>
      </view>
      <view v-for="(row, rowIndex) in payload.rows || []" :key="rowIndex" class="table-block__row">
        <text v-for="(cell, cellIndex) in row" :key="cellIndex" class="table-block__cell">
          {{ cell }}
        </text>
      </view>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
.table-block {
  width: 100%;
  overflow: hidden;
  border: 1px solid #e4e9f0;
  border-radius: 20rpx;
  background: #fff;
}
.table-block__table {
  min-width: 100%;
}
.table-block__row {
  display: flex;
  border-top: 1px solid #e4e9f0;
  color: #5f6775;
}
.table-block__row:first-child {
  border-top: 0;
}
.table-block__row--head {
  background: #f9f9f9;
  color: #2f323c;
  font-weight: 600;
}
.table-block__cell {
  width: 180rpx;
  min-width: 180rpx;
  flex: 0 0 180rpx;
  padding: 24rpx;
  box-sizing: border-box;
  font-size: 24rpx;
  line-height: 36rpx;
  word-break: break-word;
}
</style>

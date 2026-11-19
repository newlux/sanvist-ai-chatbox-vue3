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
    <view class="table-block__table">
      <view class="table-block__row table-block__row--head">
        <view
          v-for="(column, index) in columns"
          :key="`${column}-${index}`"
          class="table-block__cell"
        >
          <text class="table-block__cell-text">
            {{ column }}
          </text>
        </view>
      </view>
      <view v-for="(row, rowIndex) in rows" :key="rowIndex" class="table-block__row">
        <view v-for="(cell, cellIndex) in row" :key="cellIndex" class="table-block__cell">
          <text class="table-block__cell-text">
            {{ cell }}
          </text>
        </view>
      </view>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
/* 表格：正文底色跟随外层 AI 气泡（#F3F3F3，见 ai-bubble-v2 的回答卡），
   表头第一行铺 #E8E8E8，所有描边（外框 + 行分隔线 + 列分隔线）也是 #E8E8E8 */
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
/* 宽度按内容自适应：
   - 短内容的列收窄，长文本的列拿到足够宽度，不会因为「按列数均分」把长文本挤在窄列里
     换出一大堆行，导致这一行比别的行高出一截；
   - 最窄仍铺满气泡（min-width: 100%），再宽就交给外层 scroll-view 横向滚动。
   表格布局同时保证「同一列的单元格跨行对齐」—— 换成 flex 逐行自适应会各行算各的列宽、上下错位。

   宽度必须是 max-content，不能留 auto：table 的 auto 宽度是 shrink-to-fit（不超过容器宽），
   内容比容器宽时会把各列压到 min-content —— 中文一列只有一个字宽，整列逐字竖排。
   老内核不认 max-content 时按块级收缩，虽不理想但不会出现上面的竖排。 */
.table-block__table {
  display: table;
  width: -webkit-max-content;
  width: max-content;
  min-width: 100%;
  /* 横向 scroll-view 的内层容器在部分 uni 版本里是 flex：不加这行，表格会被 shrink 回容器宽，
     又变成一列一个字宽 */
  flex: none;
}
.table-block__row {
  display: table-row;
  color: #1a1a1e;
}
/* 表头（第一行）：铺 #E8E8E8，再靠加粗与正文区分 */
.table-block__row--head {
  font-weight: 600;
}
.table-block__row--head .table-block__cell {
  background: #e8e8e8;
}
.table-block__cell {
  display: table-cell;
  padding: 24rpx;
  box-sizing: border-box;
  /* 行分隔线 / 列分隔线：同色；首行顶边与首列左边由表格外框负责，不重复画 */
  border-top: 1px solid #e8e8e8;
  border-left: 1px solid #e8e8e8;
  vertical-align: top;
  font-size: 24rpx;
  line-height: 36rpx;
}
.table-block__row:first-child .table-block__cell {
  border-top: 0;
}
.table-block__cell:first-child {
  border-left: 0;
}
/* 单元格内容：单条文本的宽度上限落在这层块级容器上（table-cell 自身的 max-width 会被表格算法忽略）。
   平时的短文本按内容收窄，只有超过上限的长文本才换行 —— 换行行数可控，行高不会被一条长文本拉爆 */
.table-block__cell-text {
  display: block;
  max-width: 420rpx;
  word-break: break-word;
  overflow-wrap: anywhere;
}

/* ===== 深色主题：结构化表格块（Ardot 1193:5104 → 回复卡 1193:5116）=====
   单元格文字与表格外的正文同色（实色 #FFFFFF，与 markdown 正文一致）；
   外框 + 行分隔线 + 列分隔线一律 #303030；表头铺 #303030；
   尺寸 / 间距 / 字号不动 */
.table-block--dark {
  border-color: #303030;
  margin-bottom: 16rpx;

  .table-block__row {
    color: #ffffff;
  }

  // 行 / 列分隔线（表格内部横竖线）跟随 #303030
  .table-block__cell {
    border-top-color: #303030;
    border-left-color: #303030;
  }

  // 表头：#303030 + 白字加粗；浅色稿的 #E8E8E8 在这里顶掉
  .table-block__row--head .table-block__cell {
    color: #ffffff;
    background: #303030;
  }
}
</style>

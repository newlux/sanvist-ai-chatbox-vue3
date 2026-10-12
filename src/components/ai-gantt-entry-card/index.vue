<script setup lang="ts">
/**
 * 甘特图入口卡 —— 设计稿 4708:743 里的「任务协同-当天任务甘特图」卡片（节点 4750:17 / 4750:28）。
 *
 * 版式：335 宽白卡、描边 #EFEFEF、圆角 16
 *      → 左侧 16×17 甘特图小图标（#1A1A1E）
 *      → 标题 14px Medium #000000
 *      → 右侧箭头（红色描边 #E01313）
 *      → 三行键值：标签 11px #999999 左对齐，值 12px #000000 右对齐（状态 / 设备数 / 任务数）
 *
 * 只负责展示与点击上报，跳转由页面处理（emit `tap`）。
 */

defineOptions({ name: "AiGanttEntryCard" });

defineProps({
  /** 卡片标题 */
  title: { type: String, default: "任务协同-当天任务甘特图" },
  /** 状态值 */
  status: { type: String, default: "已下发" },
  /** 设备数描述 */
  devices: { type: String, default: "搅拌车 4 台｜泵车 1 台" },
  /** 任务数描述 */
  taskCount: { type: String, default: "15 个" },
});

const emit = defineEmits<{
  tap: [];
}>();
</script>

<template>
  <view class="gantt-entry" @tap="emit('tap')">
    <view class="gantt-entry__head">
      <!-- 甘特图小图标：三根横条，纯 CSS 画（设计稿 4750:22 矢量） -->
      <view class="gantt-entry__icon">
        <view class="gantt-entry__icon-bar gantt-entry__icon-bar--1" />
        <view class="gantt-entry__icon-bar gantt-entry__icon-bar--2" />
        <view class="gantt-entry__icon-bar gantt-entry__icon-bar--3" />
      </view>
      <text class="gantt-entry__title">
        {{ title }}
      </text>
      <view class="gantt-entry__chevron" />
    </view>

    <view class="gantt-entry__rows">
      <view class="gantt-entry__row">
        <text class="gantt-entry__label">
          状态
        </text>
        <text class="gantt-entry__value">
          {{ status }}
        </text>
      </view>
      <view class="gantt-entry__row">
        <text class="gantt-entry__label">
          设备数
        </text>
        <text class="gantt-entry__value">
          {{ devices }}
        </text>
      </view>
      <view class="gantt-entry__row">
        <text class="gantt-entry__label">
          任务数
        </text>
        <text class="gantt-entry__value">
          {{ taskCount }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.gantt-entry {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  padding: 19px 18px 16px;
  border: 1px solid #efefef;
  border-radius: 16px;
  background: #ffffff;
}

.gantt-entry:active {
  opacity: 0.85;
}

.gantt-entry__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 甘特图标：16×17，三根圆角横条错落排布 */
.gantt-entry__icon {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex-shrink: 0;
  width: 16px;
  height: 17px;
}

.gantt-entry__icon-bar {
  height: 3px;
  border-radius: 1.5px;
  background: #1a1a1e;
}

.gantt-entry__icon-bar--1 {
  width: 16px;
}

.gantt-entry__icon-bar--2 {
  width: 11px;
  margin-left: 5px;
}

.gantt-entry__icon-bar--3 {
  width: 13px;
}

.gantt-entry__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #000000;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 右侧箭头：红色「>」（设计稿 4750:20，描边 #E01313） */
.gantt-entry__chevron {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-top: 1.5px solid #e01313;
  border-right: 1.5px solid #e01313;
  transform: rotate(45deg);
}

.gantt-entry__rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 14px;
}

.gantt-entry__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gantt-entry__label {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 14px;
  color: #999999;
}

.gantt-entry__value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  font-size: 12px;
  line-height: 16px;
  color: #000000;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>

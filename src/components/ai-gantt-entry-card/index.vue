<script setup lang="ts">
/**
 * 甘特图入口卡 —— 设计稿 4708:743 里的「任务协同-当天任务甘特图」卡片（节点 4750:17 / 4750:28）。
 *
 * 版式：宽度 100% 随容器自适应（与 .scene-welcome 同思路，尺寸用 rpx、仅描边用 px），
 *      白卡、描边 #EFEFEF、圆角 16px
 *      → 左侧 16px 双人小图标（设计稿切图 icon-gantt-contacts.png）
 *      → 标题 28rpx Medium #000000
 *      → 右侧箭头（红色描边 #E01313）
 *      → 三行键值：标签 22rpx #999999 左对齐，值 24rpx #000000 右对齐（状态 / 设备数 / 任务数）
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
      <!-- 甘特图小图标：双人/联系人图形，设计稿切图（32×32 @2x → 显示 16×16） -->
      <image
        class="gantt-entry__icon"
        src="@/assets/img/icon-gantt-contacts.png"
        mode="aspectFit"
      />
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
  /* 参照 .scene-welcome：尺寸全部用 rpx 随屏宽自适应，仅描边保留 px */
  padding: 38rpx 36rpx 32rpx;
  border: 1px solid #efefef;
  border-radius: 32rpx;
  background: #ffffff;
}

.gantt-entry:active {
  opacity: 0.85;
}

.gantt-entry__head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

/* 甘特图标：32×34rpx 槽位，用设计稿切图（src/assets/img/icon-gantt-contacts.png，带透明通道） */
.gantt-entry__icon {
  flex-shrink: 0;
  width: 32rpx;
  height: 34rpx;
}

.gantt-entry__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 34rpx;
  color: #000000;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 右侧箭头：红色「>」（设计稿 4750:20，描边 #E01313） */
.gantt-entry__chevron {
  flex-shrink: 0;
  width: 14rpx;
  height: 14rpx;
  border-top: 1.5px solid #e01313;
  border-right: 1.5px solid #e01313;
  transform: rotate(45deg);
}

.gantt-entry__rows {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-top: 28rpx;
}

.gantt-entry__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
}

.gantt-entry__label {
  flex-shrink: 0;
  font-size: 22rpx;
  line-height: 28rpx;
  color: #999999;
}

.gantt-entry__value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  font-size: 24rpx;
  line-height: 32rpx;
  color: #000000;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>

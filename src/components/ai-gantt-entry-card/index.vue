<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
/**
 * 甘特图入口卡 —— 设计稿 4708:743 里的「任务协同-当天任务甘特图」卡片（节点 4750:17 / 4750:28）。
 *
 * 版式：宽度 100% 随容器自适应（与 .scene-welcome 同思路，尺寸用 rpx、仅描边用 px），
 *      白卡、描边 #EFEFEF、圆角 16px
 *      → 左侧 16px 双人小图标（设计稿切图 icon-gantt-contacts.png）
 *      → 标题 28rpx Medium #000000
 *      → 右侧箭头（红色描边 #E01313）
 *      → 键值行动态填充：标签 22rpx #999999 左对齐，值 24rpx #000000 右对齐
 *        （状态 / 设备数 / 任务数，哪项没有数据就整行不显示，全空时键值区不渲染）
 *
 * 只负责展示与点击上报，跳转由页面处理（emit `tap`）。
 */

defineOptions({ name: "AiGanttEntryCard" });

const { t } = useI18n();

const props = defineProps({
  /** 卡片标题；不传用设计稿默认文案（按当前语言翻译） */
  title: { type: String, default: "" },
  /** 状态值：空则「状态」行不显示 */
  status: { type: String, default: "" },
  /** 设备数描述：空则「设备数」行不显示 */
  devices: { type: String, default: "" },
  /** 任务数描述：空则「任务数」行不显示 */
  taskCount: { type: String, default: "" },
});

const emit = defineEmits<{
  tap: [];
}>();

/** 各键值行去空白后判断有无数据，没有就整行不显示 */
const statusText = computed(() => props.status.trim());
const devicesText = computed(() => props.devices.trim());
const taskCountText = computed(() => props.taskCount.trim());
const hasRows = computed(() => Boolean(statusText.value || devicesText.value || taskCountText.value));
/** 标题：接口没给就用设计稿默认文案（跟随当前语言） */
const titleText = computed(() => props.title.trim() || t("task-entry-gantt-title"));
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
        {{ titleText }}
      </text>
      <view class="gantt-entry__chevron" />
    </view>

    <view v-if="hasRows" class="gantt-entry__rows">
      <view v-if="statusText" class="gantt-entry__row">
        <text class="gantt-entry__label">
          {{ t("task-entry-status") }}
        </text>
        <text class="gantt-entry__value">
          {{ statusText }}
        </text>
      </view>
      <view v-if="devicesText" class="gantt-entry__row">
        <text class="gantt-entry__label">
          {{ t("task-entry-devices") }}
        </text>
        <text class="gantt-entry__value">
          {{ devicesText }}
        </text>
      </view>
      <view v-if="taskCountText" class="gantt-entry__row">
        <text class="gantt-entry__label">
          {{ t("task-entry-task-count") }}
        </text>
        <text class="gantt-entry__value">
          {{ taskCountText }}
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
  margin-bottom: 1.25rem;
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
  /* 值换行时标签跟第一行齐平，不跟着整体垂直居中 */
  align-items: flex-start;
  justify-content: space-between;
  gap: 24rpx;
}

.gantt-entry__label {
  flex-shrink: 0;
  /* 与值同高，首行基线才对得上 */
  font-size: 22rpx;
  line-height: 32rpx;
  color: #999999;
}

.gantt-entry__value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: right;
  font-size: 24rpx;
  line-height: 32rpx;
  color: #000000;
  /* 值过长时换行展示，不截断 */
  white-space: normal;
  word-break: break-word;
}
</style>

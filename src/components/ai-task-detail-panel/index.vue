<script setup lang="ts">
import { computed } from "vue";

import {
  TASK_DETAIL_PANEL_STATUS_LABEL,
  type TaskDetailPanelPayload,
} from "./types";

/**
 * 任务详情面板（横屏右侧）——设计稿 6832:292「查看任务详情」。
 *
 * 版面（稿子按 812×375 横屏标注，元素直接用 px）：
 * - 蒙层：整屏 40% 黑（6832:306），点它关闭；
 * - 面板：右侧 368 宽、全高、白底（6832:295），内边距左右 20；
 * - 顶部：状态胶囊（6832:319，底 #ECF5FF 圆角 3）+ 标题 14px Medium（6832:302）+ 关闭 ✕（6832:314，#999）；
 * - 地点卡：328×70、底 #FBFBFB、圆角 6（6832:299）——站点（14px Medium）/ 作业内容 + 方量（12px）/ 右侧补充（12px 右对齐）；
 * - 时段卡：328×56、白底 + #F2F2F2 描边、圆角 6（6832:301）——「计划时段：」「当前进度：」（标签 #999 + 值 #1A1A1A）；
 * - 现场配合：标签（6832:312）+ 328×27 灰底行（6832:313）；
 * - 前后衔接：标签（6832:293）+ 上一程 / 下一程（6832:311/303、6832:300/318）。
 */
defineOptions({ name: "AiTaskDetailPanel" });

const props = defineProps<{
  visible: boolean;
  detail: TaskDetailPanelPayload | null;
}>();

const emit = defineEmits<{ "update:visible": [value: boolean] }>();

const statusLabel = computed(() =>
  props.detail ? TASK_DETAIL_PANEL_STATUS_LABEL[props.detail.status] : "",
);

/**
 * 信息卡第二行的标签随状态变化（稿子 6832:292 / 6832:321）：
 * 执行中 →「当前进度：」，待执行 →「准备就绪：」；其余状态按语义补。
 */
const PROGRESS_LABEL: Record<string, string> = {
  running: "当前进度：",
  pending: "准备就绪：",
  done: "完成情况：",
  canceled: "取消说明：",
  overdue: "逾期说明：",
};

const progressLabel = computed(() =>
  props.detail ? PROGRESS_LABEL[props.detail.status] || "当前进度：" : "当前进度：",
);

function close() {
  emit("update:visible", false);
}
</script>

<template>
  <view v-if="visible" class="tdp">
    <!-- 蒙层：40% 黑，点击关闭（6832:306） -->
    <view class="tdp__mask" @tap="close" @touchstart.stop />

    <!-- 右侧面板：368 宽、全高、白底（6832:295） -->
    <view class="tdp__panel">
      <!-- 顶部：状态胶囊 + 车号|车型|司机 + 关闭（6832:334 / 6832:326 / 6832:347） -->
      <view class="tdp__head">
        <view class="tdp__status" :class="`tdp__status--${detail?.status}`">
          {{ statusLabel }}
        </view>
        <text class="tdp__title">
          {{ detail?.title }}
        </text>
        <view class="tdp__close" @tap="close">
          <view class="tdp__close-icon" />
        </view>
      </view>

      <!-- 站点卡：328×70、底 #FBFBFB、圆角 6（6832:299 / 6832:333） -->
      <view class="tdp__site">
        <view class="tdp__site-top">
          <text class="tdp__site-name">
            {{ detail?.site }}
          </text>
          <text class="tdp__site-note">
            {{ detail?.supplyNote }}
          </text>
        </view>
        <view class="tdp__site-bottom">
          <text class="tdp__site-work">
            {{ detail?.workType }}
          </text>
          <text class="tdp__site-volume">
            {{ [detail?.spec, detail?.volume].filter(Boolean).join(" ") }}
          </text>
        </view>
      </view>

      <!-- 逾期警告：仅「逾期未开始」有（样本 4：计划未开始（逾期 5 分钟）+ 说明） -->
      <view v-if="detail?.warning" class="tdp__warning">
        <view class="tdp__warning-head">
          <view class="tdp__warning-icon" />
          <text class="tdp__warning-title">
            {{ detail.warning.title }}
          </text>
        </view>
        <text class="tdp__warning-text">
          {{ detail.warning.text }}
        </text>
      </view>

      <!-- 时段 / 进度卡（6832:301）；逾期时「当前进度」由警告块替代 -->
      <view class="tdp__info">
        <view class="tdp__row">
          <text class="tdp__label tdp__label--wide">计划时段：</text>
          <text class="tdp__value">
            {{ detail?.planTime }}
          </text>
        </view>
        <view v-if="!detail?.warning" class="tdp__row">
          <text class="tdp__label tdp__label--wide">
            {{ progressLabel }}
          </text>
          <text class="tdp__value">
            {{ detail?.progress }}
          </text>
        </view>
      </view>

      <!-- 现场配合（6832:312 标签 + 6832:313 行，前面可带一个小图标） -->
      <text class="tdp__section">现场配合</text>
      <view class="tdp__support">
        <text v-if="detail?.supportIcon" class="tdp__support-icon">
          {{ detail.supportIcon }}
        </text>
        <text class="tdp__support-text">
          {{ detail?.support }}
        </text>
      </view>

      <!-- 前后衔接（6832:293 标签 + 上一程 / 下一程） -->
      <text class="tdp__section">前后衔接</text>
      <view class="tdp__row">
        <text class="tdp__label">上一程：</text>
        <text class="tdp__value">
          {{ detail?.previous }}
        </text>
      </view>
      <view class="tdp__row">
        <text class="tdp__label">下一程：</text>
        <text class="tdp__value">
          {{ detail?.next }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 稿子按 812×375 横屏标注，这里用 px 直接对应（页面本身就是横屏坐标系） */
.tdp {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.tdp__mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.4);
}

/* 面板：368 宽 + 全高，内容左右各留 20（464-444=20，与稿子一致） */
.tdp__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 368px;
  padding: 26px 20px 0;
  background: #ffffff;
}

/* 顶部一行：胶囊 + 标题 + 关闭 */
.tdp__head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
}

/* 状态胶囊：底 #ECF5FF、圆角 3、12px Medium（6832:319） */
.tdp__status {
  flex-shrink: 0;
  padding: 1px 4px;
  border-radius: 3px;
  background: #ecf5ff;
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #1a1a1a;
}

/* 已完成：灰底 */
.tdp__status--done {
  background: #f0f0f0;
  color: #666666;
}

/* 待执行：淡紫底（样本 3） */
.tdp__status--pending {
  background: #f1ecff;
  color: #6b5ae0;
}

/* 已取消：灰底灰字 */
.tdp__status--canceled {
  background: #f4f4f4;
  color: #999999;
}

/* 逾期未开始：白底 + #D9D9D9 描边（样本 4） */
.tdp__status--overdue {
  padding: 0 3px;
  border: 1px solid #d9d9d9;
  background: #ffffff;
  color: #999999;
}

.tdp__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}

.tdp__close:active {
  opacity: 0.6;
}

/* 关闭 ✕：17×17、#999（6832:315/316 两个对角的矢量） */
.tdp__close-icon {
  position: relative;
  width: 17px;
  height: 17px;
}

.tdp__close-icon::before,
.tdp__close-icon::after {
  content: "";
  position: absolute;
  top: 8px;
  left: 0;
  width: 17px;
  height: 1px;
  background: #999999;
}

.tdp__close-icon::before {
  transform: rotate(45deg);
}

.tdp__close-icon::after {
  transform: rotate(-45deg);
}

/* 顶部标题：车号|车型|司机（14px Medium，6832:302/326） */
.tdp__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #000000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 站点卡：328×70、底 #FBFBFB、圆角 6（6832:299 / 6832:333） */
.tdp__site {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  width: 328px;
  height: 70px;
  margin-top: 4px;
  padding: 0 16px;
  border-radius: 6px;
  background: #fbfbfb;
}

.tdp__site-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tdp__site-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tdp__site-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tdp__site-work {
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
}

.tdp__site-volume {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #999999;
}

.tdp__site-note {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
}

/* 逾期提示块：白底 + #767676 虚线、圆角 6，328 宽 69 高（稿子 6832:381） */
.tdp__warning {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  width: 328px;
  min-height: 69px;
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px dashed #767676;
  border-radius: 6px;
  background: #ffffff;
}

.tdp__warning-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 警告图标：12×12 圆圈 + 指针（纯 CSS 画，对应稿子里的小时钟） */
.tdp__warning-icon {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1.5px solid #999999;
  border-radius: 50%;
}

.tdp__warning-icon::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 4px;
  width: 1.5px;
  height: 5px;
  background: #999999;
}

.tdp__warning-title {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  color: #1a1a1a;
}

.tdp__warning-text {
  font-size: 12px;
  line-height: 16px;
  color: #666666;
}

/* 时段 / 进度卡：328×56、白底 + #F2F2F2 描边（6832:301） */
.tdp__info {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  height: 56px;
  margin-top: 10px;
  padding: 0 16px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
}

.tdp__row {
  display: flex;
  align-items: center;
  min-width: 0;
}

.tdp__label {
  flex-shrink: 0;
  width: 48px;
  font-size: 12px;
  line-height: 15px;
  color: #999999;
}

/* 卡片里的标签宽 60（稿子 480 → 540，值从 540 起） */
.tdp__label--wide {
  width: 60px;
}

.tdp__value {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  line-height: 15px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 分区标签：现场配合 / 前后衔接（6832:312 / 6832:293） */
.tdp__section {
  margin-top: 10px;
  font-size: 12px;
  line-height: 15px;
  color: #999999;
}

/* 现场配合行：328×27、#FBFBFB、圆角 6（6832:313） */
.tdp__support {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 27px;
  margin-top: 6px;
  padding: 0 8px;
  border-radius: 6px;
  background: #fbfbfb;
}

.tdp__support-text {
  font-size: 12px;
  line-height: 15px;
  color: #000000;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 现场配合前置小图标（可选） */
.tdp__support-icon {
  flex-shrink: 0;
  margin-right: 6px;
  font-size: 12px;
  line-height: 15px;
}

/* 前后衔接两行：标签 48 + 值（稿子 464 → 512） */
.tdp__section + .tdp__row,
.tdp__support + .tdp__section + .tdp__row {
  margin-top: 6px;
}

.tdp__panel > .tdp__row + .tdp__row {
  margin-top: 6px;
}
</style>

<script setup lang="ts">
import type { TaskDetailPayload } from "@/components/ai-task-detail-sheet/types";
import { TASK_DETAIL_STATUS_LABEL } from "@/components/ai-task-detail-sheet/types";
import { useSafeArea } from "@/hooks/useSafeArea";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 个人任务详情列表（计划详情-司机）——竖屏页，设计稿 4637:478（列表）+ 6832:464（带状态）
 * + 3918:345（入口：作业协同对话里的「任务协同-个人排班甘特图」卡片）。
 *
 * 版面：375 宽竖屏（稿件坐标直接用 px）
 * - 顶部导航 50 高：「<」返回（22 左）+ 居中标题「详情」16px Medium #1A1A1E；
 * - 司机卡片 335×72：姓名 16px SemiBold #000 / 日期 14px Medium #1A1A1E（右对齐）
 *   / 车辆班组 14px Regular #999；
 * - 行程分组：路线标题 15px Medium #000 + 逐条任务行
 *   （左列起止时间 14px Medium #666、中间连接线与圆点、右侧任务卡 252×41）；
 * - 底部备注 335×54：白底 + #E6E6E6 描边、圆角 6、12px Medium 居中两行。
 *
 * 任务卡配色（设计稿 6832:494 / 6832:507 / 6832:514 / 6832:531）：
 *   已完成  底 #FBFBFB 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   执行中  底 #ECF5FF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #1A1A1A（唯一高亮态）
 *   待执行  底 #FFFFFF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   已取消  底 #EFEFEF 描边 #F2F2F2 文字 #999999，右侧状态 #999999
 */

defineOptions({ name: "TaskDetailPage" });

/** 状态栏 / 底部安全区：内嵌 webview 里拿不到真实值时 hook 会兜底 */
const { safeAreaStyle } = useSafeArea();

/**
 * 行程数据（mock）：结构与 components/ai-task-detail-sheet/types 一致，
 * 接入后端时换成接口返回即可（同一份内容横屏用 AiTaskDetailSheet，竖屏用本页）。
 */
const detail: TaskDetailPayload = {
  driverName: "邓文斌",
  dateText: "2026-09-16  今天",
  vehicleText: "13号车（湘A65578）白班",
  groups: [
    {
      route: "从1 号站→A3 基地",
      items: [
        { start: "08:00", end: "08:30", name: "C30混凝土12方", status: "done" },
        { start: "08:30", end: "09:30", name: "C30混凝土12方", status: "done" },
        { start: "09:30", end: "10:30", name: "C30混凝土20方", status: "running" },
      ],
    },
    {
      route: "从2 号站→万达广场基地",
      items: [
        { start: "08:00", end: "08:30", name: "C30混凝土12方", status: "canceled" },
        { start: "08:30", end: "09:30", name: "C30混凝土12方", status: "pending" },
      ],
    },
    {
      route: "从1 号站→A3 基地",
      items: [
        { start: "08:00", end: "08:30", name: "C30混凝土12方", status: "pending" },
        { start: "08:30", end: "09:30", name: "C30混凝土12方", status: "pending" },
      ],
    },
  ],
  note: "1631完成盼盼路运输并回站后自班结束。\n后续夜班任务由肖鹏接车执行。",
};

/** 返回：上一页是对话页就直接返回，独立场景窗口则关窗，兜底回作业协同页 */
function onBack() {
  backFromScene("/pages/task/index");
}
</script>

<template>
  <view class="td" :style="safeAreaStyle">
    <!-- 顶部导航（设计稿 4637:491：返回 4637:492 + 标题 4637:494） -->
    <view class="td__nav">
      <view class="td__back" @tap="onBack">
        <view class="td__back-arrow" />
      </view>
      <text class="td__nav-title">
        详情
      </text>
    </view>

    <scroll-view class="td__body" scroll-y>
      <!-- 司机卡片（设计稿 6832:400 / 401 / 403 / 402） -->
      <view class="td__driver">
        <view class="td__driver-top">
          <text class="td__driver-name">
            {{ detail.driverName }}
          </text>
          <text class="td__driver-date">
            {{ detail.dateText }}
          </text>
        </view>
        <text class="td__driver-vehicle">
          {{ detail.vehicleText }}
        </text>
      </view>

      <!-- 行程分组：路线标题 + 逐条任务（左侧起止时间 + 连接线圆点 + 右侧任务卡） -->
      <view v-for="group in detail.groups" :key="group.route" class="td__group">
        <text class="td__route">
          {{ group.route }}
        </text>

        <view v-for="item in group.items" :key="`${group.route}-${item.start}-${item.name}`" class="td__row">
          <view class="td__times">
            <text class="td__time">
              {{ item.start }}
            </text>
            <!-- 两段时间之间的小短横（设计稿 6832:443 / 4708:570 等） -->
            <view class="td__time-tick" />
            <text class="td__time">
              {{ item.end }}
            </text>
          </view>

          <view class="td__spine">
            <view class="td__dot" />
          </view>

          <view class="td__card" :class="`td__card--${item.status}`">
            <text class="td__card-text">
              {{ item.name }}
            </text>
            <text class="td__status" :class="{ 'td__status--running': item.status === 'running' }">
              {{ TASK_DETAIL_STATUS_LABEL[item.status] }}
            </text>
          </view>
        </view>
      </view>

      <!-- 底部备注（设计稿 6832:463 / 6832:462 / 6832:460） -->
      <view v-if="detail.note" class="td__note">
        <text class="td__note-text">
          {{ detail.note }}
        </text>
      </view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
/* 竖屏页：稿子 375 × 818，元素尺寸直接按稿件 px */
.td {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #ffffff;
  color: #1a1a1e;
  font-family: "PingFang SC", "Inter", sans-serif;
}

/* ---------- 顶部导航：50 高，标题居中、返回箭头贴左 22 ---------- */
.td__nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  /* 状态栏高度由 useSafeArea 写入 --safe-top-px */
  margin-top: var(--safe-top-px, 0px);
  height: 50px;
}

.td__back {
  position: absolute;
  left: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.td__back:active {
  opacity: 0.6;
}

/* 返回箭头：两条线拼出的「<」（设计稿 4637:493） */
.td__back-arrow {
  width: 9px;
  height: 9px;
  border-left: 1.5px solid #1a1a1e;
  border-bottom: 1.5px solid #1a1a1e;
  transform: rotate(45deg);
}

.td__nav-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  color: #1a1a1e;
}

/* ---------- 内容区：整页可滚，左右各 20 内边距 ---------- */
.td__body {
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  padding: 0 20px calc(20px + var(--safe-bottom-px, 0px));
}

/* ---------- 司机卡片：335×72、白底 + #EFEFEF 描边、圆角 16 ---------- */
.td__driver {
  display: flex;
  flex-direction: column;
  justify-content: center;
  box-sizing: border-box;
  height: 72px;
  padding: 0 16px;
  border: 1px solid #efefef;
  border-radius: 16px;
  background: #ffffff;
}

.td__driver-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.td__driver-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 19px;
  color: #000000;
}

.td__driver-date {
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #1a1a1e;
}

.td__driver-vehicle {
  margin-top: 4px;
  font-size: 14px;
  line-height: 17px;
  color: #999999;
}

/* ---------- 行程分组 ---------- */
/* 组间距 11（稿件上一行时间框底 389 → 下一个路线标题 400）；首组距司机卡片 14（179 → 193） */
.td__group {
  margin-top: 11px;
}

/* 首组紧跟在司机卡片后面（不能用 :first-of-type：兄弟节点都是 uni-view） */
.td__driver + .td__group {
  margin-top: 14px;
}

.td__route {
  display: block;
  font-size: 15px;
  font-weight: 500;
  line-height: 18px;
  color: #000000;
}

/* 任务行：时间列（52 高）+ 连接线圆点 + 任务卡（41 高），行间 5 间距（稿件行距 57） */
.td__row {
  display: flex;
  align-items: flex-start;
  margin-top: 12px;
}

.td__row + .td__row {
  margin-top: 5px;
}

/* 左列起止时间：14px Medium #666，两行各 26 行高 */
.td__times {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 42px;
}

.td__time {
  display: block;
  font-size: 14px;
  font-weight: 500;
  line-height: 26px;
  color: #666666;
}

/* 两段时间之间的小短横：#CCCCCC 1×8，水平居中 */
.td__time-tick {
  position: absolute;
  top: 17px;
  left: 50%;
  width: 1px;
  height: 8px;
  margin-left: -0.5px;
  background: #cccccc;
}

/* 连接线 + 圆点：外 14 圈 #F1F1F1、内 8 点 #C0C0C0；线只在圆点之间（最后一行不画） */
.td__spine {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex-shrink: 0;
  align-self: stretch;
  /* 稿件：时间列右缘 62 → 任务卡左缘 103 之间，圆点居中（圆心 83） */
  width: 41px;
}

.td__spine::before {
  content: "";
  position: absolute;
  top: 7px;
  /* 画到下一行圆点中心（行距 57 - 行高 52 + 圆点中心 7） */
  bottom: -12px;
  left: 50%;
  width: 1px;
  margin-left: -0.5px;
  background: #f1f1f1;
}

.td__row:last-child .td__spine::before {
  display: none;
}

.td__dot {
  position: relative;
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f1f1f1;
}

.td__dot::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c0c0;
}

/* 任务卡：252×41、圆角 6、描边 #F2F2F2；右侧状态文案在卡内右对齐（稿件 x=298） */
.td__card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  height: 41px;
  padding: 0 15px 0 12px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
}

.td__card-text {
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #1a1a1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.td__card--done {
  background: #fbfbfb;
}

.td__card--running {
  background: #ecf5ff;
}

.td__card--canceled {
  background: #efefef;
}

.td__card--canceled .td__card-text {
  color: #999999;
}

.td__status {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #999999;
}

.td__status--running {
  color: #1a1a1a;
}

/* ---------- 底部备注：335×54、白底 + #E6E6E6 描边、圆角 6、12px 居中两行 ---------- */
.td__note {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 54px;
  /* 稿件：最后一行时间框底 689 → 备注块 696 */
  margin-top: 7px;
  padding: 10px 38px;
  border: 1px solid #e6e6e6;
  border-radius: 6px;
  background: #ffffff;
}

.td__note-text {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  text-align: center;
  color: #1a1a1e;
}
</style>

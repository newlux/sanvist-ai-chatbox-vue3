<script setup lang="ts">
import { computed } from "vue";

import { TASK_DETAIL_STATUS_LABEL, type TaskDetailPayload } from "./types";

/**
 * 任务详情窗口（计划详情-司机）——设计稿 6832:464，蒙层 6832:322。
 *
 * 形态：**停靠在看板右缘的全高面板**（从右侧滑入）
 * → 40% 黑蒙层（点击关闭）
 * → 面板：顶部「详情」+ 返回箭头
 *      → 司机卡片（姓名 / 日期 / 车辆班组）
 *      → 一段或多段「从X号站→Y基地」任务组（左列起止时间 + 连接线圆点，右列任务卡 + 状态）
 *      → 底部备注（虚线框）
 *
 * 横屏说明：页面用 `useLandscape` 旋转模拟横屏时，坐标是「看板坐标」（旋转前），
 * 面板停靠看板右缘，设备转过来看就是右侧面板；真机本来就横屏时同理。
 *
 * 状态配色（设计稿节点 6832:494 / 6832:507 / 6832:514 / 6832:531 等）：
 *   已完成  底 #FBFBFB 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   执行中  底 #ECF5FF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #1A1A1E（唯一高亮态）
 *   待执行  底 #FFFFFF 描边 #F2F2F2 文字 #1A1A1E，右侧状态 #999999
 *   已取消  底 #EFEFEF 描边 #F2F2F2 文字 #999999，右侧状态 #999999
 */

defineOptions({ name: "AiTaskDetailSheet" });

const props = defineProps({
  visible: { type: Boolean, default: false },
  detail: { type: Object as () => TaskDetailPayload | null, default: null },
});

const emit = defineEmits<{
  "update:visible": [visible: boolean];
}>();

const groups = computed(() => props.detail?.groups || []);

function close() {
  emit("update:visible", false);
}
</script>

<template>
  <view v-if="visible" class="task-detail">
    <!-- 蒙层：40% 黑，点击关闭（设计稿 6832:322） -->
    <view class="task-detail__mask" @tap="close" @touchstart.stop />

    <view class="task-detail__sheet">
      <!-- 顶部导航：返回箭头 + 「详情」（设计稿 6832:468 / 6832:471） -->
      <view class="task-detail__nav">
        <view class="task-detail__back" @tap="close">
          <view class="task-detail__back-arrow" />
        </view>
        <text class="task-detail__nav-title">
          详情
        </text>
      </view>

      <scroll-view class="task-detail__body" scroll-y>
        <!-- 司机卡片：姓名 + 日期 + 车辆班组（设计稿 6832:579 / 6832:537 / 6832:465 / 6832:575） -->
        <view class="task-detail__driver">
          <view class="task-detail__driver-top">
            <text class="task-detail__driver-name">
              {{ detail?.driverName }}
            </text>
            <text class="task-detail__driver-date">
              {{ detail?.dateText }}
            </text>
          </view>
          <text class="task-detail__driver-vehicle">
            {{ detail?.vehicleText }}
          </text>
        </view>

        <!-- 任务组：路线标题 + 逐条任务（左侧时间轴 + 右侧任务卡） -->
        <view v-for="group in groups" :key="group.route" class="task-detail__group">
          <text class="task-detail__route">
            {{ group.route }}
          </text>

          <view v-for="item in group.items" :key="`${group.route}-${item.start}-${item.name}`" class="task-detail__row">
            <view class="task-detail__times">
              <text class="task-detail__time">
                {{ item.start }}
              </text>
              <text class="task-detail__time">
                {{ item.end }}
              </text>
            </view>

            <!-- 连接线 + 圆点 -->
            <view class="task-detail__spine">
              <view class="task-detail__dot" />
            </view>

            <view class="task-detail__card" :class="`task-detail__card--${item.status}`">
              <text class="task-detail__card-text">
                {{ item.name }}
              </text>
            </view>

            <text class="task-detail__status" :class="{ 'task-detail__status--running': item.status === 'running' }">
              {{ TASK_DETAIL_STATUS_LABEL[item.status] }}
            </text>
          </view>
        </view>

        <!-- 底部备注（设计稿 6832:522 / 6832:523） -->
        <view v-if="detail?.note" class="task-detail__note">
          <text class="task-detail__note-text">
            {{ detail.note }}
          </text>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.task-detail {
  position: fixed;
  z-index: 1004;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.task-detail__mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.4);
}

/* 右侧面板：停靠看板右缘、全高、375 宽（窄屏按 100% 收），从右侧滑入 */
.task-detail__sheet {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 375px;
  max-width: 100%;
  border-radius: 20px 0 0 20px;
  background: #ffffff;
  overflow: hidden;
  font-family: "PingFang SC", "Inter", sans-serif;
  animation: task-detail-slide-in 0.24s ease-out;
}

@keyframes task-detail-slide-in {
  from {
    transform: translateX(100%);
  }

  to {
    transform: translateX(0);
  }
}

.task-detail__nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  height: 50px;
}

.task-detail__back {
  position: absolute;
  left: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.task-detail__back:active {
  opacity: 0.6;
}

/* 返回箭头：两条线拼出的「<」（设计稿 6832:469 图标旋转 -90） */
.task-detail__back-arrow {
  width: 9px;
  height: 9px;
  border-left: 1.5px solid #1a1a1e;
  border-bottom: 1.5px solid #1a1a1e;
  transform: rotate(45deg);
}

.task-detail__nav-title {
  font-size: 16px;
  font-weight: 500;
  line-height: 20px;
  color: #1a1a1e;
}

.task-detail__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 20px 20px;
  box-sizing: border-box;
}

/* 司机卡片：白底 + #EFEFEF 描边、圆角 16、72 高 */
.task-detail__driver {
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

.task-detail__driver-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-detail__driver-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 19px;
  color: #000000;
}

.task-detail__driver-date {
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #1a1a1e;
}

.task-detail__driver-vehicle {
  margin-top: 8px;
  font-size: 14px;
  line-height: 17px;
  color: #999999;
}

/* 任务组 */
.task-detail__group {
  margin-top: 23px;
}

.task-detail__route {
  display: block;
  font-size: 15px;
  font-weight: 500;
  line-height: 18px;
  color: #000000;
}

.task-detail__row {
  display: flex;
  align-items: center;
  margin-top: 14px;
}

/* 左列起止时间：14px Medium #666666，两行居中 */
.task-detail__times {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 42px;
  text-align: center;
}

.task-detail__time {
  font-size: 14px;
  font-weight: 500;
  line-height: 26px;
  color: #666666;
}

/* 连接线 + 圆点：外 14 圈 #F1F1F1、内 8 点 #C0C0C0（设计稿 6832:528） */
.task-detail__spine {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  align-self: stretch;
}

.task-detail__spine::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: #cccccc;
}

.task-detail__dot {
  position: relative;
  box-sizing: border-box;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f1f1f1;
}

.task-detail__dot::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c0c0;
}

/* 任务卡：252×41、圆角 6、描边 #F2F2F2 */
.task-detail__card {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  height: 41px;
  padding: 0 12px;
  border: 1px solid #f2f2f2;
  border-radius: 6px;
  background: #ffffff;
}

.task-detail__card-text {
  font-size: 14px;
  line-height: 17px;
  color: #1a1a1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-detail__card--done {
  background: #fbfbfb;
}

.task-detail__card--running {
  background: #ecf5ff;
}

.task-detail__card--canceled {
  background: #efefef;
}

.task-detail__card--canceled .task-detail__card-text {
  color: #999999;
}

/* 右侧状态：14px Medium，执行中为深色（唯一高亮） */
.task-detail__status {
  flex-shrink: 0;
  width: 58px;
  margin-left: 8px;
  text-align: right;
  font-size: 14px;
  font-weight: 500;
  line-height: 17px;
  color: #999999;
}

.task-detail__status--running {
  color: #1a1a1e;
}

/* 备注：白底 + #E6E6E6 描边、圆角 6、54 高、12px 居中两行 */
.task-detail__note {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 54px;
  margin-top: 23px;
  padding: 10px 26px;
  border: 1px solid #e6e6e6;
  border-radius: 6px;
  background: #ffffff;
}

.task-detail__note-text {
  font-size: 12px;
  font-weight: 500;
  line-height: 15px;
  text-align: center;
  color: #1a1a1e;
}
</style>

<script setup lang="ts">
/**
 * 汇报结束后的异常详情弹窗（设计稿 11101:714「异常弹窗-未加急」）。
 *
 * 设计基准：iPhone 画板 375×812
 * 1px = 2rpx
 *
 * 字段映射（来自后端 ReportInsightEvent，由 ReportInsightItem 透出）：
 *   - 标题（设计稿 BC172229235GC）    ← item.deviceId  (= event.deviceNo)
 *   - 异常类型（设计稿 设备异常-冷却水温高）← `${item.eventCategory}-${item.eventType}`
 *   - 发生时间（设计稿 2026-10-28 00:00:00）← item.eventTime
 *   - 事件摘要（设计稿 YSY215-003...）    ← item.description
 *
 * 布局：弹窗内部走 flex column 自然流（之前全部 absolute 导致父容器塌缩成 0 高度、
 * 白色背景不可见；现在用内容驱动高度，摘要变长按钮自动下移让位）。
 * 组件只做展示 + 事件回传：关闭、点击遮罩、加急处理。
 */
import bellIcon from "@/assets/img/report-broadcast/insight-detail-bell.svg";
import closeIcon from "@/assets/img/report-broadcast/insight-detail-close.svg";
import type { ReportInsightItem } from "@/hooks/useReportInsights";

defineProps<{
  /** 弹窗当前展示的异常条目；为 null 时整层不渲染。 */
  item: ReportInsightItem | null;
}>();

const emit = defineEmits<{
  /** 关闭弹窗（X 按钮 / 点击遮罩 / Esc）。 */
  close: [];
  /** 「加急处理」按钮：父组件决定走加急 toggle 还是跳转任务页等。 */
  urgent: [item: ReportInsightItem];
}>();

function onUrgentTap(item: ReportInsightItem) {
  emit("urgent", item);
}
</script>

<template>
  <!-- 设计稿 11101:718 Rectangle 4：375×812 全屏遮罩，纯黑 40% 透明度 -->
  <view
    v-if="item"
    class="insight-detail"
    aria-modal="true"
    @tap.self="emit('close')"
  >
    <!--
      弹窗容器 11101:733 / 11115:4 Group 128：
      设计稿 312×334 @ (33, 238) → rpx 624×668 @ (66, 476)
      内部用 flex column，padding 56/52/52，让头/详情/按钮按内容自然排列。
      当 description 较长时，弹窗整体高度自动增长，按钮相应下移。
    -->
    <view class="insight-detail__popup" @tap.stop>
      <!-- 设计稿 11101:719 Frame 4：30×30 关闭 X，#999 2px 线 -->
      <view
        class="insight-detail__close"
        hover-class="insight-detail__close--active"
        hover-stay-time="80"
        role="button"
        aria-label="关闭"
        @tap="emit('close')"
      >
        <image class="insight-detail__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>

      <!--
        头部：11101:715 铃铛底圆 38×38 #F2F2F2 @ (24,28)
              11101:732 红铃铛 19×19 #C8201E 居中于底圆
              11101:716 标题（deviceNo）Inter Medium 15px #000 @ (74,28)
        用 flex row 横向排铃铛和标题，gap 24rpx 对应设计稿 12px 间距。
      -->
      <view class="insight-detail__header">
        <view class="insight-detail__bell-bg" aria-hidden="true">
          <image class="insight-detail__bell-icon" :src="bellIcon" mode="aspectFit" />
        </view>
        <text class="insight-detail__title">
          {{ item.deviceId }}
        </text>
      </view>

      <!--
        11101:727 事件详情：Inter Regular 14px #999
        与头部的 36rpx 间距（设计稿 84-28-38=18px，扣掉行高 17px 后净空约 36rpx）
      -->
      <text class="insight-detail__section-label">
        事件详情
      </text>

      <!--
        11115:3 Frame 78：260×137 #F6F6F6 r8 pad14
        内部 11115:2 Frame 77：垂直栈，行间距 12px（24rpx）
        现在高度由内容决定，min-height 保留 274rpx 以匹配短文本时的设计稿高度。
      -->
      <view class="insight-detail__box">
        <!--
          11101:726 异常类型：设备异常-冷却水温高
          Inter Regular 14px #1A1A1A
        -->
        <view class="insight-detail__row">
          <text class="insight-detail__row-text">
            异常类型：{{ item.eventCategory }}-{{ item.eventType }}
          </text>
        </view>

        <!--
          11101:739 发生时间：2026-10-28 00:00:00
          Inter Regular 14px #1A1A1A
        -->
        <view class="insight-detail__row">
          <text class="insight-detail__row-text">
            发生时间：{{ item.eventTime }}
          </text>
        </view>

        <!--
          11101:740 事件摘要：\nYSY215-003...
          设计稿是「事件摘要：」独立一行 + 描述自然换行 2 行（共 3 行 51px）。
          用两个 block text 拆分渲染，「事件摘要：」label 一行、description 后续行。
          描述超过 2 行时容器自然撑高，弹窗整体加高，按钮由下方的 margin-top: 32rpx
          保持间距自动下移。
          Inter Regular 14px #1A1A1A
        -->
        <view class="insight-detail__row insight-detail__row--summary">
          <text class="insight-detail__row-text insight-detail__row-prefix">
            事件摘要：
          </text>
          <text class="insight-detail__row-text">
            {{ item.description }}
          </text>
        </view>
      </view>

      <!--
        11101:723 / 11101:724 / 11101:725：加急处理按钮
        260×42 r21 / Inter Medium 14px
        底 / 描边 / 文字颜色跟随当前条目的加急态：
          - 未加急（item.isUrgent=false）：底 #FFFFFF，描边/文字 #C8201E
          - 已加急（item.isUrgent=true） ：底 #F7F7F7，无描边，文字 #0D0D0D
        位于详情框下方 32rpx（设计稿 266-113-137=16px = 32rpx）。
      -->
      <view
        class="insight-detail__action"
        :class="{ 'insight-detail__action--urgent': item.isUrgent }"
        hover-class="insight-detail__action--active"
        hover-stay-time="80"
        role="button"
        aria-label="加急处理"
        @tap="onUrgentTap(item)"
      >
        <text class="insight-detail__action-text">
         {{ item.isUrgent ? '取消加急' : '加急处理' }} 
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
/* ==========================================================================
   异常详情弹窗（设计稿 11101:714「异常弹窗-未加急」）
   1px = 2rpx；所有数值严格使用设计稿的精确像素
   布局说明：弹窗内部走 flex column 自然流，高度由内容撑开。
   ========================================================================== */

/* 11101:718 Rectangle 4：375×812 全屏遮罩，纯黑 40% 透明度 */
.insight-detail {
  position: fixed;
  z-index: 100;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.4);
}

/*
  弹窗容器 11101:733 / 11115:4 Group 128：
  设计稿 312×334 @ (33, 238)
  - 水平居中：left:50% + translateX(-50%)
  - 垂直对齐设计稿 y=238 → rpx 476
  - 624rpx 宽，白色背景，圆角 40rpx（设计稿 20px）
  - 内部 padding 56rpx(顶) / 52rpx(左右) / 52rpx(底)，对应设计稿各区域与弹窗边的间距
  - flex column 让头 / 详情 / 按钮按内容流式排列，摘要变长时按钮自动下移
*/
.insight-detail__popup {
  position: absolute;
  top: 476rpx;
  left: 50%;
  width: 624rpx;
  box-sizing: border-box;
  padding: 56rpx 52rpx 52rpx;
  border-radius: 40rpx;
  background: #ffffff;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
}

/* 11101:719 Frame 4：30×30 关闭 X @ popup 右上，right 20px / top 19px → rpx 40 / 38 */
.insight-detail__close {
  position: absolute;
  top: 38rpx;
  right: 40rpx;
  display: flex;
  width: 60rpx;
  height: 60rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.15s ease;
}

.insight-detail__close--active {
  background: #f0f0f0;
}

.insight-detail__close-icon {
  width: 60rpx;
  height: 60rpx;
}

/*
  头部：铃铛底圆 + 标题（deviceNo）
  11101:715 铃铛底圆 38×38 @ (24, 28) + 11101:716 标题 @ (74, 28)
  flex row，align-items: flex-start 让标题与铃铛顶部对齐（设计稿 y=28 一致）
  gap 24rpx = 设计稿 12px（标题 left 74 减去铃铛 right 62）
*/
.insight-detail__header {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 24rpx;
}

/* 11101:715 Ellipse 30：38×38 铃铛底圆 #F2F2F2 → rpx 76×76 */
.insight-detail__bell-bg {
  flex-shrink: 0;
  display: flex;
  width: 76rpx;
  height: 76rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #f2f2f2;
}

/* 11101:732 Vector：19×19 红铃铛 #C8201E 居中于底圆 → rpx 38×38 */
.insight-detail__bell-icon {
  width: 38rpx;
  height: 38rpx;
}

/*
  11101:716 标题（deviceNo）：Inter Medium 15px #000
  rpx：字号 30rpx，字重 500，行高 36rpx
*/
.insight-detail__title {
  flex: 1;
  padding-top: 4rpx;
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 36rpx;
  color: #000000;
  word-break: break-all;
}

/*
  11101:727 事件详情 label：Inter Regular 14px #999
  与头部间距 36rpx（设计稿 84-28-38=18px ≈ 36rpx）
  rpx：字号 28rpx，字重 400，行高 34rpx
*/
.insight-detail__section-label {
  margin-top: 36rpx;
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #999999;
}

/*
  11115:3 Frame 78：260×137 #F6F6F6 r8 pad14
  rpx：宽 520rpx，圆角 16rpx，内边距 28rpx
  高度由内容撑开（min-height 274rpx 兜底短文本时的设计稿高度）
*/
.insight-detail__box {
  margin-top: 24rpx;
  box-sizing: border-box;
  min-height: 274rpx;
  padding: 28rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

/* 11115:2 Frame 77：垂直栈，行间距 12px（24rpx） */
.insight-detail__rows {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

/* 单行条目：设计稿每行高 17px → rpx 34rpx */
.insight-detail__row {
  display: flex;
  flex-direction: column;
  min-height: 34rpx;
}

/*
  11101:726 / 11101:739 / 11101:740 正文：Inter Regular 14px #1A1A1A
  rpx：字号 28rpx，字重 400，行高 34rpx
*/
.insight-detail__row-text {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  color: #1a1a1a;
  word-break: break-all;
}

/* 「事件摘要：」独立成行，与设计稿 3 行（label 1 + 描述 2）一致 */
.insight-detail__row-prefix {
  display: block;
  margin-bottom: 0;
}

/* 摘要行：让 label + 描述在视觉上是一个块，描述自然换行 */
.insight-detail__row--summary .insight-detail__row-text + .insight-detail__row-text {
  display: block;
  margin-top: 0;
}

/*
  11101:723 / 11101:724 加急处理按钮：260×42 r21
  rpx：520×84，圆角 42rpx
  底/描边/文字颜色随加急态切换：
    - 未加急：底 #FFFFFF，描边/文字 #C8201E（设计稿 11101:724 stroke / 11101:725 文字原色）
    - 已加急：底 #F7F7F7，无描边，文字 #0D0D0D
  与详情框间距 32rpx（设计稿 266-113-137=16px = 32rpx）
  位于 flex column 底部，弹窗自然增高时跟着下移。
*/
.insight-detail__action {
  margin-top: 32rpx;
  display: flex;
  width: 100%;
  height: 84rpx;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 2rpx solid #c8201e;
  border-radius: 42rpx;
  background: #ffffff;
  transition: opacity 0.15s ease;
}

/* 已加急：底灰、去描边 */
.insight-detail__action--urgent {
  border: none;
  background: #f7f7f7;
}

.insight-detail__action--active {
  opacity: 0.85;
}

/* 11101:725 加急处理：Inter Medium 14px → rpx 28rpx / 500
   未加急 #C8201E；已加急由下方 --urgent 规则覆盖为 #0D0D0D */
.insight-detail__action-text {
  font-family:
    "PingFang SC",
    "Noto Sans SC",
    "Microsoft YaHei",
    -apple-system,
    sans-serif;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #c8201e;
  letter-spacing: 1rpx;
}

.insight-detail__action--urgent .insight-detail__action-text {
  color: #0d0d0d;
}
</style>

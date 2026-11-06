<script setup lang="ts">
import type { TaskExceptionCard, TaskExceptionRow } from "@/utils/task-exception";

import { computed } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 异常情况摘要卡片 —— Ardot 350:2151 里的节点 350:2199（Group 24 / Rectangle 56）。
 *
 * 版式（设计稿 375 画布，1px = 2rpx）：
 * - 卡片 335×124：白底、1px 描边 #C8201E、圆角 16px，设计稿的投影 visible=false 不还原；
 * - 内边距上/左右 16px（32rpx），下 21px（42rpx）—— 设计稿卡片高度固定 124，
 *   内容到 103 收尾，底部多出的 21 正好是这块留白；
 * - 标题「异常情况摘要」16px Medium #000000，行高 22px（44rpx）；
 * - 标题底 352 → 首行 357，间距 5px（10rpx）；
 * - 键值两列：标签列宽 70px（140rpx）、#8E8E8E；值列占满剩余（233px）、#0D0D0D；
 *   文案 14px / 行高 20px（28rpx / 40rpx），值多了自然折行、卡片变高。
 *
 * 只负责展示，数据（含 mock 兜底）由页面用 utils/task-exception 解析后传进来。
 */
defineOptions({ name: "AiTaskExceptionCard" });

const props = defineProps<{
  data: TaskExceptionCard;
  /** 深色模式：页面按 systemStore.isDark 透传 */
  dark?: boolean;
}>();

const { t, locale } = useI18n();

/**
 * 标题 / 行标签都要做中英文适配：
 * - 接口下发了原文（英文环境通常接口直接给英文）→ 用原文；
 * - 接口没给（本地兜底）→ 用 i18n key，跟随当前语言。
 * 之前标签写死中文，英文界面下就成了「English 值 + 异常对象：」这种混排。
 */
const title = computed(() => props.data.title || (props.data.titleKey ? t(props.data.titleKey) : ""));

function resolveLabel(row: TaskExceptionRow) {
  return row.label || (row.labelKey ? t(row.labelKey) : "");
}

/**
 * 标签列宽：设计稿按中文「异常对象：」标注 70px，英文标签（Exception object:）更宽，
 * 固定 70px 会折成两行，所以非中文时把标签列放宽到 110px。
 */
const labelColumnStyle = computed(() => (/^zh/i.test(String(locale.value)) ? {} : { width: "220rpx" }));
</script>

<template>
  <view class="te-card" :class="{ 'te-card--dark': dark }">
    <text class="te-card__title">
      {{ title }}
    </text>
    <view class="te-card__rows">
      <view
        v-for="(row, index) in data.rows"
        :key="row.labelKey || row.label || index"
        class="te-card__row"
      >
        <text class="te-card__label" :style="labelColumnStyle">
          {{ resolveLabel(row) }}
        </text>
        <text class="te-card__value">
          {{ row.value }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss">
.te-card {
  box-sizing: border-box;
  // 上 / 左右 16px；底部 21px（设计稿卡片固定 124px 高，内容到 103px 结束）
  padding: 32rpx 32rpx 42rpx;
  background: #ffffff;
  border: 1px solid #c8201e; // 设计稿 0.784 / 0.125 / 0.118
  border-radius: 32rpx; // 16px
}

.te-card__title {
  display: block;
  color: #000000;
  font-family: "PingFang SC";
  font-size: 32rpx; // 16
  font-weight: 500; // Medium
  line-height: 44rpx; // 22
}

// 标题底（352）→ 首行顶（357）：5px
.te-card__rows {
  margin-top: 10rpx;
}

.te-card__row {
  display: flex;
  align-items: flex-start;
}

// 标签列 70px，值列 = 335 − 16×2 − 70 = 233px，占满剩余宽度
.te-card__label {
  flex: none;
  width: 140rpx;
  color: #8e8e8e;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 40rpx; // 20
}

.te-card__value {
  flex: 1;
  min-width: 0;
  color: #0d0d0d;
  font-family: "PingFang SC";
  font-size: 28rpx; // 14
  font-weight: 400;
  line-height: 40rpx; // 20
  word-break: break-word;
}

/* ===== 深色主题：与气泡回复卡同一套材质（底 #212121 / 描边 #303030）；
   标题 #FFFFFF、标签 #5D5D5D、值 80% 白。尺寸 / 间距 / 字号不动 ===== */
.te-card--dark {
  background: #212121;

  .te-card__title {
    color: #ffffff;
  }

  .te-card__label {
    color: #5d5d5d;
  }

  .te-card__value {
    color: rgba(255, 255, 255, 0.8);
  }
}
</style>

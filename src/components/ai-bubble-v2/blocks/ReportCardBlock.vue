<script setup lang="ts">
import type { Ref } from "vue";
import { computed, inject, unref } from "vue";
import AiReportEntryCard from "@/components/ai-report-entry-card/index.vue";

/**
 * 听汇报入口卡（block type=report-card）—— Ardot 479:384，父画板 479:152。
 *
 * 由 useChatSend 在命中 `<WORK_REPORT date language>` 标签后追加：
 * 以前这里直接跳播报页，现在改成在气泡里补一张卡，用户点卡片才跳
 * （跳转逻辑在卡片内，见 utils/listen-report 的 openListenReportPage）。
 *
 * payload：{ date: 播报业务日期, language: 播报语言 }
 */
defineOptions({ name: "ReportCardBlock" });

const props = defineProps({
  payload: {
    type: Object as () => { date?: string; language?: string } | null,
    default: () => ({}),
  },
  /** 深色：独立于气泡渲染时由外部显式传，气泡内跟随 ai-bubble-dark */
  dark: { type: Boolean, default: false },
});

/** 气泡内渲染时跟随 ai-bubble-dark（与 GanttBlock / TableBlock 同一套） */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => props.dark || Boolean(bubbleDark ? unref(bubbleDark) : false));

const date = computed(() => String(props.payload?.date || ""));
const language = computed(() => String(props.payload?.language || ""));
</script>

<template>
  <!-- 设计稿 479:160 正文底(254) → 479:384 卡片顶(269) 15px；
       气泡 __body 的行间距是 10rpx(5px)，这里补 20rpx(10px) 补足 15px -->
  <view class="report-card-block">
    <AiReportEntryCard :date="date" :language="language" :dark="isDark" />
  </view>
</template>

<style lang="scss" scoped>
.report-card-block {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  /* 与上一段正文的 15px 设计间距：减去 __body 行间距 10rpx */
  padding-top: 20rpx;
}
</style>

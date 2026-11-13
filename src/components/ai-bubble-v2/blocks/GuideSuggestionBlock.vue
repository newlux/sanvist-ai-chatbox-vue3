<script setup lang="ts">
import type { Ref } from "vue";
import type { GuideSuggestionPayload } from "@/api/chat/types";
import { computed, inject, unref } from "vue";
import { stripOptionPrefix } from "@/utils/option-label";

/**
 * 多轮追问卡（COMPONENT scene=guide / type=suggestion）。
 *
 * 设计稿：不再弹底部白板，`note` / `suggestion_question` / `options` 全部就地渲染在对话里，
 * 点一条选项就当作用户提问发出去——与开场引导卡（guide-lead）、步骤卡（guide-check）
 * 同一套交互与样式（A/B/C 字母 + 胶囊）。
 * 与步骤卡的区别只在语义：options 是**并行分支**，没有 i/n 进度与确认/拍照。
 */
defineOptions({ name: "GuideSuggestionBlock" });

const props = defineProps({
  payload: { type: Object as () => GuideSuggestionPayload, required: true },
  /**
   * 深色：气泡内由 ai-bubble-dark inject 跟随主题；气泡外独立渲染（步骤完成态底部的
   * 推荐问题）拿不到 provide 时由外层显式传下来。两者任一为真即走深色稿。
   */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  /** 点某个选项：文案原样上抛，由页面当成下一轮提问发出去 */
  (e: "pick", text: string): void;
}>();
/** 气泡内渲染时跟随 ai-bubble-dark（与 GuideStepBlock / GuideLeadBlock 同一套取法） */
const bubbleDark = inject<Ref<boolean> | null>("ai-bubble-dark", null);
const isDark = computed(() => props.dark || Boolean(bubbleDark ? unref(bubbleDark) : false));

/** 顶部提示语，如「请先确认机型；未选择角色时，我会按新手模式回答。」 */
const note = computed(() => String(props.payload?.note || "").trim());
/** 问题行，如「你需要了解哪个机型？」 */
const question = computed(() => String(props.payload?.question || "").trim());
/** 选项：文案剥掉后端可能自带的「A |」序号，避免和前面渲染的字母重复 */
const options = computed(() => (Array.isArray(props.payload?.options) ? props.payload.options : [])
  .map(item => ({
    id: String(item?.id || "").trim(),
    label: stripOptionPrefix(item?.label),
  }))
  .filter(item => item.label));

/** 选项序号：A / B / C… */
function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function onPick(label: string) {
  if (!label) return;
  emit("pick", label);
}
</script>

<template>
  <view v-if="note || question || options.length" class="guide-suggestion" :class="{ 'guide-suggestion--dark': isDark }">
    <text v-if="note" class="guide-suggestion__note">
      {{ note }}
    </text>
    <text v-if="question" class="guide-suggestion__question">
      {{ question }}
    </text>

    <view v-if="options.length" class="guide-suggestion__options">
      <view
        v-for="(item, index) in options"
        :key="item.id || item.label"
        class="guide-suggestion__option"
        @tap.stop="onPick(item.label)"
      >
        <text class="guide-suggestion__option-letter">
          {{ optionLetter(index) }}
        </text>
        <view class="guide-suggestion__option-divider" />
        <text class="guide-suggestion__option-label">
          {{ item.label }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 与步骤卡一致：不画白框，直接铺在对话背景上 */
.guide-suggestion {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  margin-top: 8rpx;
}

/* 顶部提示语：弱化一级的说明文字 */
.guide-suggestion__note {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 42rpx;
  color: #8c8c8c;
}

/* 问题行：「你需要了解哪个机型？」 */
.guide-suggestion__question {
  display: block;
  margin-top: 16rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 48rpx;
  color: #1a1a1a;
}

/* 选项组：纵向排列、左对齐，胶囊按内容宽度收缩 */
.guide-suggestion__options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 24rpx;
}

.guide-suggestion__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 999rpx; /* 真胶囊：左右两端半圆，不再用 32rpx 的圆角矩形 */
  background: #ffffff;
}

/* 段间距用 margin 而不是 flex gap：低端安卓 WebView 的 flex gap 支持不稳 */
.guide-suggestion__option + .guide-suggestion__option {
  margin-top: 20rpx;
}

.guide-suggestion__option:active {
  opacity: 0.7;
}

.guide-suggestion__option-letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* 字母与文案之间的细分隔线（设计稿里的「A｜」） */
.guide-suggestion__option-divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.guide-suggestion__option-label {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* ===== 深色：与步骤卡 / 气泡内其它块同一套材质（正文 #E5E5E5、次要 45% 白、块底 6% 白） ===== */
.guide-suggestion--dark {
  .guide-suggestion__note {
    color: rgba(255, 255, 255, 0.45);
  }

  .guide-suggestion__question {
    color: #e5e5e5;
  }

  /* 胶囊描边走 1px 内描边线性渐变 #5A5A5A → #F7F7F7 → #5A5A5A：
     原生 border 只能单色，这里把 border 留作占位（透明），再用「渐变底 + mask 挖掉内容区」画 1px 环 */
  .guide-suggestion__option {
    position: relative;
    border-color: transparent;
    background: rgba(255, 255, 255, 0.06);
  }

  .guide-suggestion__option::before {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 1px;
    border-radius: 999rpx; /* 与胶囊半圆端一致 */
    background: linear-gradient(135deg, #5a5a5a 0%, #f7f7f7 50%, #5a5a5a 100%);
    content: "";
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }

  .guide-suggestion__option-letter,
  .guide-suggestion__option-label {
    color: #e5e5e5;
  }

  .guide-suggestion__option-divider {
    background: rgba(255, 255, 255, 0.2);
  }
}
</style>

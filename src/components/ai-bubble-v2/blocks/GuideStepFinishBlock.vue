<script setup lang="ts">
/**
 * @deprecated 步骤小结已并入 GuideCheckBlock：整段步骤确认完后，小结直接渲染在最后一张
 * 核对卡的确认区位置（payload.summary），不再用它独立成卡。文件保留待确认全仓无引用后软删。
 */
import type { GuideSuggestionPayload } from "@/api/chat/types";
import { computed, onMounted, provide } from "vue";
import iconRadioOn from "@/assets/img/icon-action-radio-on.svg";
import saniIcon from "@/assets/img/icon-sani.png";
import MarkdownRenderer from "@/components/markdown-renderer/index.vue";
import { consumeSummaryTts } from "@/utils/guide-step-tts";
import { stripOptionPrefix } from "@/utils/option-label";
import GuideSourceBlock from "./GuideSourceBlock.vue";

/**
 * 深色：小结卡同样由消息列表在气泡外独立渲染，provide 给 MarkdownRenderer
 * 让它排出深色正文（与 GuideCheckBlock 同一套处理）。
 */
provide("ai-bubble-dark", computed(() => props.dark));

/**
 * 指导步骤的完成态（独立于步骤卡）：
 * 整段步骤全部确认完后，展示 `step_summary`（步骤小结）+ 同一条回答里的推荐问题
 * （COMPONENT scene=guide / type=suggestion）。点推荐问题一条就当作下一轮提问发出去。
 *
 * 小结不渲染在步骤卡片内部——由消息列表在步骤卡让位后单独渲染这一块。
 */
defineOptions({ name: "GuideStepFinishBlock" });

const props = defineProps({
  /** 步骤小结（步骤卡顶层字段 step_summary，与 steps 分离） */
  summary: { type: String, default: "" },
  /** 推荐问题：同一条回答里的 guide-suggestion 块 */
  suggestions: { type: Object as () => GuideSuggestionPayload | null, default: null },
  /** 参考来源：步骤卡让位后来源不能丢，由消息列表从同一条回答的 source 块注入 */
  sources: { type: Array as () => unknown[], default: () => [] },
  /** 这一轮是否支持语音播报：由消息的 ttsEnabled 决定，不支持时不画播报按钮 */
  ttsEnabled: { type: Boolean, default: false },
  ttsLoading: { type: Boolean, default: false },
  ttsPlaying: { type: Boolean, default: false },
  /**
   * 深色：这张卡由消息列表在气泡外独立渲染，拿不到气泡 provide 的 ai-bubble-dark，
   * 需要外层显式传下来（与步骤卡 / GanttBlock 的 dark 同一套）。
   */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "pick", text: string): void;
  (e: "tts-click"): void;
}>();

const summary = computed(() => String(props.summary || "").trim());
const suggestionQuestion = computed(() => String(props.suggestions?.question || "").trim());
const suggestionOptions = computed(() => (Array.isArray(props.suggestions?.options)
  ? props.suggestions?.options || []
  : [])
  // 文案剥掉后端可能自带的「A |」序号，避免和前面渲染的字母重复
  .map(item => ({ id: String(item?.id || "").trim(), label: stripOptionPrefix(item?.label) }))
  .filter(item => item.label));

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function onPick(label: string) {
  if (!label) return;
  emit("pick", label);
}

/** 播报小结：文本由消息列表从 guide-step 的 step_summary 取出后随事件带上，页面直接念它 */
function onTtsTap() {
  if (!props.ttsEnabled) return;
  emit("tts-click");
}

/**
 * 刚确认完最后一步：小结卡是紧接着最后一张步骤卡挂载的，
 * 认领到标记就把小结念出来（旧语音已由消息列表在切换瞬间停掉）。
 */
onMounted(() => {
  if (!consumeSummaryTts()) return;
  if (!props.ttsEnabled) return;
  emit("tts-click");
});
</script>

<template>
  <view
    v-if="summary || suggestionOptions.length || sources.length"
    class="guide-finish"
    :class="{ 'guide-finish--dark': dark }"
  >
    <!-- 左上角品牌署名：与步骤卡保持同一套观感（sani logo + SANI + 播报按钮） -->
    <view class="guide-finish__brand">
      <image class="guide-finish__brand-icon" :src="saniIcon" mode="aspectFit" />
      <text class="guide-finish__brand-text">
        SANI
      </text>
      <view
        v-if="ttsEnabled"
        class="guide-finish__tts-btn"
        @tap.stop="onTtsTap"
      >
        <view v-if="ttsLoading" class="guide-finish__tts-spinner" />
        <view v-else-if="ttsPlaying" class="guide-finish__tts-wave">
          <view
            v-for="index in 4"
            :key="index"
            class="guide-finish__tts-wave-bar"
            :class="`guide-finish__tts-wave-bar--${index}`"
          />
        </view>
        <image v-else :src="iconRadioOn" mode="aspectFit" class="guide-finish__tts-icon" />
      </view>
    </view>

    <!-- 步骤小结（step_summary，可能带 ** 加粗等 markdown）：与步骤正文同一套
         MarkdownRenderer 解析渲染，深色由上面 provide 的 ai-bubble-dark 接管 -->
    <view v-if="summary" class="guide-finish__summary">
      <MarkdownRenderer :content="summary" />
    </view>

    <template v-if="suggestionOptions.length">
      <text class="guide-finish__question">
        {{ suggestionQuestion || "你还可以继续问" }}
      </text>
      <view class="guide-finish__options">
        <view
          v-for="(item, index) in suggestionOptions"
          :key="item.id || item.label"
          class="guide-finish__option"
          @tap.stop="onPick(item.label)"
        >
          <text class="guide-finish__option-letter">
            {{ optionLetter(index) }}
          </text>
          <view class="guide-finish__option-divider" />
          <text class="guide-finish__option-label">
            {{ item.label }}
          </text>
        </view>
      </view>
    </template>

    <!-- 参考来源：与步骤卡同款，卡片让位后来源仍可查 -->
    <GuideSourceBlock
      v-if="sources.length"
      class="guide-finish__sources"
      :dark="dark"
      :payload="{ evidence: sources }"
    />
  </view>
</template>

<style lang="scss" scoped>
/* 与步骤卡 / 追问卡一致：无白框，直接铺在对话背景上 */
.guide-finish {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
}

/* 左上角品牌署名：与步骤卡的同名样式一致（52rpx logo + 26rpx 文案 + 20rpx 下间距） */
.guide-finish__brand {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.guide-finish__brand-icon {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
}

.guide-finish__brand-text {
  margin-left: 12rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 36rpx;
  color: #1a1a1a;
}

/* 播报按钮：与步骤卡左上角同一套观感（加载转圈 / 播放声波 / 静态图标） */
.guide-finish__tts-btn {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  margin-left: 12rpx;
}

.guide-finish__tts-icon {
  width: 32rpx;
  height: 32rpx;
}

.guide-finish__tts-spinner {
  box-sizing: border-box;
  width: 24rpx;
  height: 24rpx;
  border: 3rpx solid rgba(136, 136, 136, 0.22);
  border-top-color: #888888;
  border-radius: 50%;
  animation: guide-finish-tts-spin 0.8s linear infinite;
}

.guide-finish__tts-wave {
  display: flex;
  width: 32rpx;
  height: 32rpx;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.guide-finish__tts-wave-bar {
  width: 4rpx;
  height: 24rpx;
  border-radius: 4rpx;
  background: #1a6dff;
  transform-origin: center center;
  animation: guide-finish-tts-wave 0.9s ease-in-out infinite;
}

.guide-finish__tts-wave-bar--1 { animation-delay: 0s; }
.guide-finish__tts-wave-bar--2 { animation-delay: 0.12s; }
.guide-finish__tts-wave-bar--3 { animation-delay: 0.24s; }
.guide-finish__tts-wave-bar--4 { animation-delay: 0.36s; }

@keyframes guide-finish-tts-spin {
  to { transform: rotate(360deg); }
}

@keyframes guide-finish-tts-wave {
  0%,
  100% {
    transform: scaleY(0.35);
    opacity: 0.6;
  }

  50% {
    transform: scaleY(1);
    opacity: 1;
  }
}

/* 步骤小结容器：只留白边距与字色，文字排版交给 MarkdownRenderer */
.guide-finish__summary {
  display: block;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  color: #1a1a1a;
}

/*
 * markdown-renderer 通过 mp-html 把 tagStyle 写进行内样式，scoped 样式压不住；
 * 这里用 :deep + !important 对齐小结原有排版（30rpx / 52rpx），
 * 与 GuideCheckBlock 的步骤正文同一套处理。
 */
.guide-finish__summary :deep(p),
.guide-finish__summary :deep(li) {
  margin-bottom: 0 !important;
  color: #1a1a1a !important;
  font-size: 30rpx !important;
  font-weight: 400;
  line-height: 52rpx !important;
  word-break: break-word;
}
.guide-finish__summary :deep(strong) {
  color: #1a1a1a;
  font-weight: 600;
}

.guide-finish__question {
  display: block;
  margin-top: 32rpx;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 30rpx;
  font-weight: 500;
  line-height: 48rpx;
  color: #1a1a1a;
}

.guide-finish__sources {
  margin-top: 32rpx;
}

.guide-finish__options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 24rpx;
}

.guide-finish__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 32rpx;
  background: #ffffff;
}

.guide-finish__option + .guide-finish__option {
  margin-top: 20rpx;
}

.guide-finish__option:active {
  opacity: 0.7;
}

.guide-finish__option-letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

.guide-finish__option-divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.guide-finish__option-label {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* ===== 深色：与步骤卡 / 气泡内其它块同一套材质 ===== */
.guide-finish--dark {
  .guide-finish__brand-text {
    color: #fff;
  }

  .guide-finish__summary,
  .guide-finish__question {
    color: #fff;
  }

  /* 深色小结：step_summary 走 MarkdownRenderer，浅色覆盖会压过 tagStyle 的深色，
     这里再按白色材质对齐（正文 / 加粗都用 #e5e5e5），与步骤正文同一套 */
  .guide-finish__summary :deep(p),
  .guide-finish__summary :deep(li),
  .guide-finish__summary :deep(strong) {
    color: #fff !important;
  }

  .guide-finish__option {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
  }

  .guide-finish__option-letter,
  .guide-finish__option-label {
    color: #fff;
  }

  .guide-finish__option-divider {
    background: rgba(255, 255, 255, 0.2);
  }

  .guide-finish__tts-spinner {
    border-color: rgba(255, 255, 255, 0.22);
    border-top-color: rgba(255, 255, 255, 0.72);
  }

  .guide-finish__tts-wave-bar {
    background: #4c8dff;
  }
}
</style>

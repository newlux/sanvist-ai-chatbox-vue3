<script setup lang="ts">
import type { GuideSuggestionPayload } from "@/api/chat/types";
import { computed, nextTick, ref, watch } from "vue";
import closeIcon from "@/assets/img/icon-close.svg";

/**
 * 多轮追问卡（COMPONENT scene=guide / type=suggestion）。
 *
 * 字段取值：
 * - 左上灰色小标签 ← data.items[].note
 * - 问题行 ← data.items[].suggestion_question
 * - 选项卡 ← data.items[].options[].label
 * - 末尾输入框的 placeholder ← data.items[].other_text（为空则不展示），右侧带「发送」图标
 *   （与原生输入栏 input-bar 同款 icon-send.svg，与键盘回车等效，输入为空时置灰）
 *
 * 与步骤卡的区别：options 是**并行分支**，点哪一项就把那一项作为下一轮提问发出去；
 * 没有 i/n 进度，也没有「确认 / 拍照」这类步骤语义。
 * 视觉：白板贴底 + 向上阴影 + 灰色小标签 + 右上 ×，选项卡行默认 #f6f6f6。
 */
defineOptions({ name: "AiGuideSuggestionSheet" });

const props = withDefaults(defineProps<{
  payload?: GuideSuggestionPayload | null;
  visible?: boolean;
  /** 键盘高度（px）：末尾输入框聚焦时把卡片顶上去，别被键盘盖住 */
  keyboardHeight?: number;
}>(), {
  payload: null,
  visible: false,
  keyboardHeight: 0,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  /** 选中某个选项 / 输入自填内容：页面按普通提问发出去 */
  (e: "submit", query: string): void;
  /** 卡片实际高度（px）：页面拿它给消息列表留底部间距，最后一条回答不会被卡片盖住 */
  (e: "height-change", value: number): void;
}>();

/** 末尾输入框：用户自己写的入口 */
const draftText = ref("");

const options = computed(() => (Array.isArray(props.payload?.options) ? props.payload.options : []));
/** 灰色小标签取 note，老数据没有时用默认文案 */
const cardLabel = computed(() => String(props.payload?.note || "").trim() || "请选择");
const question = computed(() => String(props.payload?.question || "").trim());
/** 末尾输入框的 placeholder */
const otherText = computed(() => String(props.payload?.other_text || "").trim());
/** 输入框有内容，「发送」按钮才是可用态 */
const canSubmitText = computed(() => Boolean(draftText.value.trim()));

function submitQuery(query: string) {
  if (!query) return;
  emit("submit", query);
  emit("update:visible", false);
}

/** 选项卡：点哪一项就把那一项作为下一轮提问发出去 */
function onOptionTap(label: string) {
  submitQuery(label);
}

/** 末尾输入框：回车发送，内容原样发出去 */
function onSubmitText() {
  const text = draftText.value.trim();
  if (!text) return;
  draftText.value = "";
  submitQuery(text);
}

function close() {
  emit("update:visible", false);
}

/**
 * 卡片高度会随问题文案变化，显隐后重新量一次交给页面。
 * 收起时回 0，页面据此撤掉底部间距。
 */
async function measureHeight() {
  if (!props.visible) {
    emit("height-change", 0);
    return;
  }
  await nextTick();
  uni.createSelectorQuery()
    .select(".guide-suggestion-sheet")
    .boundingClientRect((rect) => {
      const measured = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      emit("height-change", Number(measured) || 0);
    })
    .exec();
}

watch(() => props.visible, () => {
  // 收起或重开都不该留着上一次的输入内容
  draftText.value = "";
  void measureHeight();
});
</script>

<template>
  <view
    v-if="visible && options.length"
    class="guide-suggestion-sheet"
    :style="keyboardHeight > 0 ? { bottom: `${keyboardHeight}px` } : undefined"
  >
    <view class="guide-suggestion-sheet__header">
      <view class="guide-suggestion-sheet__labels">
        <text class="guide-suggestion-sheet__label">
          {{ cardLabel }}
        </text>
      </view>
      <view class="guide-suggestion-sheet__close" @tap="close">
        <image class="guide-suggestion-sheet__close-icon" :src="closeIcon" mode="aspectFit" />
      </view>
    </view>

    <text v-if="question" class="guide-suggestion-sheet__question">
      {{ question }}
    </text>

    <view class="guide-suggestion-sheet__options">
      <!-- 选项卡：并行分支，点一个就发出去 -->
      <view
        v-for="option in options"
        :key="option.id || option.label"
        class="guide-suggestion-sheet__option"
        @tap="onOptionTap(option.label)"
      >
        <text class="guide-suggestion-sheet__option-label">
          {{ option.label }}
        </text>
      </view>

      <!-- 其他入口：placeholder 取 other_text；右侧「发送」图标与键盘回车等效 -->
      <view v-if="otherText" class="guide-suggestion-sheet__input-row">
        <input
          v-model="draftText"
          class="guide-suggestion-sheet__input"
          type="text"
          :placeholder="otherText"
          placeholder-style="color:#999999;"
          confirm-type="send"
          :confirm-hold="true"
          @confirm="onSubmitText"
        />
        <!-- touchstart 先拦一次（输入框聚焦时首点不会被键盘收起吞掉），tap 兜住桌面浏览器鼠标点：
             第一个事件发出后输入内容已清空，第二个事件会直接 return，不会重复发送 -->
        <view
          class="guide-suggestion-sheet__send"
          :class="{ 'guide-suggestion-sheet__send--disabled': !canSubmitText }"
          @touchstart.stop.prevent="onSubmitText"
          @tap="onSubmitText"
        >
          <image class="guide-suggestion-sheet__send-icon" src="@/assets/img/icon-send.svg" mode="aspectFit" />
        </view>
      </view>
    </view>

    <text class="guide-suggestion-sheet__hint">
      内容由AI生成，请核实重要信息
    </text>
  </view>
</template>

<style lang="scss" scoped>
/* 直角白板贴底，只留向上阴影；safe-area 留给底部 home indicator */
.guide-suggestion-sheet {
  position: fixed;
  z-index: 1002;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 22px 22px 0 0;
  box-sizing: border-box;
  padding: 42rpx 80rpx 24rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
}

.guide-suggestion-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36rpx;
}

.guide-suggestion-sheet__labels {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
}

.guide-suggestion-sheet__label {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 36rpx;
  color: #666666;
}

.guide-suggestion-sheet__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 48rpx;
  height: 36rpx;
  margin-right: -12rpx;
}

.guide-suggestion-sheet__close-icon {
  width: 36rpx;
  height: 36rpx;
}

/* 问题行：data.items[].suggestion_question */
.guide-suggestion-sheet__question {
  display: block;
  margin-top: 32rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1e;
}

.guide-suggestion-sheet__options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 32rpx;
}

/* 选项卡：与步骤卡选项行同款，但语义是并行分支 */
.guide-suggestion-sheet__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 16rpx 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.guide-suggestion-sheet__option-label {
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #000000;
}

/* 末尾输入行：整个容器就是输入框（与上方选项卡同宽同款：#f6f6f6 / 16rpx 圆角 / 72rpx 高），
   发送图标包在框内右侧，左内边距与选项卡文字对齐 */
.guide-suggestion-sheet__input-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  box-sizing: border-box;
  min-height: 72rpx;
  padding: 0 16rpx 0 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

/* 末尾输入框：只负责输入，外观由外层容器给，placeholder 取 other_text */
.guide-suggestion-sheet__input {
  display: block;
  flex: 1 1 auto;
  box-sizing: border-box;
  min-width: 0;
  padding: 0;
  background: transparent;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #000000;
}

/* 发送图标：与原生输入栏 input-bar__send 同款（icon-send.svg，图标自带底色，不再加按钮底色） */
.guide-suggestion-sheet__send {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 56rpx;
  height: 56rpx;
}

.guide-suggestion-sheet__send:active {
  opacity: 0.7;
}

/* 未输入内容：图标置灰（点了也不会发），位置保留避免输入框宽窄跳动 */
.guide-suggestion-sheet__send--disabled {
  opacity: 0.4;
}

.guide-suggestion-sheet__send-icon {
  width: 56rpx;
  height: 56rpx;
}

.guide-suggestion-sheet__hint {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
  color: #bababa;
}
</style>

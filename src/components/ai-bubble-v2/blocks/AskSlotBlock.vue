<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload, AskSlotSubmitPayload } from "@/api/chat/types";
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { stripOptionPrefix } from "@/utils/option-label";

/**
 * 追问卡（scene=ask / type=slot）。
 *
 * 两种形态：
 * 1. 选择题（如「请选择要查询的项目（可多选）」）：
 *    直接内联排在回答正文下方 —— 问题行 + 选项胶囊 + （多选时）其他输入，不弹底部抽屉、也没有确认按钮。
 *    单选 / 多选**行为一致**：点中哪一项就立刻把那一项当一次提问发出去；
 *    其他输入填完按键盘「发送」提交。选项不再回显 default_value，不会一进来就有一项是选中的。
 * 2. 多步骤表单（作业协同，payload 带 slots / input_type）：气泡里排不下分页与输入框，仍交由页面弹抽屉。
 */
const props = defineProps({
  payload: {
    type: Object as () => AskSlotPayload,
    required: true,
  },
  /** 生成中：置灰不可点，避免一轮里连点重复提问 */
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  open: [slot: AskSlotPayload];
  pick: [payload: { slot: AskSlotPayload; option: AskSlotOption }];
  /** 多选确认提交：与底部抽屉 submit 同一份 payload，页面据此拼提问 */
  submit: [payload: AskSlotSubmitPayload];
}>();

const { t } = useI18n();

/** 深色：跟随 AI 气泡主题（与 GuideSuggestionBlock / TableBlock 同一套取法） */
const darkContainer = inject("ai-bubble-dark", computed(() => false));
const isDark = computed(() => Boolean(darkContainer?.value));

/**
 * 选项：文案先剥掉后端可能自带的「A |」序号。
 * 这里拼的是「字母 + 竖线 + 文案」，服务端再塞一个序号就会变成「A ｜ A | 老板」，
 * 用户选中后发出去的提问也会带着这个前缀，所以显示与回发统一用剥过的文案。
 */
const options = computed(() => (props.payload.options || []).map(option => ({
  ...option,
  label: stripOptionPrefix(option.label),
})));

/**
 * 选择题才内联；多步骤表单（带 slots / input_type）继续走抽屉。
 * 多选也内联 —— 选项行本身就能点，确认按钮排在下方即可，没必要再弹一层底部白板。
 */
const inline = computed(
  () =>
    options.value.length > 0
    && (!props.payload.input_type || props.payload.input_type === "choice")
    && !(Array.isArray(props.payload.slots) && props.payload.slots.length > 0),
);

const isMultiple = computed(() => props.payload.selection === "multiple");

/** 问题行：优先 title，退化成 original_query（服务端两种都会带） */
const title = computed(() => String(props.payload.title || props.payload.original_query || "").trim());

function optionKey(option: AskSlotOption) {
  return String(option.value);
}

/** 选项序号：A / B / C…（与身份选择那组胶囊同一套写法） */
function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

/** 「其他输入」填的内容 */
const remark = ref("");
const remarkEditing = ref(false);
/** 已经提交过：锁住卡片，避免重复发同一问 */
const submitted = ref(false);

const hasRemark = computed(() => Boolean(remark.value.trim()));
const otherInputPlaceholder = computed(
  () => String(props.payload.other_text || props.payload.other_placeholder || "").trim() || t("slot-other-input"),
);

onMounted(() => {
  // 非内联形态保持原行为：auto_open 时把 payload 抛给页面开抽屉
  if (!inline.value && props.payload.auto_open) emit("open", props.payload);
});

/**
 * 选项点击：**单选 / 多选一致** —— 点中哪一项就立刻把那一项当一次提问发出去。
 *
 * 卡片已经去掉了「确认提交」，多选也不再累加勾选：没有提交按钮的累加根本没有出口，
 * 用户点一下就该有反应。也不再回显 `default_value`，避免一进来第一项就像被选过。
 */
function onOptionTap(option: AskSlotOption) {
  if (props.disabled || submitted.value) return;
  emit("pick", { slot: props.payload, option });
}

function openRemarkInput() {
  if (props.disabled || submitted.value) return;
  remarkEditing.value = true;
}

function closeRemarkInput() {
  remarkEditing.value = false;
}

/** 「其他输入」：填完按键盘上的「发送」即提交（卡片没有确认按钮了） */
function submitRemark() {
  const text = remark.value.trim();
  if (!text || props.disabled || submitted.value) return;
  submitted.value = true;
  remarkEditing.value = false;
  emit("submit", { slot: props.payload, selectedOptions: [], remark: text });
}
</script>

<template>
  <view v-if="inline" class="ask-slot" :class="{ 'ask-slot--dark': isDark }">
    <text v-if="title" class="ask-slot__title">
      {{ title }}
    </text>
    <view class="ask-slot__options">
      <view
        v-for="(option, index) in options"
        :key="optionKey(option)"
        class="ask-slot__option"
        :class="{ 'ask-slot__option--disabled': props.disabled || submitted }"
        @tap.stop="onOptionTap(option)"
      >
        <!-- 与身份选择那组胶囊保持一致：A｜选项文案 -->
        <text class="ask-slot__option-letter">
          {{ optionLetter(index) }}
        </text>
        <view class="ask-slot__option-divider" />
        <text class="ask-slot__option-text">
          {{ option.label }}
        </text>
      </view>

      <!-- 其他输入：与选项同一套胶囊，填完按键盘「发送」提交 -->
      <view
        v-if="isMultiple"
        class="ask-slot__option ask-slot__option--remark"
        :class="{ 'ask-slot__option--disabled': props.disabled || submitted }"
        @tap.stop="openRemarkInput"
      >
        <textarea
          v-if="remarkEditing"
          v-model="remark"
          class="ask-slot__remark-input"
          :focus="remarkEditing"
          confirm-type="send"
          :placeholder="otherInputPlaceholder"
          placeholder-class="ask-slot__remark-placeholder"
          :maxlength="200"
          :auto-height="true"
          @confirm="submitRemark"
          @blur="closeRemarkInput"
        />
        <text
          v-else
          class="ask-slot__option-text"
          :class="hasRemark ? 'ask-slot__remark-filled' : 'ask-slot__remark-placeholder-text'"
        >
          {{ hasRemark ? remark : otherInputPlaceholder }}
        </text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ===== 追问卡（内联形态）=====
   问题行 14px / Medium；选项与「身份选择」那组胶囊（GuideSuggestionBlock）同一套材质：
   白底 + 1px #E6E6E6 描边 + 全圆角胶囊（999rpx），左侧 A｜文案，纵向排列、左对齐、间距 10px。
   单选 / 多选用同一套胶囊，不再有整行铺满的变体 */
.ask-slot {
  display: flex;
  flex-direction: column;
  gap: 16rpx; /* 8px：问题行与选项组 */
  width: 100%;
}

.ask-slot__title {
  font-size: 28rpx; /* 14px */
  font-weight: 500;
  line-height: 40rpx; /* 20px */
  color: #0d0d0d;
}

.ask-slot__options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20rpx; /* 10px：选项之间 */
}

.ask-slot__option {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 999rpx; /* 真胶囊：左右两端半圆，不再用 32rpx 的圆角矩形 */
  background: #ffffff;
}

/* 按下反馈与 GuideSuggestionBlock 一致 */
.ask-slot__option:active {
  opacity: 0.7;
}

/* 序号：A / B / C… 与 GuideSuggestionBlock 逐项对齐 */
.ask-slot__option-letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* 字母与文案之间的细分隔线（设计稿里的「A｜」） */
.ask-slot__option-divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.ask-slot__option-text {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx; /* 14px */
  font-weight: 400;
  line-height: 40rpx; /* 20px */
  color: #1a1a1a;
}

/**
 * 生成中 / 已提交：只锁点击，不再整体压暗。
 *
 * 内联卡片是在流式回答里冒出来的，出现的那一刻 `loading` 还是 true，
 * 压暗后要先灰一截、等本轮回答结束才变回白底，看着像「先灰后白」的过渡动画。
 * 按钮就该一出现就是最终配色，所以这里只保留 pointer-events: none。
 */
.ask-slot__option--disabled {
  pointer-events: none;
}

/* 其他输入：未填写为灰字占位，填了用正文色 */
.ask-slot__remark-placeholder-text {
  color: #666666;
}

.ask-slot__remark-filled {
  color: #0d0d0d;
}

.ask-slot__remark-input {
  flex: 1 1 auto;
  width: 100%;
  min-height: 40rpx;
  color: #000000;
  font-size: 28rpx;
  line-height: 40rpx;
}

.ask-slot__remark-placeholder {
  color: #666666;
  font-size: 28rpx;
}

/* ===== 深色：与身份选择胶囊（GuideSuggestionBlock）同一套材质 ===== */
.ask-slot--dark {
  .ask-slot__title {
    color: #e5e5e5;
  }

  /* 描边走 1px 内描边线性渐变 #5A5A5A → #F7F7F7 → #5A5A5A：
     原生 border 只能单色，这里把 border 留作占位（透明），再用「渐变底 + mask 挖掉内容区」画 1px 环 */
  .ask-slot__option {
    position: relative;
    border-color: transparent;
    background: rgba(255, 255, 255, 0.06);
  }

  .ask-slot__option::before {
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

  .ask-slot__option-letter,
  .ask-slot__option-text {
    color: #e5e5e5;
  }

  .ask-slot__option-divider {
    background: rgba(255, 255, 255, 0.2);
  }

  /* 「其他输入」：占位走 45% 白，已填写走正文色 */
  .ask-slot__remark-placeholder-text {
    color: rgba(255, 255, 255, 0.45);
  }

  .ask-slot__remark-filled,
  .ask-slot__remark-input {
    color: #e5e5e5;
  }

  .ask-slot__remark-placeholder {
    color: rgba(255, 255, 255, 0.45);
  }
}
</style>

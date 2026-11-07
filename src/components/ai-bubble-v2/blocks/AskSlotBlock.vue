<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload } from "@/api/chat/types";
import { computed, onMounted } from "vue";

/**
 * 追问卡（scene=ask / type=slot）。
 *
 * 两种形态：
 * 1. 单题选择题（截图里的「请告诉我，您想体验哪个身份？」）：直接内联排在回答正文下方，
 *    问题行 + 选项胶囊，点一下就用该选项再问一次，不再弹底部抽屉。
 * 2. 多选 / 填空题 / 多步骤表单：气泡里排不下分页与输入框，仍交由页面弹抽屉。
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
}>();

const options = computed(() => props.payload.options || []);

/** 单题选择题才内联，其余形态（多选 / 填空 / 多步骤表单）继续走抽屉 */
const inline = computed(
  () =>
    (props.payload.input_type || "choice") !== "text"
    && props.payload.selection !== "multiple"
    && options.value.length > 0
    && !(Array.isArray(props.payload.slots) && props.payload.slots.length > 0),
);

/** 问题行：优先 title，退化成 original_query（服务端两种都会带） */
const title = computed(() => String(props.payload.title || props.payload.original_query || "").trim());

/**
 * 选中项来自服务端下发的 default_value，不由前端乐观更新：
 * 点选项只是把文字再发一次给 chat-messages，接口返回后才允许选中态变化。
 */
const selectedValues = computed(() => {
  const raw = props.payload.default_value;
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.map(value => String(value));
});

onMounted(() => {
  // 非内联形态保持原行为：auto_open 时把 payload 抛给页面开抽屉
  if (!inline.value && props.payload.auto_open) emit("open", props.payload);
});

function onOptionTap(option: AskSlotOption) {
  if (props.disabled) return;
  emit("pick", { slot: props.payload, option });
}
</script>

<template>
  <view v-if="inline" class="ask-slot">
    <text v-if="title" class="ask-slot__title">{{ title }}</text>
    <view class="ask-slot__options">
      <view
        v-for="option in options"
        :key="String(option.value)"
        class="ask-slot__option"
        :class="{
          'ask-slot__option--selected': selectedValues.includes(String(option.value)),
          'ask-slot__option--disabled': props.disabled,
        }"
        @tap.stop="onOptionTap(option)"
      >
        <text class="ask-slot__option-text">{{ option.label }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ===== 追问卡（内联形态）=====
   问题行 14px / Medium，选项为胶囊：白底 + 1px #E0E0E0 描边 + 20px 圆角，
   上下 8px / 左右 16px 内边距，字 14px，纵向排列、左对齐，间距 8px */
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
  gap: 16rpx; /* 8px：选项之间 */
}

.ask-slot__option {
  display: flex;
  align-items: center;
  padding: 16rpx 32rpx; /* 8px 16px */
  border: 2rpx solid transparent; /* 1px，颜色交给下面的渐变边框 */
  border-radius: 40rpx; /* 20px 胶囊 */
  /* 边框线线性渐变：#CDCAD2 → #F7F7F7 → #CDCAD2（上 → 中 → 下）。
     双层背景法：内层白底裁到 padding-box 盖住中间，
     外层渐变裁到 border-box，只露出 2rpx 的边框环 */
  background-color: transparent;
  background-image:
    linear-gradient(#ffffff, #ffffff),
    linear-gradient(180deg, #cdcad2 0%, #f7f7f7 50%, #cdcad2 100%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
  box-sizing: border-box;
}

.ask-slot__option-text {
  font-size: 28rpx; /* 14px */
  line-height: 40rpx; /* 20px */
  color: #0d0d0d;
}

/* 已选中：服务端 default_value 命中的项（实底盖掉渐变边框） */
.ask-slot__option--selected {
  background-image:
    linear-gradient(#0d0d0d, #0d0d0d),
    linear-gradient(#0d0d0d, #0d0d0d);
}

.ask-slot__option--selected .ask-slot__option-text {
  color: #ffffff;
}

/* 生成中：置灰且不吃点击，避免连点 */
.ask-slot__option--disabled {
  opacity: 0.4;
  pointer-events: none;
}
</style>

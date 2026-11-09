<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload, AskSlotSubmitPayload } from "@/api/chat/types";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 追问卡（scene=ask / type=slot）。
 *
 * 两种形态：
 * 1. 选择题（截图里的「请告诉我，您想体验哪个身份？」「请选择要查询的项目（可多选）」）：
 *    直接内联排在回答正文下方 —— 问题行 + 选项 + （多选时）其他输入 + 确认提交，不再弹底部抽屉。
 *    - 单选：点一项就用该选项再问一次，选中态等服务端回包，不本地乐观更新；
 *    - 多选：勾选后点「确认提交」，一次性把选中的选项（和其他输入）拼进提问发出去。
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

const options = computed(() => props.payload.options || []);

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

/**
 * 单选选中项来自服务端下发的 default_value，不由前端乐观更新：
 * 点选项只是把文字再发一次给 chat-messages，接口返回后才允许选中态变化。
 */
const selectedValues = computed(() => {
  const raw = props.payload.default_value;
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return list.map(value => String(value));
});

function isRequired(slot: AskSlotPayload) {
  return slot.required !== false;
}

/** 最少可选数：与底部抽屉同一份口径（必填至少 1 项） */
const minSelect = computed(() => {
  const configured = Math.max(0, Number(props.payload.min_select) || 0);
  return isRequired(props.payload) ? Math.max(1, configured) : configured;
});

/** 最多可选数：单选恒为 1，多选受 max_select 与选项总数双重约束 */
const maxSelect = computed(() => {
  const total = options.value.length;
  if (!isMultiple.value) return 1;
  const configured = Number(props.payload.max_select);
  const maximum = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : total;
  return Math.min(maximum, total);
});

/** 多选的本地选中项：初始按服务端 default_value 预选（超出上限的截掉，避免一进来就不能提交） */
const picked = ref<string[]>(
  options.value
    .filter(option => selectedValues.value.includes(optionKey(option)))
    .map(optionKey)
    .slice(0, maxSelect.value),
);
/** 「其他输入」填的内容：多选时与选项一起拼进提问 */
const remark = ref("");
const remarkEditing = ref(false);
/** 已经提交过：锁住卡片，避免重复发同一问 */
const submitted = ref(false);

const hasRemark = computed(() => Boolean(remark.value.trim()));
const otherInputPlaceholder = computed(
  () => String(props.payload.other_text || props.payload.other_placeholder || "").trim() || t("slot-other-input"),
);
const canSubmit = computed(() => {
  if (props.disabled || submitted.value) return false;
  if (maxSelect.value <= 0) return false;
  if (hasRemark.value) return picked.value.length <= maxSelect.value;
  return picked.value.length >= minSelect.value && picked.value.length <= maxSelect.value;
});

onMounted(() => {
  // 非内联形态保持原行为：auto_open 时把 payload 抛给页面开抽屉
  if (!inline.value && props.payload.auto_open) emit("open", props.payload);
});

/**
 * 「全部」选项：value 为「全部」（或带 select_all action）的那一项。
 * 它与单个选项在前端互斥 —— 点「全部」只留它，点单个则把「全部」摘掉（与底部抽屉一致）。
 */
function isSelectAllOption(option: AskSlotOption) {
  return option.value === "全部" || String(option.action || "") === "select_all";
}

const selectAllKey = computed(() => options.value.find(isSelectAllOption)?.value || "");

function onOptionTap(option: AskSlotOption) {
  if (props.disabled || submitted.value) return;

  // 单选：不本地改选中态，直接把这一项当一次提问发出去
  if (!isMultiple.value) {
    emit("pick", { slot: props.payload, option });
    return;
  }

  const key = optionKey(option);
  if (isSelectAllOption(option)) {
    picked.value = picked.value.includes(key) ? [] : [key];
    return;
  }
  const rest = picked.value.filter(item => item !== selectAllKey.value);
  if (rest.includes(key)) {
    picked.value = rest.filter(item => item !== key);
    return;
  }
  if (rest.length >= maxSelect.value) {
    uni.showToast({ title: t("slot-max-select", { count: maxSelect.value }), icon: "none" });
    return;
  }
  picked.value = [...rest, key];
}

function openRemarkInput() {
  if (props.disabled || submitted.value) return;
  remarkEditing.value = true;
}

function closeRemarkInput() {
  remarkEditing.value = false;
}

/** 多选提交：把勾中的选项（按选项原顺序）和「其他输入」一起交给页面拼提问 */
function onSubmitTap() {
  if (props.disabled || submitted.value) return;
  if (!canSubmit.value) {
    uni.showToast({
      title: minSelect.value > 1
        ? t("slot-min-select", { count: minSelect.value })
        : t("slot-max-select", { count: maxSelect.value }),
      icon: "none",
    });
    return;
  }
  submitted.value = true;
  remarkEditing.value = false;
  emit("submit", {
    slot: props.payload,
    selectedOptions: options.value.filter(option => picked.value.includes(optionKey(option))),
    remark: remark.value.trim() || undefined,
  });
}
</script>

<template>
  <view v-if="inline" class="ask-slot" :class="{ 'ask-slot--multiple': isMultiple }">
    <text v-if="title" class="ask-slot__title">{{ title }}</text>
    <view class="ask-slot__options">
      <view
        v-for="option in options"
        :key="optionKey(option)"
        class="ask-slot__option"
        :class="{
          'ask-slot__option--selected': isMultiple ? picked.includes(optionKey(option)) : selectedValues.includes(optionKey(option)),
          'ask-slot__option--disabled': props.disabled || submitted,
        }"
        @tap.stop="onOptionTap(option)"
      >
        <text class="ask-slot__option-text">{{ option.label }}</text>
      </view>

      <!-- 其他输入：多选时与选项一起提交；点开变输入框，填了就算作答 -->
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
          :placeholder="otherInputPlaceholder"
          placeholder-class="ask-slot__remark-placeholder"
          :maxlength="200"
          :auto-height="true"
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

    <!-- 多选才需要确认：单选点一项就是答案 -->
    <view v-if="isMultiple" class="ask-slot__actions">
      <view
        class="ask-slot__submit"
        :class="{ 'ask-slot__submit--disabled': !canSubmit }"
        @tap.stop="onSubmitTap"
      >
        {{ t("slot-confirm-submit") }}
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
  /**
   * 边框线线性渐变（按设计稿逐像素取样还原，取样点见下）：
   * 145° 走向，两端 #CDCAD2，最亮处 #F7F7F7 落在渐变线的 28%（不是 50%）。
   * 实测：右下 / 右侧 (205,202,210) = #CDCAD2，左侧偏中（x≈310 顶边）(247,247,247) = #F7F7F7，
   * 左上角 (214,211,218)、右上角 (219,217,222)、左下 (247,247,247)、右中 (207,204,212)，
   * 三段线性拟合 RMSE ≈ 2.5/255。
   * 双层背景法：内层白底裁到 padding-box 盖住中间，外层渐变裁到 border-box，只露 2rpx 的边框环
   */
  background-color: transparent;
  background-image:
    linear-gradient(#ffffff, #ffffff),
    linear-gradient(145deg, #cdcad2 0%, #f7f7f7 28%, #cdcad2 100%);
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

/* 生成中 / 已提交：置灰且不吃点击，避免连点 */
.ask-slot__option--disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* ===== 多选：整行铺满的选项行 =====
   与底部追问卡同一套材质（#F6F6F6 底 + 16rpx 圆角，选中 #1A1A1A + 白字），
   只是排在回答正文下方，不再弹白板 */
.ask-slot--multiple .ask-slot__options {
  align-items: stretch;
}

.ask-slot--multiple .ask-slot__option {
  box-sizing: border-box;
  width: 100%;
  min-height: 72rpx;
  padding: 16rpx 24rpx;
  border: 2rpx solid transparent;
  border-radius: 16rpx;
  /* 与胶囊同一道 145° 渐变边线，内层底色换成 #F6F6F6 的行底 */
  background-color: transparent;
  background-image:
    linear-gradient(#f6f6f6, #f6f6f6),
    linear-gradient(145deg, #cdcad2 0%, #f7f7f7 28%, #cdcad2 100%);
  background-origin: border-box;
  background-clip: padding-box, border-box;
}

.ask-slot--multiple .ask-slot__option--selected {
  background-image:
    linear-gradient(#1a1a1a, #1a1a1a),
    linear-gradient(#1a1a1a, #1a1a1a);
}

.ask-slot--multiple .ask-slot__option--selected .ask-slot__option-text {
  color: #ffffff;
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

/* 确认提交：右对齐主按钮，尺寸与底部追问卡一致（160×60rpx，20rpx 圆角） */
.ask-slot__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8rpx;
}

.ask-slot__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160rpx;
  height: 60rpx;
  border-radius: 20rpx;
  background: #1a1a1a;
  color: #ffffff;
  font-size: 28rpx;
  line-height: 34rpx;
}

.ask-slot__submit--disabled {
  background: #efefef;
  color: #999999;
}
</style>

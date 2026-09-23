<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload, AskSlotSubmitPayload } from "@/api/chat/types";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ArrowNextDisabledIcon from "@/assets/img/slot-drawer-arrow-next-disabled.svg";
import ArrowNextIcon from "@/assets/img/slot-drawer-arrow-next.svg";
import ArrowPrevDisabledIcon from "@/assets/img/slot-drawer-arrow-prev-disabled.svg";
import ArrowPrevIcon from "@/assets/img/slot-drawer-arrow-prev.svg";
import CloseIcon from "@/assets/img/slot-drawer-close.svg";

/**
 * 多选项追问卡片（设计稿 2667:3284「进入拆装」底部 375×430 白板）。
 *
 * 结构：灰色小标签 + 紧跟其后的进度 i/n + 右上 ×
 *      → 问题行 → 选项列表（末尾固定一行「其他输入」自由填写）
 *      → 底部居中「内容由AI生成，请核实重要信息」。
 * 直角白板贴底、向上阴影，无全屏遮罩。
 *
 * 交互：单题单选时点选项即作答（选中态先亮一下再提交，设计稿没有确认按钮）；
 * 多选或一屏有多道题时才出现底部「上一题/下一题 + 确认提交」。
 */
defineOptions({ name: "AiSlotDrawer" });

const props = defineProps({
  slots: { type: Array as () => AskSlotPayload[], default: () => [] },
  visible: { type: Boolean, default: false },
});

const emit = defineEmits<{
  close: [];
  submit: [payload: AskSlotSubmitPayload];
}>();

const OTHER_INPUT_PLACEHOLDER = "其他输入";

const currentIndex = ref(0);
const selections = ref<Record<string, string[]>>({});
const otherRemark = ref("");
const remarkEditing = ref(false);

const currentSlot = computed(() => props.slots[currentIndex.value] || null);
const isLastSlot = computed(() => currentIndex.value === props.slots.length - 1);
const showPagination = computed(() => props.slots.length > 1);
const selectedIds = computed(() => currentSlot.value ? selections.value[currentSlot.value.slot_name] || [] : []);
const isMultiple = computed(() => currentSlot.value?.selection === "multiple");

/** 必填判定：required 缺省也按必填处理，避免没选任何一项时点「确认提交」被静默拦掉。 */
function isRequired(slot: AskSlotPayload) {
  return slot.required !== false;
}

/** 某道题的最少可选数：抽屉校验与整体提交共用同一份口径，避免两处策略漂移。 */
function minSelectOf(slot: AskSlotPayload) {
  const configured = Math.max(0, Number(slot.min_select) || 0);
  return isRequired(slot) ? Math.max(1, configured) : configured;
}

/** 某道题的最多可选数：单选恒为 1，多选受 max_select 与选项总数双重约束。 */
function maxSelectOf(slot: AskSlotPayload) {
  const total = slot.options.length;
  if (slot.selection !== "multiple") return 1;
  const configured = Number(slot.max_select);
  const maximum = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : total;
  return Math.min(maximum, total);
}

/**
 * 默认选中项：把 default_value 归一成 options 里真实存在的 value。
 * 兼容单个值、数组与带 value 的对象，并按题目允许的上限截断，
 * 否则预选中超出 max_select 会让这道题直接变成无法提交。
 */
function resolveDefaultKeys(slot: AskSlotPayload) {
  const raw: unknown = slot.default_value;
  const list: unknown[] = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const keys = list
    .map(item => String(
      item && typeof item === "object" && "value" in item
        ? (item as Record<string, unknown>).value ?? ""
        : item ?? "",
    ).trim())
    .filter(Boolean);
  if (!keys.length) return [];
  return slot.options
    .filter(option => keys.includes(optionKey(option)))
    .map(option => optionKey(option))
    .slice(0, maxSelectOf(slot));
}

/** 打开抽屉时的初始选中态：一次性落到 selections，不引入深监听。 */
function buildInitialSelections(slots: AskSlotPayload[]) {
  return slots.reduce<Record<string, string[]>>((acc, slot) => {
    const keys = resolveDefaultKeys(slot);
    if (keys.length) acc[slot.slot_name] = keys;
    return acc;
  }, {});
}

/** 「推荐」标签落位：recommended → default_value → 第 0 项，保证协议不带标记时观感不退化。 */
const recommendedKey = computed(() => {
  const slot = currentSlot.value;
  if (!slot?.options.length) return "";
  const flagged = slot.options.find(option => option.recommended === true);
  if (flagged) return optionKey(flagged);
  return resolveDefaultKeys(slot)[0] || optionKey(slot.options[0]);
});

const minSelect = computed(() => currentSlot.value ? minSelectOf(currentSlot.value) : 0);
const maxSelect = computed(() => currentSlot.value ? maxSelectOf(currentSlot.value) : 0);
const hasInvalidRange = computed(() => minSelect.value > maxSelect.value);
const hasRemark = computed(() => Boolean(otherRemark.value.trim()));
/** 单题单选：点一下就是答案，直接提交 */
const tapToSubmit = computed(() => !showPagination.value && !isMultiple.value);
/** 自定义输入也算作答，所以要留着提交入口（多选/多题时本来就有底部操作栏） */
const showActions = computed(() => !tapToSubmit.value || remarkEditing.value || hasRemark.value);
const isCurrentSelectionValid = computed(() => !hasInvalidRange.value
  && (selectedIds.value.length >= minSelect.value || hasRemark.value)
  && selectedIds.value.length <= maxSelect.value);

const labelText = computed(() => String(currentSlot.value?.description || "").trim() || "请选择");
const questionText = computed(() => String(currentSlot.value?.title || "").trim() || "请选择要查询的设备");

let submitTimer: ReturnType<typeof setTimeout> | null = null;

function clearSubmitTimer() {
  if (!submitTimer) return;
  clearTimeout(submitTimer);
  submitTimer = null;
}

watch(() => props.visible, (visible) => {
  clearSubmitTimer();
  remarkEditing.value = false;
  if (!visible || !props.slots.length) return;
  currentIndex.value = 0;
  selections.value = buildInitialSelections(props.slots);
  otherRemark.value = "";
});

onBeforeUnmount(clearSubmitTimer);

function optionKey(option: AskSlotOption) {
  return option.value;
}

function isSelected(option: AskSlotOption) {
  return selectedIds.value.includes(optionKey(option));
}

function selectOption(option: AskSlotOption) {
  const slot = currentSlot.value;
  if (!slot) return;
  const key = optionKey(option);
  if (isSelected(option)) {
    selections.value = { ...selections.value, [slot.slot_name]: selectedIds.value.filter(id => id !== key) };
    return;
  }
  if (!isMultiple.value) {
    selections.value = { ...selections.value, [slot.slot_name]: [key] };
    // 让选中态先亮一下再收起，跟设计稿的深色选中态一致
    if (tapToSubmit.value) {
      clearSubmitTimer();
      submitTimer = setTimeout(() => {
        submitTimer = null;
        if (props.visible) submit();
      }, 180);
    }
    return;
  }
  if (selectedIds.value.length >= maxSelect.value) {
    uni.showToast({ title: `最多选择 ${maxSelect.value} 项`, icon: "none" });
    return;
  }
  selections.value = { ...selections.value, [slot.slot_name]: [...selectedIds.value, key] };
}

function openRemarkInput() {
  remarkEditing.value = true;
}

function closeRemarkInput() {
  remarkEditing.value = false;
}

function validateCurrentSlot() {
  if (!currentSlot.value) return false;
  if (hasInvalidRange.value) {
    uni.showToast({ title: "当前题目选择范围无效", icon: "none" });
    return false;
  }
  if (!isCurrentSelectionValid.value) {
    const message = minSelect.value > 0
      ? `请至少选择 ${minSelect.value} 项`
      : `最多选择 ${maxSelect.value} 项`;
    uni.showToast({ title: message, icon: "none" });
    return false;
  }
  return true;
}

function previousSlot() {
  if (currentIndex.value > 0) {
    currentIndex.value -= 1;
  }
}

function nextSlot() {
  if (!validateCurrentSlot() || isLastSlot.value) return;
  currentIndex.value += 1;
}

function submit() {
  clearSubmitTimer();
  if (!validateCurrentSlot()) return;
  const invalidSlot = props.slots.find((slot) => {
    const selected = selections.value[slot.slot_name] || [];
    const min = slot.required ? Math.max(1, Number(slot.min_select) || 0) : Math.max(0, Number(slot.min_select) || 0);
    const max = slot.selection === "single" ? 1 : Math.min(Number(slot.max_select) > 0 ? Number(slot.max_select) : slot.options.length, slot.options.length);
    if (min > max || selected.length > max) return true;
    // 只填了「其他输入」也当作答，不再要求必须勾选项
    if (hasRemark.value && !selected.length) return false;
    return selected.length < min;
  });
  if (invalidSlot) {
    currentIndex.value = props.slots.indexOf(invalidSlot);
    uni.showToast({ title: "请完成当前选择", icon: "none" });
    return;
  }
  const selected = props.slots.reduce<AskSlotOption[]>((items, slot) => {
    const chosen = selections.value[slot.slot_name] || [];
    return items.concat(slot.options.filter(option => chosen.includes(optionKey(option))));
  }, []);
  const lastSlot = props.slots[props.slots.length - 1];
  emit("submit", {
    slot: lastSlot,
    selectedOptions: selected,
    remark: otherRemark.value.trim() || undefined,
  });
  emit("close");
}

function close() {
  clearSubmitTimer();
  emit("close");
}
</script>

<template>
  <view v-if="visible && currentSlot" class="slot-drawer">
    <view class="slot-drawer__header">
      <text class="slot-drawer__label">
        {{ labelText }}
      </text>
      <text v-if="showPagination" class="slot-drawer__progress">
        {{ currentIndex + 1 }}/{{ slots.length }}
      </text>
      <view class="slot-drawer__close" @tap="close">
        <image class="slot-drawer__close-icon" :src="CloseIcon" mode="aspectFit" />
      </view>
    </view>

    <text class="slot-drawer__question">
      {{ questionText }}
    </text>

    <scroll-view scroll-y class="slot-drawer__options">
      <view class="slot-drawer__options-list">
        <view
          v-for="option in currentSlot.options"
          :key="optionKey(option)"
          class="slot-drawer__option"
          :class="{ 'slot-drawer__option--selected': isSelected(option) }"
          @tap="selectOption(option)"
        >
          <text class="slot-drawer__option-text">
            {{ option.label }}
          </text>
        </view>

        <!-- 其他输入：与选项同行样式，点开变输入框，填了就算作答 -->
        <view class="slot-drawer__option slot-drawer__option--remark" @tap="openRemarkInput">
          <textarea
            v-if="remarkEditing"
            v-model="otherRemark"
            class="slot-drawer__remark-input"
            :focus="remarkEditing"
            :placeholder="OTHER_INPUT_PLACEHOLDER"
            placeholder-class="slot-drawer__remark-placeholder"
            :maxlength="200"
            :auto-height="true"
            @blur="closeRemarkInput"
          />
          <text
            v-else
            class="slot-drawer__remark-text"
            :class="{ 'slot-drawer__remark-text--filled': hasRemark }"
          >
            {{ hasRemark ? otherRemark : OTHER_INPUT_PLACEHOLDER }}
          </text>
        </view>
      </view>
    </scroll-view>

    <view v-if="showActions" class="slot-drawer__actions">
      <view v-if="showPagination" class="slot-drawer__nav">
        <view
          class="slot-drawer__round"
          :class="{ 'slot-drawer__round--disabled': currentIndex === 0 }"
          @tap="previousSlot"
        >
          <image class="slot-drawer__arrow-icon" :src="currentIndex === 0 ? ArrowPrevDisabledIcon : ArrowPrevIcon" mode="aspectFit" />
        </view>
        <view
          class="slot-drawer__round"
          :class="{ 'slot-drawer__round--disabled': isLastSlot }"
          @tap="nextSlot"
        >
          <image class="slot-drawer__arrow-icon" :src="isLastSlot ? ArrowNextDisabledIcon : ArrowNextIcon" mode="aspectFit" />
        </view>
      </view>
      <view v-else class="slot-drawer__nav slot-drawer__nav--placeholder" aria-hidden="true" />
      <view class="slot-drawer__submit" @tap="submit">
        确认提交
      </view>
    </view>

    <text class="slot-drawer__hint">
      内容由AI生成，请核实重要信息
    </text>
  </view>
</template>

<style lang="scss" scoped>
/* 直角白板贴底，只留向上阴影；safe-area 留给底部 home indicator */
.slot-drawer {
  position: fixed;
  z-index: 1002;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  max-height: 86vh;
  padding: 52rpx 80rpx 24rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  animation: slot-drawer-slide-up 0.25s ease-out;
}

/* 标签 + 进度同一行，进度紧跟标签（设计稿间距 9px => 18rpx）；× 固定右侧 */
.slot-drawer__header {
  display: flex;
  align-items: center;
  height: 52rpx;
}

.slot-drawer__label {
  flex-shrink: 0;
  color: #999999;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__progress {
  flex-shrink: 0;
  margin-left: 18rpx;
  color: #999999;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__close {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
  /* 关闭按钮距弹窗右边缘 25px、内容列右边距 40px，向左抵消 15px => 30rpx */
  margin-left: auto;
  margin-right: -30rpx;
}

.slot-drawer__close-icon {
  width: 100%;
  height: 100%;
}

.slot-drawer__question {
  display: block;
  margin-top: 36rpx;
  color: #1a1a1a;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

/* 选项多时在卡片内滚动，避免整屏占满 */
.slot-drawer__options {
  max-height: 560rpx;
  margin-top: 32rpx;
}

.slot-drawer__options-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

/* 选项行：295×36 => 590×72，背景 #F6F6F6，圆角 8px => 16rpx，左内边距 12px => 24rpx */
.slot-drawer__option {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 100%;
  min-height: 72rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.slot-drawer__option--selected {
  background: #2c2626;
}

.slot-drawer__option-text {
  flex: 1 1 auto;
  min-width: 0;
  color: #000000;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__option--selected .slot-drawer__option-text {
  color: #ffffff;
}

/* 其他输入：未填写为灰色占位，填了用正文色 */
.slot-drawer__option--remark {
  padding-top: 16rpx;
  padding-bottom: 16rpx;
}

.slot-drawer__remark-text {
  flex: 1 1 auto;
  min-width: 0;
  color: #666666;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__remark-text--filled {
  color: #000000;
}

.slot-drawer__remark-input {
  flex: 1 1 auto;
  width: 100%;
  min-height: 40rpx;
  color: #000000;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 40rpx;
}

.slot-drawer__remark-placeholder {
  color: #666666;
  font-size: 28rpx;
}

.slot-drawer__actions {
  display: flex;
  align-items: center;
  min-height: 60rpx;
  margin-top: 32rpx;
}

/* 翻页按钮间距：设计稿 Group 12 / Group 13 间距 28px => 56rpx */
.slot-drawer__nav {
  display: flex;
  align-items: center;
  gap: 56rpx;
}

.slot-drawer__nav--placeholder {
  visibility: hidden;
}

.slot-drawer__round {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: #f6f6f6;
}

.slot-drawer__arrow-icon {
  width: 100%;
  height: 100%;
}

/* 提交按钮：设计稿 Rectangle 101，80×30，圆角 10px => 160×60(rpx)、20rpx */
.slot-drawer__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160rpx;
  height: 60rpx;
  margin-left: auto;
  border-radius: 20rpx;
  background: #1a1a1a;
  color: #ffffff;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__hint {
  display: block;
  margin-top: 32rpx;
  text-align: center;
  color: #bababa;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  line-height: 30rpx;
}

@keyframes slot-drawer-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>

<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload, AskSlotSubmitPayload } from "@/api/chat/types";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
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
  /** 卡片实际高度（px）：底部白板会盖住消息列表，页面拿它给列表加底部间距 */
  "height-change": [height: number];
}>();

const OTHER_INPUT_PLACEHOLDER = "其他输入";

const currentIndex = ref(0);
/** 选择题的作答：按题目存选中的 value */
const selections = ref<Record<string, string[]>>({});
/** 填空题（input_type=text）的作答：按题目存输入文本 */
const textAnswers = ref<Record<string, string>>({});
/** 「其他输入」的作答：按题目存，避免跨题串味 */
const remarks = ref<Record<string, string>>({});
const remarkEditing = ref(false);

const currentSlot = computed(() => props.slots[currentIndex.value] || null);
const isLastSlot = computed(() => currentIndex.value === props.slots.length - 1);
const showPagination = computed(() => props.slots.length > 1);
const selectedIds = computed(() => currentSlot.value ? selections.value[currentSlot.value.slot_name] || [] : []);
const isMultiple = computed(() => currentSlot.value?.selection === "multiple");
const currentSlotName = computed(() => String(currentSlot.value?.slot_name || ""));
/** 当前题是不是填空题（作业协同多步骤表单里的 input_type=text） */
const isTextStep = computed(() => currentSlot.value?.input_type === "text");
/**
 * 作业协同的多步骤表单：题目自带 input_type 时，按「每步确认提交 → 最后一步拼 Q/A 文本」走，
 * 与 ai问问 的多选题（一次提交所有题）区分开。
 */
const isStepForm = computed(() => props.slots.some(slot => Boolean(slot?.input_type)));
/** 填空题的输入内容（按题存） */
const currentTextAnswer = computed({
  get: () => textAnswers.value[currentSlotName.value] || "",
  set: (value: string) => {
    textAnswers.value = { ...textAnswers.value, [currentSlotName.value]: String(value || "") };
  },
});
/** 当前题「其他输入」填的内容（按题存） */
const currentRemark = computed({
  get: () => remarks.value[currentSlotName.value] || "",
  set: (value: string) => {
    remarks.value = { ...remarks.value, [currentSlotName.value]: String(value || "") };
  },
});

/**
 * 是否渲染「其他输入」行：
 * - 没有 input_type 的题（ai问问 的追问卡）沿用原行为，始终带这一行；
 * - 多步骤表单（JSON 带 input_type）里只有明确给了输入框定义才渲染
 *   （`other_text` / `other_placeholder` 文案，或 `allow_other` / `other_input` 开关）——
 *   选项列表本身不算输入框定义；文本题（input_type=text）本身就是输入框，也不再叠加这一行。
 */
const showOtherInput = computed(() => {
  const slot = currentSlot.value;
  if (!slot) return false;
  if (!slot.input_type) return true;
  if (slot.input_type === "text") return false;
  if (String(slot.other_text || slot.other_placeholder || "").trim()) return true;
  return Boolean(slot.allow_other ?? slot.other_input ?? slot.allow_other_input ?? false);
});

/** 「其他输入」行的占位文案：JSON 给了就用它，否则退回默认「其他输入」 */
const otherInputPlaceholder = computed(() =>
  String(currentSlot.value?.other_text || currentSlot.value?.other_placeholder || "").trim() || OTHER_INPUT_PLACEHOLDER);

/** 某道题是否已作答：填空题看文本，选择题看选项或「其他输入」 */
function isSlotAnswered(slot: AskSlotPayload) {
  const name = String(slot.slot_name || "");
  if (slot.input_type === "text") {
    return Boolean(String(textAnswers.value[name] || "").trim()) || !isRequired(slot);
  }
  const selected = selections.value[name] || [];
  if (String(remarks.value[name] || "").trim()) return selected.length <= maxSelectOf(slot);
  return selected.length >= minSelectOf(slot) && selected.length <= maxSelectOf(slot);
}

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
const hasRemark = computed(() => Boolean(currentRemark.value.trim()));
/** 单题单选：点一下就是答案，直接提交 */
const tapToSubmit = computed(() => !showPagination.value && !isMultiple.value);
/** 自定义输入也算作答，所以要留着提交入口（多选/多题时本来就有底部操作栏） */
const showActions = computed(() => !tapToSubmit.value || remarkEditing.value || hasRemark.value);
const isCurrentSelectionValid = computed(() => {
  const slot = currentSlot.value;
  if (!slot || hasInvalidRange.value) return false;
  if (slot.input_type === "text") return isSlotAnswered(slot);
  return (selectedIds.value.length >= minSelect.value || hasRemark.value)
    && selectedIds.value.length <= maxSelect.value;
});

/**
 * 提交按钮是否激活：勾了选项（或填了「其他输入」）才可点，
 * 否则按钮置灰、点了只给一句要求提示（不提交）。
 */
const canSubmitSelection = computed(() => isCurrentSelectionValid.value);

/** 提交按钮点击：未满足要求时只提示；多步骤表单里先进入下一步，最后一步才提交 */
function onSubmitTap() {
  if (!canSubmitSelection.value) {
    validateCurrentSlot();
    return;
  }
  if (isStepForm.value && !isLastSlot.value) {
    currentIndex.value += 1;
    return;
  }
  submit();
}

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
  textAnswers.value = {};
  remarks.value = {};
});

onBeforeUnmount(clearSubmitTimer);

function optionKey(option: AskSlotOption) {
  return option.value;
}

function isSelected(option: AskSlotOption) {
  return selectedIds.value.includes(optionKey(option));
}

/**
 * 「全部」选项：value 为「全部」（或带 select_all action）的那一项。
 * 它与单个选项在前端互斥——点「全部」只留它，点单个则把「全部」摘掉。
 */
function isSelectAllOption(option: AskSlotOption) {
  return option.value === "全部" || String(option.action || "") === "select_all";
}

const selectAllKey = computed(() => currentSlot.value?.options.find(isSelectAllOption)?.value || "");

/** 单选（或点「全部」）时的自动提交：让选中态先亮一下再收起，跟设计稿一致 */
function submitAfterSelection() {
  clearSubmitTimer();
  submitTimer = setTimeout(() => {
    submitTimer = null;
    if (props.visible) submit();
  }, 180);
}

function selectOption(option: AskSlotOption) {
  const slot = currentSlot.value;
  if (!slot) return;
  const key = optionKey(option);

  // 「全部」与单个选项互斥：点「全部」时只留它，点单个时先摘掉「全部」
  if (isSelectAllOption(option)) {
    const next = isSelected(option) ? [] : [key];
    selections.value = { ...selections.value, [slot.slot_name]: next };
    if (next.length && tapToSubmit.value) submitAfterSelection();
    return;
  }

  const current = selectedIds.value.filter(id => id !== selectAllKey.value);

  if (isSelected(option)) {
    selections.value = { ...selections.value, [slot.slot_name]: current.filter(id => id !== key) };
    return;
  }
  if (!isMultiple.value) {
    selections.value = { ...selections.value, [slot.slot_name]: [key] };
    if (tapToSubmit.value) submitAfterSelection();
    return;
  }
  if (current.length >= maxSelect.value) {
    uni.showToast({ title: `最多选择 ${maxSelect.value} 项`, icon: "none" });
    return;
  }
  selections.value = { ...selections.value, [slot.slot_name]: [...current, key] };
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
    const message = currentSlot.value?.input_type === "text"
      ? "请先填写内容"
      : minSelect.value > 0
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

/** 多步骤表单的答案：按题目顺序收集（选择题用选项文案、多选用「、」分隔，填空题用输入文本） */
function buildStepAnswers() {
  return props.slots
    .map((slot) => {
      const name = String(slot.slot_name || "");
      const question = String(slot.title || "").trim();
      if (slot.input_type === "text") {
        return { question, answer: String(textAnswers.value[name] || "").trim() };
      }
      const chosen = selections.value[name] || [];
      const labels = slot.options
        .filter(option => chosen.includes(optionKey(option)))
        .map(option => option.label || option.value);
      const remark = String(remarks.value[name] || "").trim();
      return { question, answer: [labels.join("、"), remark].filter(Boolean).join("、") };
    })
    .filter(item => item.answer);
}

function submit() {
  clearSubmitTimer();
  if (!validateCurrentSlot()) return;
  const invalidSlot = props.slots.find(slot => !isSlotAnswered(slot));
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
    remark: String(remarks.value[lastSlot.slot_name] || "").trim() || undefined,
    // 多步骤表单：把每题的问答交给提交侧拼成 Q/A 文本
    ...(isStepForm.value ? { answers: buildStepAnswers() } : {}),
  });
  emit("close");
}

function close() {
  clearSubmitTimer();
  emit("close");
}

/**
 * 卡片高度上报给页面：贴底白板会盖住列表，页面据此给消息列表加底部间距，
 * 让最后一条内容能完整露在卡片上方；收起时回 0，页面撤掉间距。
 * 翻页（上一题/下一题）会换选项、高度跟着变，所以显隐与换题后都要重新量。
 */
async function measureHeight() {
  if (!props.visible || !props.slots.length) {
    emit("height-change", 0);
    return;
  }
  await nextTick();
  uni.createSelectorQuery()
    .select(".slot-drawer")
    .boundingClientRect((rect) => {
      const measured = Array.isArray(rect) ? rect[0]?.height : rect?.height;
      emit("height-change", Number(measured) || 0);
    })
    .exec();
}

watch(
  () => [props.visible, props.slots.length, currentIndex.value],
  () => { void measureHeight(); },
);
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
        <!-- 填空题（input_type=text）：整行输入框，必填时填了才能进下一步 -->
        <view v-if="isTextStep" class="slot-drawer__option slot-drawer__option--text">
          <textarea
            v-model="currentTextAnswer"
            class="slot-drawer__text-input"
            :placeholder="currentSlot.placeholder || '请输入'"
            placeholder-class="slot-drawer__remark-placeholder"
            :maxlength="200"
            :auto-height="true"
          />
        </view>

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

        <!-- 其他输入：仅当 JSON 定义了输入框（other_text 等）才渲染；点开变输入框，填了就算作答 -->
        <view
          v-if="showOtherInput"
          class="slot-drawer__option slot-drawer__option--remark"
          @tap="openRemarkInput"
        >
          <textarea
            v-if="remarkEditing"
            v-model="currentRemark"
            class="slot-drawer__remark-input"
            :focus="remarkEditing"
            :placeholder="otherInputPlaceholder"
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
            {{ hasRemark ? currentRemark : otherInputPlaceholder }}
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
      <view
        class="slot-drawer__submit"
        :class="{ 'slot-drawer__submit--disabled': !canSubmitSelection }"
        @tap="onSubmitTap"
      >
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

/* 选项行：单行时 40 + 16×2 = 72rpx，与设计稿一致；
   上下内边距是给多行文案留的（订单信息这类 label 会折成 2~3 行，
   原先 padding 上下为 0，折行后文字会贴住背景上下边缘） */
.slot-drawer__option {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 100%;
  min-height: 72rpx;
  padding: 16rpx 24rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.slot-drawer__option--selected {
  background: #1a1a1a;
}

.slot-drawer__option-text {
  flex: 1 1 auto;
  min-width: 0;
  color: #000000;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  /* 40rpx 与两张指导卡片的选项文案一致，折行后行间距不会挤在一起 */
  line-height: 40rpx;
}

.slot-drawer__option--selected .slot-drawer__option-text {
  color: #ffffff;
}

/* 其他输入：未填写为灰色占位，填了用正文色（上下内边距由 .slot-drawer__option 统一给） */
.slot-drawer__option--remark {
  align-items: center;
}

/* 填空题：整行输入框，外观与选项行一致（上下内边距由 .slot-drawer__option 统一给） */
.slot-drawer__option--text {
  align-items: center;
}

.slot-drawer__text-input {
  flex: 1 1 auto;
  width: 100%;
  min-height: 40rpx;
  color: #000000;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 40rpx;
}

.slot-drawer__remark-text {
  flex: 1 1 auto;
  min-width: 0;
  color: #666666;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  line-height: 40rpx;
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

/* 未勾选任何选项：按钮置灰不可点（设计稿 4686:1069，底 #efefef + 字 #999999） */
.slot-drawer__submit--disabled {
  background: #efefef;
  color: #999999;
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

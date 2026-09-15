<script setup lang="ts">
import type { AskSlotOption, AskSlotPayload, AskSlotSubmitPayload } from "@/api/chat/types";
import { computed, ref, watch } from "vue";
import ArrowNextDisabledIcon from "/src/assets/icons/slot-drawer/slot-drawer-arrow-next-disabled.svg";
import ArrowNextIcon from "/src/assets/icons/slot-drawer/slot-drawer-arrow-next.svg";
import ArrowPrevDisabledIcon from "/src/assets/icons/slot-drawer/slot-drawer-arrow-prev-disabled.svg";
import ArrowPrevIcon from "/src/assets/icons/slot-drawer/slot-drawer-arrow-prev.svg";
import CloseIcon from "/src/assets/icons/slot-drawer/slot-drawer-close.svg";

defineOptions({ name: "AiSlotDrawer" });

const props = defineProps({
  slots: { type: Array as () => AskSlotPayload[], default: () => [] },
  visible: { type: Boolean, default: false },
});

const emit = defineEmits<{
  close: [];
  submit: [payload: AskSlotSubmitPayload];
}>();

const currentIndex = ref(0);
const selections = ref<Record<string, string[]>>({});
const otherRemark = ref("");

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
const isCurrentSelectionValid = computed(() => !hasInvalidRange.value
  && selectedIds.value.length >= minSelect.value
  && selectedIds.value.length <= maxSelect.value);

// visible 与 slots 常在同一 tick 更新，flush: "post" 保证读到的是本轮最新的 slots。
watch(() => props.visible, (visible) => {
  if (!visible || !props.slots.length) return;
  currentIndex.value = 0;
  selections.value = buildInitialSelections(props.slots);
  otherRemark.value = "";
}, { flush: "post" });

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
    return;
  }
  if (selectedIds.value.length >= maxSelect.value) {
    uni.showToast({ title: `最多选择 ${maxSelect.value} 项`, icon: "none" });
    return;
  }
  selections.value = { ...selections.value, [slot.slot_name]: [...selectedIds.value, key] };
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
  if (!validateCurrentSlot()) return;
  const invalidSlot = props.slots.find((slot) => {
    const selected = selections.value[slot.slot_name] || [];
    const min = minSelectOf(slot);
    const max = maxSelectOf(slot);
    return min > max || selected.length < min || selected.length > max;
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
  emit("close");
}
</script>

<template>
  <view v-if="visible && currentSlot" class="slot-drawer-modal">
    <view class="slot-drawer">
      <view class="slot-drawer__toolbar">
        <view class="slot-drawer__progress">
          <text>答题</text>
          <text>{{ currentIndex + 1 }}/{{ slots.length }}</text>
        </view>
        <view class="slot-drawer__close" @tap="close">
          <image class="slot-drawer__close-icon" :src="CloseIcon" mode="aspectFit" />
        </view>
      </view>

      <!-- 题目标题：Status Label -->
      <text class="slot-drawer__title">
        {{ currentSlot.title || "请选择" }}
      </text>

      <scroll-view scroll-y class="slot-drawer__options">
        <view class="slot-drawer__options-list">
          <view
            v-for="(option, index) in currentSlot.options"
            :key="optionKey(option)"
            class="slot-drawer__option"
            :class="{ 'slot-drawer__option--selected': isSelected(option) }"
            @tap="selectOption(option)"
          >
            <text class="slot-drawer__option-text">
              {{ index + 1 }}  {{ option.label }}
            </text>
            <view v-if="optionKey(option) === recommendedKey" class="slot-drawer__recommend">
              <text class="slot-drawer__recommend-text">
                推荐
              </text>
            </view>
          </view>
          <textarea
            v-model="otherRemark"
            class="slot-drawer__remark"
            placeholder="其他输入"
            :maxlength="200"
            :auto-height="false"
          />
        </view>
      </scroll-view>
      <view class="slot-drawer__footer">
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
        <view class="slot-drawer__footer-spacer" />
        <view class="slot-drawer__submit" @tap="submit">
          确认提交
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* =========================================================
   遮罩层：全屏固定，不响应点击关闭
   ========================================================= */
.slot-drawer-modal {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: rgba(0, 0, 0, 0.38);
  animation: slot-drawer-fade-in 0.2s ease-out;
}

/* 设计稿 Rectangle 25：375×436 px，顶部左/右圆角 22px => 44rpx，底部直角。 */
.slot-drawer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 750rpx;
  padding: 40rpx 80rpx calc(40rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  border-radius: 44rpx 44rpx 0 0;
  overflow: hidden;
  background: #FFFFFF;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  animation: slot-drawer-slide-up 0.25s ease-out;
}

.slot-drawer__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52rpx;
  /* 关闭按钮距弹窗右边缘 25px（设计稿），内容列右边距为 40px，向左抵消 15px => 30rpx */
  margin-right: -30rpx;
}

.slot-drawer__progress {
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: #999999;
  font-size: 28rpx;
  line-height: 34rpx;
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
  background: #F6F6F6;
}

/* 上一题禁用态：使用灰色箭头图标，无需再叠加透明度 */

/* 翻页箭头图标：设计稿 8×8 => 16×16(rpx) */
.slot-drawer__arrow-icon {
  width: 100%;
  height: 100%;
}

/* 关闭按钮：26×26 容器 */
.slot-drawer__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx;
  height: 52rpx;
}

.slot-drawer__close-icon {
  width: 100%;
  height: 100%;
}

.slot-drawer__title {
  margin-top: 32rpx;
  color: #1A1A1A;
  font-size: 28rpx;
  line-height: 34rpx;
}

.slot-drawer__options {
  flex: 1;
  min-height: 0;
  margin-top: 32rpx;
}

.slot-drawer__options-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding-bottom: 32rpx;
}

/* 选项项：295×36 => 590×72，背景 #F6F6F6，圆角 8px => 16rpx，左内边距 12px => 24rpx */
.slot-drawer__option {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 590rpx;
  height: 72rpx;
  margin: 0;
  padding: 0 24rpx;
  border: 0;
  border-radius: 16rpx;
  box-sizing: border-box;
  background: #F6F6F6;
  text-align: left;
}

.slot-drawer__option--selected {
  background: #2F2B2B;
}

/* 选项文字：14px => 28rpx，颜色 #000000（选中态 #FFFFFF），单行截断
   不设置 flex:1，让文字自然宽度，推荐标签紧跟文字 */
.slot-drawer__option-text {
  flex: 0 1 auto;
  min-width: 0;
  color: #000000;
  font-size: 28rpx;
  line-height: 34rpx;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slot-drawer__option--selected .slot-drawer__option-text {
  color: #FFFFFF;
}

/* 推荐标签：背景 #FFE6E4，圆角 5px => 10rpx，内边距 7/2px => 14/4rpx
   紧贴文字右侧，间距 6px => 12rpx */
.slot-drawer__recommend {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 12rpx;
  padding: 4rpx 14rpx;
  border-radius: 10rpx;
  background: #FFE6E4;
}

.slot-drawer__recommend-text {
  color: #FE0000;
  font-size: 22rpx;
  line-height: 26rpx;
}

/* =========================================================
   其他关注指标输入区：Frame 7（单行）
   设计稿 295×36 => 590×72，背景 #F6F6F6，圆角 12px => 24rpx
   上下内边距 8px => 16rpx，左右 16px => 32rpx，占位文字 12px/20px => 24rpx/40rpx，颜色 #999999
   ========================================================= */
.slot-drawer__remark {
  width: 590rpx;
  height: 72rpx;
  padding: 16rpx 32rpx;
  border: 0;
  box-sizing: border-box;
  border-radius: 24rpx;
  background: #F6F6F6;
  color: #000000;
  font-size: 24rpx;
  line-height: 40rpx;
}

.slot-drawer__remark::placeholder {
  color: #999999;
}

.slot-drawer__footer {
  display: flex;
  align-items: center;
  min-height: 60rpx;
  padding-top: 16rpx;
}

.slot-drawer__footer-spacer {
  flex: 1;
}

/* 提交按钮：设计稿 Rectangle 101，80×30，圆角 10px => 160×60(rpx)、20rpx */
.slot-drawer__submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160rpx;
  height: 60rpx;
  border-radius: 20rpx;
  background: #1A1A1A;
  color: #FFFFFF;
  font-size: 28rpx;
  line-height: 34rpx;
}

@keyframes slot-drawer-fade-in {
  from { background: rgba(0, 0, 0, 0); }
  to { background: rgba(0, 0, 0, 0.38); }
}

@keyframes slot-drawer-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>

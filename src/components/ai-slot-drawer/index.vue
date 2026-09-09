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
const minSelect = computed(() => {
  const slot = currentSlot.value;
  if (!slot) return 0;
  const configured = Math.max(0, Number(slot.min_select) || 0);
  return slot.required ? Math.max(1, configured) : configured;
});
const maxSelect = computed(() => {
  const slot = currentSlot.value;
  if (!slot) return 0;
  if (!isMultiple.value) return 1;
  const configured = Number(slot.max_select);
  const maximum = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : slot.options.length;
  return Math.min(maximum, slot.options.length);
});
const hasInvalidRange = computed(() => minSelect.value > maxSelect.value);
const isCurrentSelectionValid = computed(() => !hasInvalidRange.value
  && selectedIds.value.length >= minSelect.value
  && selectedIds.value.length <= maxSelect.value);

watch(() => props.visible, (visible) => {
  if (!visible || !props.slots.length) return;
  currentIndex.value = 0;
  selections.value = {};
  otherRemark.value = "";
});

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
    const min = slot.required ? Math.max(1, Number(slot.min_select) || 0) : Math.max(0, Number(slot.min_select) || 0);
    const max = slot.selection === "single" ? 1 : Math.min(Number(slot.max_select) > 0 ? Number(slot.max_select) : slot.options.length, slot.options.length);
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
    <!-- 弹框主体：仅右上角关闭按钮可关闭 -->
    <view class="slot-drawer">
      <!-- 顶部操作行：progress | nav + action | spacer | close -->
      <view class="slot-drawer__toolbar">
        <!-- 左侧：答题 1/4 -->
        <view class="slot-drawer__progress">
          <text>答题</text>
          <text>{{ currentIndex + 1 }}/{{ slots.length }}</text>
        </view>

        <!-- 中部：翻页按钮，多题时展示；单题时用等宽占位保持提交位置 -->
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

        <!-- 操作文字：下一题 / 提交，始终展示 -->
        <view v-if="!isLastSlot" class="slot-drawer__action-text" @tap="nextSlot">
          下一题
        </view>
        <view v-else class="slot-drawer__action-text" @tap="submit">
          提交
        </view>

        <!-- 占位，把关闭按钮推到最右侧 -->
        <view class="slot-drawer__toolbar-spacer" />

        <!-- 右侧：关闭 -->
        <view class="slot-drawer__close" @tap="close">
          <image class="slot-drawer__close-icon" :src="CloseIcon" mode="aspectFit" />
        </view>
      </view>

      <!-- 题目标题：Status Label -->
      <text class="slot-drawer__title">
        {{ currentSlot.title || "请选择要查询的设备" }}
      </text>

      <!-- 选项列表 -->
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
            <!-- 仅第一项显示"推荐"标签 -->
            <view v-if="index === 0" class="slot-drawer__recommend">
              <text class="slot-drawer__recommend-text">
                推荐
              </text>
            </view>
          </view>

          <!-- 其他关注指标输入区：Frame 7 -->
          <textarea
            v-model="otherRemark"
            class="slot-drawer__remark"
            placeholder="其他关注指标"
            :maxlength="200"
            :auto-height="false"
          />
        </view>
      </scroll-view>
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

/* =========================================================
   弹框主体：Rectangle 25
   设计稿尺寸 375×383(px) => 750×766(rpx)
   背景 #FFFFFF，阴影 0 -2 21 rgba(0,0,0,0.0601)
   ========================================================= */
.slot-drawer {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 40rpx 80rpx calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  border-radius: 40rpx 40rpx 0 0;
  background: #FFFFFF;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  animation: slot-drawer-slide-up 0.25s ease-out;
}

/* =========================================================
   顶部操作行：包含答题进度、翻页按钮、下一题/提交、关闭
   ========================================================= */
.slot-drawer__toolbar {
  display: flex;
  align-items: center;
  height: 52rpx;
}

/* 答题 1/4：14px => 28rpx，颜色 #999999，间距 4px => 8rpx */
.slot-drawer__progress {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8rpx;
  color: #999999;
  font-size: 28rpx;
  line-height: 34rpx;
}

/* 翻页按钮组：上一题、下一题两个 26×26 圆形按钮，按钮间距 4px => 8rpx
   设计稿中 progress 右边缘到 nav 左边缘约 42px => 84rpx */
.slot-drawer__nav {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8rpx;
  width: 112rpx;
  margin-left: 84rpx;
}

/* 单题占位：隐藏按钮但保留 112rpx 宽度，让提交位置不变 */
.slot-drawer__nav--placeholder {
  visibility: hidden;
}

/* 下一题 / 提交 操作文字
   设计稿中 nav 到 action text 约 10px => 20rpx */
.slot-drawer__action-text {
  flex-shrink: 0;
  margin-left: 20rpx;
  color: #666666;
  font-size: 32rpx;
  line-height: 38rpx;
}

/* 占位元素：将关闭按钮推到最右侧 */
.slot-drawer__toolbar-spacer {
  flex: 1;
  min-width: 0;
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

/* =========================================================
   题目标题：Status Label
   设计稿 y:493，字号 14px => 28rpx，颜色 #1A1A1A
   与操作行间距 16px => 32rpx
   ========================================================= */
.slot-drawer__title {
  margin-top: 32rpx;
  color: #1A1A1A;
  font-size: 28rpx;
  line-height: 34rpx;
}

/* =========================================================
   选项列表区域
   与标题间距 16px => 32rpx
   多选状态裁剪高度 237px => 474rpx
   ========================================================= */
.slot-drawer__options {
  margin-top: 32rpx;
  max-height: 474rpx;
}

.slot-drawer__options-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
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
   其他关注指标输入区：Frame 7
   设计稿 295×105 => 590×210，背景 #F6F6F6，圆角 12px => 24rpx
   内边距 16px => 32rpx，占位文字 12px/20px => 24rpx/40rpx，颜色 #999999
   ========================================================= */
.slot-drawer__remark {
  width: 590rpx;
  height: 210rpx;
  padding: 32rpx;
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

@keyframes slot-drawer-fade-in {
  from { background: rgba(0, 0, 0, 0); }
  to { background: rgba(0, 0, 0, 0.38); }
}

@keyframes slot-drawer-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
</style>

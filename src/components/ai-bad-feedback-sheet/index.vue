<script setup lang="ts">
import { ref, watch } from "vue";
// import { useSafeArea } from "@/hooks/useSafeArea";

defineOptions({
  name: "AiBadFeedbackSheet",
});

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  options: {
    type: Array,
    default: () => [
      { value: "data_inaccurate", label: "数据不准确" },
      { value: "data_incomplete", label: "数据不完整" },
      { value: "answer_not_match", label: "没有回答到重点" },
      { value: "answer_incomplete", label: "回答不够详细或不易理解" },
      { value: "response_slow", label: "回答速度太慢" },
    ],
  },
});

const emit = defineEmits(["close", "confirm"]);
// const { safeAreaStyle } = useSafeArea({ mpaasFallbackPx: 0 });
const selectedValue = ref([]);
const supplement = ref("");

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedValue.value = [];
      supplement.value = "";
    }
  },
);

function onClose() {
  emit("close");
}

function onOptionTap(value: string) {
  selectedValue.value = [value];
  const option = props.options.find(item => item.value === value);
  emit("confirm", {
    remark: option?.label || option?.labelKey || value,
    immediate: true,
  });
}

function onSupplementInput(event: { detail: { value: string } }) {
  supplement.value = event?.detail?.value || "";
}

function onConfirm() {
  if (selectedValue.value.length === 0 && !supplement.value) return;

  const chosen = props.options
    .filter(option => selectedValue.value.includes(option.value))
    .map(option => option.label || option.labelKey)
    .join(",");
  emit("confirm", {
    remark: [chosen, supplement.value].filter(Boolean).join(","),
    immediate: false,
  });
}
</script>

<template>
  <view v-if="visible" class="bad-feedback-sheet">
    <view class="bad-feedback-sheet__mask" @tap="onClose" />
    <view class="bad-feedback-sheet__panel" @tap.stop>
      <view class="bad-feedback-sheet__header">
        <view class="bad-feedback-sheet__title-wrap">
          <text class="bad-feedback-sheet__title">
            意见反馈
          </text>
          <text class="bad-feedback-sheet__subtitle">
            你的反馈是我们持续进步的方向
          </text>
        </view>
        <view class="bad-feedback-sheet__close-btn" @tap="onClose">
          <image
            src="@/assets/img/icon-close.svg"
            mode="aspectFit"
            class="bad-feedback-sheet__close-btn-icon"
          />
        </view>
      </view>
      <view class="bad-feedback-sheet__body">
        <view class="bad-feedback-sheet__options">
          <view
            v-for="opt in options"
            :key="opt.value"
            class="bad-feedback-sheet__option"
            :class="{
              'bad-feedback-sheet__option--active': selectedValue.includes(opt.value),
            }"
            @tap="onOptionTap(opt.value)"
          >
            <view class="bad-feedback-sheet__option-text-wrap">
              <text class="bad-feedback-sheet__option-text">
                {{ opt.label || opt.labelKey }}
              </text>
            </view>
            <view
              v-if="selectedValue.includes(opt.value)"
              class="bad-feedback-sheet__option-icon-wrap"
            >
              <image
                src="@/assets/img/icon-selected.svg"
                mode="aspectFit"
                class="bad-feedback-sheet__option-icon"
              />
            </view>
          </view>
        </view>

        <view class="bad-feedback-sheet__input-wrap">
          <textarea
            class="bad-feedback-sheet__textarea"
            :value="supplement"
            placeholder="请输入其他反馈问题"
            placeholder-class="bad-feedback-sheet__textarea-placeholder"
            @input="onSupplementInput"
          />
        </view>
      </view>

      <view class="bad-feedback-sheet__actions">
        <view class="bad-feedback-sheet__btn bad-feedback-sheet__btn--primary" @tap="onConfirm">
          <text class="bad-feedback-sheet__btn-text bad-feedback-sheet__btn-text--primary">
            提交反馈
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.bad-feedback-sheet {
  position: fixed;
  inset: 0;
  z-index: 60;
}

.bad-feedback-sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.bad-feedback-sheet__panel {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  height: 1200rpx;
  padding: 40rpx 60rpx 70rpx;
  overflow: hidden;
  border-radius: 40rpx 40rpx 0 0;
  background: #ffffff;
}

.bad-feedback-sheet__header {
  position: relative;
  height: 136rpx;
}

.bad-feedback-sheet__title-wrap {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.bad-feedback-sheet__title {
  color: #1a1a1a;
  font-family: Inter;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 38rpx;
}

.bad-feedback-sheet__subtitle {
  color: #999999;
  font-family: Inter;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 32rpx;
}

.bad-feedback-sheet__close-btn {
  position: absolute;
  top: -20rpx;
  right: -30rpx;
  width: 72rpx;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bad-feedback-sheet__close-btn-icon {
  width: 72rpx;
  height: 72rpx;
}

.bad-feedback-sheet__body {
  overflow: hidden;
}

.bad-feedback-sheet__options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.bad-feedback-sheet__option {
  box-sizing: border-box;
  height: 96rpx;
  padding: 0;
  border: 2rpx solid #e4e4e4;
  border-radius: 32rpx;
  background: #fefefe;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bad-feedback-sheet__option--active {
  border-color: #c8201e;
  background: #fff3f3;
}

.bad-feedback-sheet__option-text-wrap {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
}

.bad-feedback-sheet__option-text {
  color: #666666;
  font-family: Inter;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 34rpx;
  text-align: center;
}

.bad-feedback-sheet__option-icon-wrap {
  display: none;
}

.bad-feedback-sheet__option--active .bad-feedback-sheet__option-text {
  color: #c8201e;
}

.bad-feedback-sheet__input-wrap {
  box-sizing: border-box;
  height: 276rpx;
  margin-top: 34rpx;
  padding: 32rpx;
  overflow: hidden;
  border: 0;
  border-radius: 24rpx;
  background: #f6f6f6;
}

.bad-feedback-sheet__textarea {
  width: 100%;
  height: 200rpx;
  color: #666666;
  font-family: "Sarasa Gothic SC";
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
}

.bad-feedback-sheet__textarea-placeholder {
  color: #999999;
  font-family: "Sarasa Gothic SC";
  font-style: italic;
  font-weight: 400;
}

.bad-feedback-sheet__actions {
  display: flex;
  margin-top: 20rpx;
}

.bad-feedback-sheet__btn {
  flex: 1;
  height: 80rpx;
  border-radius: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bad-feedback-sheet__btn--primary {
  background: #c8201e;
}

.bad-feedback-sheet__btn-text {
  color: #ffffff;
  font-family: Inter;
  font-size: 26rpx;
  font-weight: 700;
  line-height: 32rpx;
}
</style>

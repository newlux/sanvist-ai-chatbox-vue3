<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

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
      { value: "answer_not_right", labelKey: "feedback-opt-answer_not_right" },
      { value: "data_inaccurate", labelKey: "feedback-opt-data_inaccurate" },
      { value: "answer_not_match", labelKey: "feedback-opt-answer_not_match" },
      { value: "answer_incomplete", labelKey: "feedback-opt-answer_incomplete" },
      { value: "response_slow", labelKey: "feedback-opt-response_slow" },
      { value: "other", labelKey: "feedback-opt-other" },
    ],
  },
});

const emit = defineEmits(["close", "confirm"]);
const { t } = useI18n();
const selectedValue = ref([]);
const supplement = ref("");

watch(() => props.visible, (visible) => {
  if (visible) {
    selectedValue.value = [];
    supplement.value = "";
  }
});

function onClose() {
  emit("close");
}

function onOptionTap(value) {
  selectedValue.value = selectedValue.value.includes(value)
    ? selectedValue.value.filter(item => item !== value)
    : [...selectedValue.value, value];
}

function onSupplementInput(event) {
  supplement.value = event?.detail?.value || "";
}

function onConfirm() {
  if (selectedValue.value.length === 0 && !supplement.value) return;

  const chosen = props.options
    .filter(option => selectedValue.value.includes(option.value))
    .map(option => option.label || t(option.labelKey))
    .join(",");
  emit("confirm", [chosen, supplement.value].join(","));
}
</script>

<template>
  <view v-if="visible" class="bad-feedback-sheet">
    <view class="bad-feedback-sheet__mask" @tap="onClose" />
    <view class="bad-feedback-sheet__panel" @tap.stop>
      <view class="bad-feedback-sheet__header">
        <view>
          <text class="bad-feedback-sheet__title">
            {{ t("feedback-thank-you") }}
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
              'bad-feedback-sheet__option--active': selectedValue.includes(
                opt.value,
              ),
            }"
            @tap="onOptionTap(opt.value)"
          >
            <view class="bad-feedback-sheet__option-text-wrap">
              <text class="bad-feedback-sheet__option-text">
                {{ opt.label || t(opt.labelKey) }}
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
            :placeholder="t('feedback-supplement-placeholder')"
            placeholder-class="bad-feedback-sheet__textarea-placeholder"
            @input="onSupplementInput"
          />
        </view>
      </view>

      <view class="bad-feedback-sheet__actions">
        <view
          class="bad-feedback-sheet__btn bad-feedback-sheet__btn--primary"
          @tap="onConfirm"
        >
          <text
            class="bad-feedback-sheet__btn-text bad-feedback-sheet__btn-text--primary"
          >
            {{ t("feedback-submit") }}
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
  left: 0;
  right: 0;
  bottom: 0;
  background: #ffffff;
  border-top-left-radius: 32rpx;
  border-top-right-radius: 32rpx;
  padding: 24rpx 48rpx calc(32rpx + constant(safe-area-inset-bottom));
  padding: 24rpx 48rpx calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.bad-feedback-sheet__header {
  padding-bottom: 18rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bad-feedback-sheet__close-btn {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bad-feedback-sheet__close-btn-icon {
  width: 32rpx;
  height: 32rpx;
}

.bad-feedback-sheet__title {
  font-size: 32rpx;
  color: #2f323c;
  font-weight: 700;
}

.bad-feedback-sheet__body {
  max-height: 55vh;
  overflow-y: auto;
}

.bad-feedback-sheet__options {
  display: flex;
  flex-wrap: wrap;
  gap: 24rpx;
  margin-bottom: 24rpx;
  flex-direction: column;
}

.bad-feedback-sheet__option {
  padding: 28rpx 32rpx;
  border-radius: 18rpx;
  background: #f0f0f0;
  display: flex;
  align-items: center;
}

.bad-feedback-sheet__option--active {
  background: #fff5f6;
}
.bad-feedback-sheet__option-text-wrap {
  flex: 1;
  display: flex;
  align-items: center;
}
.bad-feedback-sheet__option-text {
  font-size: 28rpx;
  color: #5f6775;
}

.bad-feedback-sheet__option-icon-wrap {
  width: 32rpx;
  height: 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bad-feedback-sheet__option-icon {
  width: 20rpx;
  height: 14rpx;
}
.bad-feedback-sheet__option--active .bad-feedback-sheet__option-text {
  color: #f8315e;
}

.bad-feedback-sheet__input-wrap {
  padding: 28rpx 32rpx;
  overflow: hidden;
  border-radius: 20rpx;
  background: #f8f8f8;
}

.bad-feedback-sheet__textarea {
  width: 100%;
  height: 80rpx;

  color: #5f6775;
  font-size: 28rpx;
}

.bad-feedback-sheet__textarea-placeholder {
  color: #9aa0a6;
}

.bad-feedback-sheet__actions {
  display: flex;
  margin-top: 22rpx;
  // padding: 0 48rpx;
}

.bad-feedback-sheet__btn {
  flex: 1;
  border-radius: 16rpx;
  height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bad-feedback-sheet__btn--primary {
  background: #f8315e;
}

.bad-feedback-sheet__btn-text {
  font-size: 28rpx;
  font-weight: 700;
  color: #ffffff;
}
</style>

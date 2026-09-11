<script setup lang="ts">
import type { DeviceModelOption } from "@/api/user-role/device-models";

/**
 * 机型选择卡片：底部弹起，标题 + 机型单选列表。
 * 展示 modelName，选中值对外给 modelKey（作业指导页取它作为 inputs.device_model）；
 * 页面不留触发入口，由作业指导页在进入时把它弹起来；选中即收起。
 *
 * 视觉参照设计稿底部卡片：直角白板 + 向上阴影 + 顶部灰色小标签 + 右上 × + 紧凑选项列表
 * （默认 #f6f6f6 / 选中 #2f2b2b 反白），底部居中提示。
 */
defineOptions({ name: "AiDeviceModelPicker" });

withDefaults(defineProps<{
  models: DeviceModelOption[];
  modelValue?: string;
  visible?: boolean;
}>(), {
  modelValue: "",
  visible: false,
});

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "update:visible", value: boolean): void;
}>();

function closeSheet() {
  emit("update:visible", false);
}

/** 选中即生效并收起卡片，之前的输入 / 发送流程不受影响 */
function selectModel(modelKey: string) {
  emit("update:modelValue", modelKey);
  closeSheet();
}
</script>

<template>
  <view v-if="visible" class="device-model__sheet">
    <view class="device-model__header">
      <text class="device-model__label">
        选择机型
      </text>
      <view class="device-model__close" @tap="closeSheet">
        <image
          class="device-model__close-icon"
          src="@/assets/img/icon-close.svg"
          mode="aspectFit"
        />
      </view>
    </view>

    <text class="device-model__desc">
      选择机型以获取更精准的回答
    </text>

    <view class="device-model__options">
      <view
        v-for="item in models"
        :key="item.modelKey"
        class="device-model__option"
        :class="{ 'device-model__option--active': item.modelKey === modelValue }"
        @tap="selectModel(item.modelKey)"
      >
        <text class="device-model__option-label">
          {{ item.modelName }}
        </text>
      </view>
    </view>

    <text class="device-model__footer">
      内容由AI生成，请核实重要信息
    </text>
  </view>
</template>

<style lang="scss" scoped>
/* 直角白板贴底，仅留向上阴影；safe-area 留给底部 home indicator */
.device-model__sheet {
  position: fixed;
  z-index: 1001;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-radius: 22px 22px 0 0;
  padding: 42rpx 80rpx 24rpx;
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06);
}

.device-model__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36rpx;
}

.device-model__label {
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 36rpx;
  color: #666666;
}

.device-model__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48rpx;
  height: 36rpx;
  margin-right: -12rpx;
}

.device-model__close-icon {
  width: 36rpx;
  height: 36rpx;
}

.device-model__desc {
  display: block;
  margin-top: 16rpx;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #1a1a1a;
}

.device-model__options {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 32rpx;
}

.device-model__option {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
  height: 72rpx;
  padding: 0 32rpx;
  border-radius: 16rpx;
  background: #f6f6f6;
}

.device-model__option--active {
  background: #2f2b2b;
}

.device-model__option-label {
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 400;
  line-height: 40rpx;
  color: #000000;
}

.device-model__option--active .device-model__option-label {
  color: #ffffff;
}

.device-model__footer {
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
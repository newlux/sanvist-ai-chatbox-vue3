<script setup lang="ts">
/**
 * 附件来源弹窗：拍照 / 从相册选择 / 选择文件。
 *
 * 输入栏左侧「+」与步骤卡的附件按钮共用这一个弹窗，保证两处交互与样式完全一致；
 * 容器内原生选择器可用时不弹它（原生弹窗本身就有这三项）。
 */
defineOptions({ name: "AiAttachmentPicker" });

defineProps({
  visible: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "pick", source: "camera" | "album" | "file"): void;
}>();
</script>

<template>
  <view
    v-if="visible"
    class="attachment-picker-mask"
    @tap.stop="emit('update:visible', false)"
  >
    <view class="attachment-picker" @tap.stop>
      <view class="attachment-picker__title"> 添加附件 </view>
      <view class="attachment-picker__btn" @tap="emit('pick', 'camera')"> 拍照 </view>
      <view class="attachment-picker__btn" @tap="emit('pick', 'album')">
        从相册选择
      </view>
      <view class="attachment-picker__btn" @tap="emit('pick', 'file')"> 选择文件 </view>
      <view class="attachment-picker__cancel" @tap="emit('update:visible', false)"> 取消 </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* ---------- 附件来源弹窗 ---------- */
.attachment-picker-mask {
  position: fixed;
  z-index: 1000;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.attachment-picker {
  width: 560rpx;
  border-radius: 24rpx;
  background: #ffffff;
  overflow: hidden;
}

.attachment-picker__title {
  padding: 32rpx 0 20rpx;
  font-size: 28rpx; // 14px
  font-weight: 600;
  color: #333333;
  line-height: 36rpx;
  text-align: center;
}

.attachment-picker__btn,
.attachment-picker__cancel {
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx; // 15px
  line-height: 40rpx;
  border-top: 1rpx solid #f0f0f0;
  box-sizing: border-box;

  &:active {
    background: #f5f5f5;
  }
}

.attachment-picker__btn {
  color: #1a1a1a;
}

.attachment-picker__cancel {
  color: #999999;
}
</style>

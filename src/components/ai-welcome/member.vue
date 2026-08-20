<script setup lang="ts">
defineOptions({ name: "AiWelcomeMember" });

const emit = defineEmits(["start-chat"]);
</script>

<template>
  <view class="welcome-member">
    <view class="welcome-member__content">
      <view class="welcome-member__capability">
        <text class="welcome-member__index">
          01
        </text>
        <text class="welcome-member__title">
          少跑现场少翻表，
        </text>
        <text class="welcome-member__title">
          设备有事早知道。
        </text>
        <text class="welcome-member__description">
          日常运营AI助手
        </text>
      </view>
      <view class="welcome-member__capability">
        <text class="welcome-member__index">
          02
        </text>
        <text class="welcome-member__title">
          师傅远在千里，
        </text>
        <text class="welcome-member__title">
          经验近在车上。
        </text>
        <text class="welcome-member__description">
          操作指导AI助手
        </text>
      </view>
      <view class="welcome-member__capability">
        <text class="welcome-member__index">
          03
        </text>
        <text class="welcome-member__title">
          排得出计划，
        </text>
        <text class="welcome-member__title">
          也接得住变化。
        </text>
        <text class="welcome-member__description">
          任务协同AI助手
        </text>
      </view>
    </view>
    <view class="welcome-member__footer">
      <view class="welcome-member__button" @tap="emit('start-chat')">
        <text>开始使用</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.welcome-member {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.welcome-member__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  margin: 36rpx 0 46rpx;
  padding: 0 56rpx;
}

.welcome-member__capability {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 12rpx;
  padding: 40rpx 0;

  &:not(:first-child) {
    border-top: 1px solid rgba(255, 255, 255, 0.18);
  }
}

.welcome-member__index {
  margin-bottom: 12rpx;
  color: rgba(255, 255, 255, 0.5);
  font-size: 48rpx;
  font-weight: 300;
  line-height: 1.2;
}

.welcome-member__title {
  font-size: 80rpx;
  font-weight: 700;
  letter-spacing: -2rpx;
  line-height: 1.13;
}

.welcome-member__description {
  margin-top: 12rpx;
  color: rgba(255, 255, 255, 0.75);
  font-size: 40rpx;
  line-height: 1.3;
}

.welcome-member__footer {
  padding: 0 48rpx 32rpx;
  margin-bottom: 76rpx;
}

.welcome-member__button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 104rpx;
  border-radius: 52rpx;
  background: #fff;
  color: #a31717;
  font-size: 36rpx;
  font-weight: 800;
  line-height: 44rpx;
}
</style>

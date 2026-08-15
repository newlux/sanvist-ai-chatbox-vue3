<script setup lang="ts">
import type { VisitorRole } from "@/stores";
import { ref } from "vue";
import iconBoss from "@/assets/img/icon-boss.png";
import iconOperator from "@/assets/img/icon-operator.png";
import { useUserStore } from "@/stores";

defineOptions({ name: "RoleSelectPage" });

interface RoleOption {
  value: VisitorRole;
  label: string;
  description: string;
  deviceSummary: string;
  deviceDetail: string;
  avatar?: string;
}

const userStore = useUserStore();
const selectedRole = ref<VisitorRole | null>(null);

const roles: RoleOption[] = [
  {
    value: "OWNER",
    label: "老板",
    description: "从整体运营视角，了解设备的状态与变化。",
    deviceSummary: "已为你绑定 5 台体验设备",
    deviceDetail: "2 台塔吊 · 3 台泵车",
    avatar: iconBoss,
  },
  {
    value: "OPERATOR",
    label: "操作手",
    description: "聚焦自己正在使用的设备，快速了解工况。",
    deviceSummary: "已为你绑定 1 台体验设备",
    deviceDetail: "1 台泵车",
    avatar: iconOperator,
  },
];

function selectRole(role: VisitorRole) {
  selectedRole.value = role;
}

function startChat() {
  if (!selectedRole.value) {
    uni.showToast({ title: "请选择角色", icon: "none" });
    return;
  }
  userStore.setVisitorRole(selectedRole.value);
  uni.redirectTo({ url: "/pages/index/index" });
}
</script>

<template>
  <view class="role-select">
    <view class="phone-bg" />
    <view class="glow glow-blue" />
    <view class="glow glow-red" />
    <view class="content">
      <text class="page-title">
        选择你的体验身份
      </text>
      <view
        v-for="role in roles"
        :key="role.value"
        class="identity-card"
        :class="{ 'card-selected': selectedRole === role.value }"
        @tap="selectRole(role.value)"
      >
        <view class="card-avatar">
          <image v-if="role.avatar" class="card-avatar__image" :src="role.avatar" mode="aspectFill" />
        </view>
        <view class="card-info">
          <text class="card-name">
            {{ role.label }}
          </text>
          <text class="card-desc">
            {{ role.description }}
          </text>
          <text class="card-meta">
            {{ role.deviceSummary }}
          </text>
          <text class="card-detail">
            {{ role.deviceDetail }}
          </text>
        </view>
      </view>
      <view class="primary-btn" @tap="startChat">
        <text>开始体验</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
$color-text-primary: #1a1a1a;
$color-text-secondary: #999;
$color-text-muted: #666;
$color-btn-red: #a31717;
$color-card-bg: #fff;
$color-card-selected-bg: #fff6f6;
$color-card-selected-border: #f00;
$color-avatar-bg: #e4e4e4;
$color-bg-start: #f5f3f7;
$color-bg-end: #e8e4ee;

.role-select {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.phone-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(to bottom, $color-bg-start 0%, $color-bg-end 100%);
}

.glow {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.glow-blue {
  top: 688rpx;
  left: -560rpx;
  width: 1250rpx;
  height: 746rpx;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(123, 167, 217, 0.22) 0%,
    rgba(123, 167, 217, 0) 70%
  );
  transform: rotate(-45deg);
}

.glow-red {
  top: 1530rpx;
  left: -150rpx;
  width: 1376rpx;
  height: 534rpx;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(255, 60, 60, 0.15) 0%,
    rgba(255, 60, 60, 0) 70%
  );
  filter: blur(46rpx);
  transform: rotate(-53.5deg);
}

.content {
  position: relative;
  z-index: 5;
  padding: 0 60rpx;
}

.page-title {
  display: block;
  margin-bottom: 52rpx;
  color: $color-text-primary;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 68rpx;
}

.identity-card {
  display: flex;
  box-sizing: border-box;
  width: 630rpx;
  height: 244rpx;
  align-items: flex-start;
  gap: 26rpx;
  margin-bottom: 20rpx;
  padding: 36rpx 28rpx 32rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  background: $color-card-bg;
}

.card-selected {
  border-color: $color-card-selected-border;
  background: $color-card-selected-bg;
}

.card-avatar {
  width: 102rpx;
  height: 102rpx;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 50%;
  background: $color-avatar-bg;
}

.card-avatar__image {
  width: 100%;
  height: 100%;
}

.card-info {
  min-width: 0;
  flex: 1;
  padding-top: 4rpx;
}

.card-name {
  display: block;
  margin-bottom: 14rpx;
  color: $color-text-primary;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 44rpx;
}

.card-desc {
  display: block;
  margin-bottom: 10rpx;
  color: $color-text-secondary;
  font-size: 22rpx;
  font-weight: 500;
  line-height: 30rpx;
}

.card-meta,
.card-detail {
  display: block;
  color: $color-text-muted;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 34rpx;
}

.primary-btn {
  display: flex;
  width: 630rpx;
  height: 104rpx;
  align-items: center;
  justify-content: center;
  margin-top: 52rpx;
  border-radius: 52rpx;
  background: $color-card-bg;
  color: $color-btn-red;
  font-size: 36rpx;
  font-weight: 700;
  line-height: 44rpx;
}
</style>

<script setup lang="ts">
import { onMounted } from "vue";
import { getRoleOptions } from "@/api/user-role";
import { VISITOR_ROLE_OPTIONS_CACHE_KEY } from "@/config";
import { createLogger } from "@/utils/logger";

defineOptions({ name: "AiWelcomeVisitor" });
const logger = createLogger("visitor");
// 欢迎页挂载即预取角色选项并缓存，进入角色选择页时直接使用，避免页面加载闪动
onMounted(async () => {
  try {
    const result = await getRoleOptions();
    const roles = result?.roles ?? [];
    if (roles.length) {
      uni.setStorageSync(VISITOR_ROLE_OPTIONS_CACHE_KEY, roles);
    }
  } catch (error) {
    logger.warn("failed to prefetch role options", error);
  }
});

function goToRoleSelect() {
  uni.navigateTo({ url: "/pages/role-select/index" });
}
</script>

<template>
  <view class="welcome-visitor">
    <view class="welcome-visitor__content">
      <view class="welcome-visitor__title">
        <text>游客模式</text>
        <text>体验AI助手</text>
        <text>Noyi</text>
      </view>
      <view class="welcome-visitor__note">
        <view class="welcome-visitor__description">
          <text>我们为你准备了模拟设备，</text>
          <text>你可以在游客模式下体验以下能力。</text>
        </view>
        <view class="welcome-visitor__features">
          <text>体验车型：混凝土泵车、履带吊</text>
          <text>体验功能：AI问问</text>
        </view>
      </view>
    </view>
    <view class="welcome-visitor__footer">
      <view
        class="welcome-visitor__button"
        hover-class="welcome-visitor__button--pressed"
        @tap="goToRoleSelect"
      >
        <text>开始体验</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.welcome-visitor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.welcome-visitor__content {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
}

.welcome-visitor__title {
  display: flex;
  flex-direction: column;
  width: calc(100% - 96rpx);
  margin: 200rpx 48rpx 0;
  color: #fff;
  font-size: 84rpx;
  font-weight: 700;
  line-height: 102rpx;
}

.welcome-visitor__note {
  margin-bottom: 256rpx;
  padding: 0 58rpx;
}

.welcome-visitor__description,
.welcome-visitor__features {
  display: flex;
  flex-direction: column;
  color: rgba(255, 255, 255, 0.6);
  font-size: 32rpx;
  line-height: 1.5;
}

.welcome-visitor__description {
  margin-top: auto;
  margin-bottom: 40rpx;
}

.welcome-visitor__footer {
  padding: 0 48rpx 32rpx;
  margin-bottom: 76rpx;
}

.welcome-visitor__button {
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

.welcome-visitor__button--pressed {
  opacity: 0.85;
}
</style>

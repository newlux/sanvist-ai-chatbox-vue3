<script setup lang="ts">
import type { OperatorRoleOption, OperatorRolesData } from "@/api/user-role/operator-roles";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getOperatorRoles } from "@/api/user-role";
import { OPERATOR_ROLE_KEYS, toOperatorRoleOption } from "@/api/user-role/operator-roles";
import iconNovice from "@/assets/img/icon-guide-mode-novice.png";
import iconSkilled from "@/assets/img/icon-guide-mode-skilled.png";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";

/**
 * 讲解模式选择页（设计稿 6356:12「选择身份」）。
 *
 * 跳转作业指导时先经过这里：接口 /user/operator-roles 给新老手两档
 * （novice_operator 新手 / skilled_operator 老手），点选后把对应值写进 user store，
 * 由作业指导页每次对话作为 inputs.operator_role 透传给 Dify（与 device_model 同一套路）。
 * 选中即进入作业指导，页面上不留二次确认。
 */
defineOptions({ name: "OperatorModePage" });

/** 选中态先亮一下再跳转，避免点下去没有反馈 */
const REDIRECT_DELAY_MS = 180;

const logger = createLogger("operator-mode");
const userStore = useUserStore();

const rolesData = ref<OperatorRolesData | null>(null);
const selectedKey = ref("");
let redirectTimer: ReturnType<typeof setTimeout> | null = null;

/** 顺序与设计稿一致：资深在前、需要带教在后 */
const options = computed<OperatorRoleOption[]>(() => [
  { ...toOperatorRoleOption(rolesData.value?.skilled_operator, OPERATOR_ROLE_KEYS.skilled), avatar: iconSkilled },
  { ...toOperatorRoleOption(rolesData.value?.novice_operator, OPERATOR_ROLE_KEYS.novice), avatar: iconNovice },
]);

async function loadOperatorRoles() {
  try {
    rolesData.value = await getOperatorRoles();
  } catch (error) {
    // 接口异常也要能进作业指导：用设计稿兜底文案渲染
    logger.warn("failed to load operator roles", error);
    rolesData.value = null;
  }
}

function onSelect(option: OperatorRoleOption) {
  if (redirectTimer) return;
  selectedKey.value = option.roleKey;
  userStore.setOperatorRole(option);
  redirectTimer = setTimeout(() => {
    redirectTimer = null;
    uni.redirectTo({ url: "/pages/guide/index" });
  }, REDIRECT_DELAY_MS);
}

onMounted(loadOperatorRoles);
onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer);
});
</script>

<template>
  <view class="operator-mode">
    <view class="glow glow-blue" />
    <view class="glow glow-red" />

    <view class="operator-mode__content">
      <text class="operator-mode__title">
        选择适合你的讲解模式
      </text>

      <view class="operator-mode__list">
        <view
          v-for="option in options"
          :key="option.roleKey"
          class="mode-card"
          :class="{ 'mode-card--selected': selectedKey === option.roleKey }"
          @tap="onSelect(option)"
        >
          <view class="mode-card__avatar">
            <image v-if="option.avatar" class="mode-card__avatar-img" :src="option.avatar" mode="aspectFill" />
          </view>
          <view class="mode-card__info">
            <text class="mode-card__name">
              {{ option.roleName }}
            </text>
            <text class="mode-card__desc">
              {{ option.description }}
            </text>
            <text class="mode-card__tag">
              {{ option.tag }}
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
$color-text-primary: #1a1a1a;
$color-text-secondary: #999999;
$color-text-muted: #666666;
$color-card-bg: #ffffff;
$color-card-selected-bg: #fff6f6;
$color-card-selected-border: #cf1a2a;
$color-avatar-bg: #e4e4e4;

.operator-mode {
  position: relative;
  min-height: 100vh;
  box-sizing: border-box;
  overflow: hidden;
  /* 标题在页面 1/4 处：状态栏 54px + 153px 间距（设计稿 207px） */
  padding: calc(env(safe-area-inset-top) + 300rpx) 60rpx 0;
  background: #f5f5f5;
}

.glow {
  position: absolute;
  z-index: 0;
  pointer-events: none;
}

/* 设计稿 Blue Glow TL：625×373，旋转 -45°，落在左侧中部 */
.glow-blue {
  top: 688rpx;
  left: -560rpx;
  width: 1250rpx;
  height: 746rpx;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(123, 167, 217, 0.1) 0%,
    rgba(123, 167, 217, 0) 70%
  );
  transform: rotate(-45deg);
}

/* 设计稿 Red Glow TR：687×267，旋转 -53.5°，落在底部 */
.glow-red {
  top: 1530rpx;
  left: -150rpx;
  width: 1376rpx;
  height: 534rpx;
  background: radial-gradient(
    circle at 50% 50%,
    rgba(254, 0, 0, 0.07) 0%,
    rgba(254, 0, 0, 0) 70%
  );
  filter: blur(46rpx);
  transform: rotate(-53.5deg);
}

.operator-mode__content {
  position: relative;
  z-index: 1;
}

.operator-mode__title {
  display: block;
  color: $color-text-primary;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 48rpx;
  font-weight: 700;
  line-height: 56rpx;
}

.operator-mode__list {
  margin-top: 64rpx;
}

/* 卡片：630×244，圆角 12px，白底；选中态粉底 + 红边（设计稿 Rectangle 22） */
.mode-card {
  display: flex;
  align-items: flex-start;
  box-sizing: border-box;
  width: 100%;
  min-height: 244rpx;
  gap: 24rpx;
  margin-bottom: 20rpx;
  padding: 36rpx;
  border: 2rpx solid transparent;
  border-radius: 24rpx;
  background: $color-card-bg;
}

.mode-card--selected {
  border-color: $color-card-selected-border;
  background: $color-card-selected-bg;
}

.mode-card__avatar {
  width: 102rpx;
  height: 102rpx;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 50%;
  background: $color-avatar-bg;
}

.mode-card__avatar-img {
  width: 100%;
  height: 100%;
}

.mode-card__info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.mode-card__name {
  color: $color-text-primary;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 38rpx;
}

.mode-card__desc {
  margin-top: 20rpx;
  white-space: pre-wrap;
  color: $color-text-secondary;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 30rpx;
  white-space: nowrap;
}

.mode-card__tag {
  margin-top: 28rpx;
  color: $color-text-muted;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 30rpx;
}
</style>

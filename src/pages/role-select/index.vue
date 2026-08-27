<script setup lang="ts">
import type { RoleOption } from "@/api/user-role/role-options";
import type { VisitorRole } from "@/stores";
import { computed, onMounted, ref } from "vue";
import { getRoleOptions, getTodayAwakeningPrompt } from "@/api/user-role";
import iconBoss from "@/assets/img/icon-boss.png";
import iconOperator from "@/assets/img/icon-operator.png";
import { VISITOR_ROLE_OPTIONS_CACHE_KEY } from "@/config";
import { DEFAULT_CHAT_SCOPE, useChatStore, useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { isGuestRole, setGuestRole } from "@/utils/request";

defineOptions({ name: "RoleSelectPage" });
const logger = createLogger("role-select");
interface ViewRole extends RoleOption {
  value: VisitorRole;
  description: string;
  avatar?: string;
  deviceSummary: string;
  deviceDetail: string;
}

const ROLE_DESCRIPTIONS: Record<VisitorRole, { description: string; avatar?: string }> = {
  OWNER: {
    description: "从整体运营视角，了解设备的状态与变化。",
    avatar: iconBoss,
  },
  OPERATOR: {
    description: "聚焦自己正在使用的设备，快速了解工况。",
    avatar: iconOperator,
  },
  ADMIN: { description: "" },
  MAINTAINER: { description: "" },
  PURCHASER: { description: "" },
};

function formatSummary(role: RoleOption) {
  return `已为你绑定 ${role.deviceCount} 台体验设备`;
}

function formatDetail(role: RoleOption) {
  if (!role.deviceTypeSummary?.length) return "";
  return role.deviceTypeSummary
    .map(item => `${item.count} 台${item.deviceTypeName || item.deviceType}`)
    .join(" · ");
}

function mapToViewRole(role: RoleOption): ViewRole | null {
  if (!isGuestRole(role.roleCode)) return null;
  const meta = ROLE_DESCRIPTIONS[role.roleCode];
  return {
    ...role,
    value: role.roleCode,
    description: meta?.description ?? "",
    avatar: meta?.avatar,
    deviceSummary: formatSummary(role),
    deviceDetail: formatDetail(role),
  };
}

const FALLBACK_ROLES: ViewRole[] = [
  {
    roleCode: "OWNER",
    roleName: "老板",
    deviceCount: 0,
    deviceTypeSummary: [],
    value: "OWNER",
    description: ROLE_DESCRIPTIONS.OWNER.description,
    avatar: ROLE_DESCRIPTIONS.OWNER.avatar,
    deviceSummary: "已为你绑定体验设备",
    deviceDetail: "",
  },
  {
    roleCode: "OPERATOR",
    roleName: "操作手",
    deviceCount: 0,
    deviceTypeSummary: [],
    value: "OPERATOR",
    description: ROLE_DESCRIPTIONS.OPERATOR.description,
    avatar: ROLE_DESCRIPTIONS.OPERATOR.avatar,
    deviceSummary: "已为你绑定体验设备",
    deviceDetail: "",
  },
];

const userStore = useUserStore();
const chatStore = useChatStore(DEFAULT_CHAT_SCOPE);
const selectedRole = ref<VisitorRole | null>(null);
const roles = ref<ViewRole[]>(FALLBACK_ROLES);
const loading = ref(false);
const loadError = ref<string | null>(null);
const submitting = ref(false);

const submitDisabled = computed(() => !selectedRole.value || loading.value || submitting.value);

function selectRole(role: VisitorRole) {
  selectedRole.value = role;
}

async function startChat() {
  if (!selectedRole.value || submitting.value) return;
  submitting.value = true;
  try {
    chatStore.resetConversation();
    userStore.setAwakeningPrompt(null);
    userStore.setVisitorRole(selectedRole.value);
    setGuestRole(selectedRole.value);
    // 设置身份后立刻预取今日觉醒内容，进入首页即可直接展示
    const result = await getTodayAwakeningPrompt();
    userStore.setAwakeningPrompt(result ?? null);
    uni.redirectTo({ url: "/pages/index/index?mode=demo" });
  } catch (error) {
    logger.warn("failed to prefetch awakening prompt", error);
    // 预取失败仍允许进入首页，首页会兜底重试
    userStore.setAwakeningPrompt(null);
    uni.redirectTo({ url: "/pages/index/index?mode=demo" });
  } finally {
    submitting.value = false;
  }
}

function applyRoleList(list: RoleOption[]) {
  const mapped = list
    .map(mapToViewRole)
    .filter((role): role is ViewRole => role !== null);
  if (mapped.length) {
    roles.value = mapped;
  } else {
    loadError.value = "暂无可用身份";
    roles.value = FALLBACK_ROLES;
  }
}

async function loadRoleOptions() {
  loading.value = true;
  loadError.value = null;
  try {
    // 优先使用进入页面前已预取并缓存好的角色选项，避免加载闪动
    const cached = uni.getStorageSync(VISITOR_ROLE_OPTIONS_CACHE_KEY);
    if (Array.isArray(cached) && cached.length) {
      applyRoleList(cached);
      return;
    }
    const result = await getRoleOptions();
    applyRoleList(result?.roles ?? []);
  } catch (error) {
    loadError.value = "身份选项加载失败，请稍后重试";
    roles.value = FALLBACK_ROLES;
    logger.warn("failed to load role options", error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadRoleOptions();
});
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
      <view v-if="loadError" class="role-select__error">
        {{ loadError }}
      </view>
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
            {{ role.roleName }}
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
      <view
        class="primary-btn"
        :class="{ 'primary-btn--disabled': submitDisabled }"
        @tap="startChat"
      >
        <text>{{ loading || submitting ? "加载中..." : "开始体验" }}</text>
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
$color-text-warning: #a31717;

.role-select {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: center;
  // 内嵌 APP：上下各让出一段安全区
  padding-top: constant(safe-area-inset-top);
  padding-top: env(safe-area-inset-top);
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
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

.role-select__error {
  display: block;
  margin-bottom: 24rpx;
  color: $color-text-warning;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 36rpx;
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

.primary-btn--disabled {
  opacity: 0.6;
}
</style>

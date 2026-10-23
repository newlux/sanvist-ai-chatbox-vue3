<script setup lang="ts">
import type { DeviceModelOption } from "@/api/user-role/device-models";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getDeviceModels } from "@/api/user-role";
import brandLogo from "@/assets/img/header-island-logo.png";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";

/**
 * 选择体验的设备（设计稿 580:1661）。
 *
 * 作业指导的第一步：SANI 打招呼，用户在中心 Logo 周围挑一台设备。
 * 原来这一步是作业指导页初始化时自动弹起的机型卡片，现在拆成独立页面放在最前面，
 * 选完写进 user store，后续讲解模式选择页、作业指导页都从这里取（inputs.device_model）。
 */
defineOptions({ name: "DeviceSelectPage" });

/** 选中态先亮一下再跳转，避免点下去没有反馈 */
const REDIRECT_DELAY_MS = 180;

const logger = createLogger("device-select");
const userStore = useUserStore();

const models = ref<DeviceModelOption[]>([]);
const selectedKey = ref("");
let redirectTimer: ReturnType<typeof setTimeout> | null = null;

/** 设计稿只排了 4 个圆角胶囊：前 4 个环绕 Logo，多出来的机型在下面按行平铺 */
const orbitModels = computed(() => models.value.slice(0, 4));
const restModels = computed(() => models.value.slice(4));

/** 设计稿文案：`{用户名}，我是 SANI，今天陪您一起体验。先挑一台感兴趣的设备吧。` */
const greeting = computed(() => {
  const name = String(userStore.username || "").trim() || "游客";
  return `${name}，我是 SANI，今天陪您一起体验。先挑一台感兴趣的设备吧。`;
});

function goNext() {
  uni.redirectTo({ url: "/pages/users/index" });
}

function onSelect(item: DeviceModelOption) {
  if (redirectTimer) return;
  selectedKey.value = item.modelKey;
  userStore.setSelectedDeviceModelKey(item.modelKey);
  redirectTimer = setTimeout(() => {
    redirectTimer = null;
    goNext();
  }, REDIRECT_DELAY_MS);
}

async function loadDeviceModels() {
  try {
    const data = await getDeviceModels();
    models.value = Array.isArray(data?.models) ? data.models : [];
    userStore.setDeviceModels(models.value);
  } catch (error) {
    logger.warn("failed to load device models", error);
    models.value = [];
  }
  // 拉不到机型时不停在这一页：没有可选内容，直接进入讲解模式选择
  if (!models.value.length) goNext();
}

onMounted(loadDeviceModels);
onBeforeUnmount(() => {
  if (redirectTimer) clearTimeout(redirectTimer);
});
</script>

<template>
  <view class="device-pick">
    <!-- 底部彩色氛围光（设计稿 580:1722）+ 向上淡出 -->
    <view class="device-pick__glow" />
    <view class="device-pick__glow-fade" />

    <text class="device-pick__greeting">
      {{ greeting }}
    </text>

    <!-- 舞台区：中心 Logo + 四周机型胶囊（580:1729 / 580:1724 / 580:1727 / 580:1714） -->
    <view class="device-pick__stage">
      <view class="device-pick__orb">
        <image class="device-pick__orb-img" :src="brandLogo" mode="aspectFit" />
      </view>
      <view
        v-for="(item, index) in orbitModels"
        :key="item.modelKey"
        class="device-pick__chip"
        :class="[`device-pick__chip--${index}`, { 'device-pick__chip--selected': selectedKey === item.modelKey }]"
        @tap="onSelect(item)"
      >
        <text class="device-pick__chip-text">
          {{ item.modelName }}
        </text>
      </view>
    </view>

    <view v-if="restModels.length" class="device-pick__more">
      <view
        v-for="item in restModels"
        :key="item.modelKey"
        class="device-pick__chip device-pick__chip--more"
        :class="{ 'device-pick__chip--selected': selectedKey === item.modelKey }"
        @tap="onSelect(item)"
      >
        <text class="device-pick__chip-text">
          {{ item.modelName }}
        </text>
      </view>
    </view>

    <text class="device-pick__hint">
      可以和我说你感兴趣的机型
    </text>
  </view>
</template>

<style lang="scss" scoped>
.device-pick {
  position: relative;
  box-sizing: border-box;
  min-height: 100vh;
  overflow: hidden;
  /* 标题在安全区下 63px（设计稿 y=117，状态栏 54） */
  padding: calc(env(safe-area-inset-top) + 126rpx) 0 0;
  background: #fafafa;
  font-family: "PingFang SC", "Source Han Sans CN", sans-serif;
}

/* ===== 底部彩色氛围：紫 → 蓝 → 紫 → 粉（580:1722，模糊后压在输入区下方） ===== */
.device-pick__glow {
  position: absolute;
  right: -40rpx;
  bottom: -80rpx;
  left: -40rpx;
  z-index: 0;
  height: 300rpx;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    #3d21cd 0%,
    #1999fe 49%,
    #c067fa 76%,
    #fda0c4 100%
  );
  filter: blur(60rpx);
  opacity: 0.55;
}

/* 把彩色氛围往上收淡，只留贴底一缕 */
.device-pick__glow-fade {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  height: 320rpx;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    #fafafa 0%,
    rgba(250, 250, 250, 0.72) 42%,
    rgba(250, 250, 250, 0) 100%
  );
}

/* 20px Medium / 24px，左边距 43（设计稿 Main Title 580:1745） */
.device-pick__greeting {
  position: relative;
  z-index: 1;
  display: block;
  margin: 0 86rpx;
  color: #0d0d0d;
  font-size: 40rpx; // 20
  font-weight: 500;
  line-height: 48rpx; // 24
}

/* 舞台：换行后的 93px 间距 + 228px 高度（282 → 510） */
.device-pick__stage {
  position: relative;
  z-index: 1;
  height: 456rpx; // 228
  margin-top: 186rpx; // 93
}

/* 中心 Logo：134 容器 + 110 图，投影跟随图案轮廓（580:1731 / 580:1734） */
.device-pick__orb {
  position: absolute;
  top: 102rpx; // 51
  left: 50%;
  display: flex;
  width: 268rpx; // 134
  height: 268rpx;
  margin-left: -134rpx;
  align-items: center;
  justify-content: center;
}

.device-pick__orb-img {
  width: 220rpx; // 110
  height: 220rpx;
  filter: drop-shadow(0 6rpx 18rpx rgba(0, 0, 0, 0.14));
}

/* 机型胶囊：白边 + 浅蓝渐变 + 大圆角，内边距 6/18，文案 14px/20px 左对齐 */
.device-pick__chip {
  position: absolute;
  display: inline-flex;
  box-sizing: border-box;
  align-items: center;
  padding: 12rpx 36rpx; // 6 / 18
  border: 1px solid #ffffff;
  border-radius: 999rpx;
  background: linear-gradient(135deg, #def1fc 0%, #f1faff 100%);
  box-shadow: 0 2rpx 196rpx rgba(0, 0, 0, 0.0755);

  &:active {
    opacity: 0.75;
  }
}

.device-pick__chip--selected {
  background: linear-gradient(135deg, #c9e8fb 0%, #e6f6ff 100%);
}

.device-pick__chip-text {
  display: block;
  max-width: 176rpx; // 88：三行机型名按这个宽度折行
  color: #0d0d0d;
  font-size: 28rpx; // 14
  font-weight: 500;
  line-height: 40rpx; // 20
  white-space: pre-line;
  word-break: break-word;
}

/* 四角坐标照着设计稿：左上 / 右上 / 左下 / 右下 */
.device-pick__chip--0 {
  top: 14rpx; // 289 - 282
  left: 76rpx; // 38
}

.device-pick__chip--1 {
  top: 0; // 282
  right: 34rpx; // 375 - 234 - 124 + 17
}

.device-pick__chip--2 {
  bottom: 0; // 478 + 32 = 510
  left: 75rpx; // 37.5
}

.device-pick__chip--3 {
  right: 50rpx; // 25
  bottom: 22rpx; // 510 - 467 - 32
}

/* 超过 4 台的兜底：舞台下方平铺 */
.device-pick__more {
  position: relative;
  z-index: 1;
  display: flex;
  margin-top: 32rpx;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16rpx;
}

.device-pick__chip--more {
  position: static;
}

.device-pick__chip--more .device-pick__chip-text {
  max-width: 480rpx;
}

/* 16px Medium / #8E8E8E，居中（580:1746） */
.device-pick__hint {
  position: relative;
  z-index: 1;
  display: block;
  margin-top: 178rpx; // 89
  color: #8e8e8e;
  font-size: 32rpx; // 16
  font-weight: 500;
  line-height: 46rpx; // 23
  text-align: center;
}
</style>

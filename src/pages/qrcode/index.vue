<script setup lang="ts">
import { computed, ref } from "vue";
import { onLoad } from "@dcloudio/uni-app";
import { useI18n } from "vue-i18n";
import backIcon from "@/assets/img/nav-arrow-left.svg";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { encodeQrCode } from "@/utils/qrcode";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 二维码页（pages/qrcode/index）。
 *
 * 入口：工作流把 `outputs.answer` 置为占位文本 "QRCODE"（message_end.metadata.qrcode）时，
 * useChatSend 会隐藏那一轮的 AI 气泡并跳到本页展示二维码。
 *
 * 内容来源：路由参数 `content`（后端可直接下发链接 / 口令），缺失时展示空态。
 * 渲染：本地把文本编码成二维码矩阵再拼成 SVG，不依赖任何第三方库和网络图片。
 */

defineOptions({ name: "QrCodePage" });

const { t } = useI18n();
const { safeAreaStyle, safeTopPx } = useSafeArea();
const logger = createLogger("qrcode-page");

/** 二维码四周的静默区（模块数），少于 4 个很多扫码器识别不到 */
const QUIET_ZONE = 4;

const content = ref("");

onLoad((options) => {
  // uni 已经把路由 query 解码过一次，这里不再 decodeURIComponent（内容本身可能带 %）
  content.value = String(options?.content ?? "").trim();
});

/** 把二维码矩阵拼成单条 SVG path 的 SVG 字符串；failed 表示内容超出编码容量 */
const qrCode = computed(() => {
  if (!content.value) return { svg: "", failed: false };
  try {
    const { size, modules } = encodeQrCode(content.value);
    const total = size + QUIET_ZONE * 2;
    let path = "";
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (modules[row][col]) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${path}" fill="#1a1a1e"/></svg>`;
    return { svg, failed: false };
  }
  catch (error) {
    logger.error("failed to encode qrcode content", error);
    return { svg: "", failed: true };
  }
});

const qrSvg = computed(() => qrCode.value.svg);
const hasContent = computed(() => Boolean(content.value));

function onBack() {
  backFromScene();
}

function onCopy() {
  if (!hasContent.value) return;
  uni.setClipboardData({
    data: content.value,
    success: () => uni.showToast({ title: t("qrcode-copied"), icon: "none" }),
  });
}
</script>

<template>
  <view class="qrcode-page" :style="safeAreaStyle">
    <view class="qrcode-page__header" :style="{ paddingTop: `${safeTopPx}px` }">
      <view class="qrcode-page__back" @tap="onBack">
        <image class="qrcode-page__back-icon" :src="backIcon" />
      </view>
      <text class="qrcode-page__title">{{ t("qrcode-title") }}</text>
    </view>

    <view class="qrcode-page__body">
      <view class="qrcode-card">
        <view v-if="qrSvg" class="qrcode-card__code" v-html="qrSvg" />
        <view v-else class="qrcode-card__empty">
          <text class="qrcode-card__empty-text">{{ qrCode.failed ? t("qrcode-failed") : t("qrcode-empty") }}</text>
        </view>
        <text class="qrcode-card__tip">{{ t("qrcode-tip") }}</text>
      </view>

      <view v-if="hasContent" class="qrcode-page__content">
        <text class="qrcode-page__content-text">{{ content }}</text>
      </view>

      <view v-if="hasContent" class="qrcode-page__action" @tap="onCopy">
        <text class="qrcode-page__action-text">{{ t("qrcode-copy") }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.qrcode-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-color: #f5f6f8;
}

.qrcode-page__header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 88rpx;
  box-sizing: content-box;
}

.qrcode-page__back {
  position: absolute;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88rpx;
  height: 88rpx;
}

.qrcode-page__back-icon {
  width: 36rpx;
  height: 36rpx;
}

.qrcode-page__title {
  font-size: 32rpx;
  font-weight: 600;
  color: #1a1a1e;
}

.qrcode-page__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  padding: 48rpx 40rpx 0;
}

.qrcode-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 48rpx 40rpx 40rpx;
  background-color: #ffffff;
  border-radius: 24rpx;
  box-sizing: border-box;
}

.qrcode-card__code {
  width: 480rpx;
  height: 480rpx;
}

.qrcode-card__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 480rpx;
  height: 480rpx;
  background-color: #f5f6f8;
  border-radius: 16rpx;
}

.qrcode-card__empty-text {
  font-size: 26rpx;
  color: #999999;
}

.qrcode-card__tip {
  margin-top: 32rpx;
  font-size: 26rpx;
  line-height: 1.5;
  color: #999999;
  text-align: center;
}

.qrcode-page__content {
  width: 100%;
  max-height: 200rpx;
  padding: 24rpx 32rpx;
  margin-top: 32rpx;
  overflow-y: auto;
  background-color: #ffffff;
  border-radius: 16rpx;
  box-sizing: border-box;
}

.qrcode-page__content-text {
  font-size: 24rpx;
  line-height: 1.5;
  color: #666666;
  word-break: break-all;
}

.qrcode-page__action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 88rpx;
  margin-top: 48rpx;
  background-color: #c8201e;
  border-radius: 999rpx;
}

.qrcode-page__action-text {
  font-size: 30rpx;
  font-weight: 500;
  color: #ffffff;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 配件助手跳转弹层。
 *
 * 首页底部「配件助手」入口点击后弹出：输入框里填的是**完整地址**（不做拼接、不做校验），
 * 点「跳转」后交给页面新开 `/pages/parts/index` 全屏内嵌这个地址。
 */
defineOptions({ name: "AiPartsJumpSheet" });

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** 深色主题（首页问答态）：沿用设置弹层同一套暗色材质 */
  dark: { type: Boolean, default: false },
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "jump", url: string): void;
}>();

const { t } = useI18n();

const url = ref("");
const canJump = computed(() => url.value.trim().length > 0);

// 每次关闭都清空：下次打开是全新的输入，不残留上一次的地址
watch(
  () => props.visible,
  (visible) => {
    if (!visible) url.value = "";
  },
);

function close() {
  emit("update:visible", false);
}

function onJump() {
  const target = url.value.trim();
  if (!target) return;
  emit("jump", target);
  close();
}
</script>

<template>
  <view v-if="visible" class="parts-jump" :class="{ 'parts-jump--dark': dark }">
    <view class="parts-jump__mask" @tap="close" />
    <view class="parts-jump__sheet">
      <text class="parts-jump__title">
        {{ t("parts-jump-title") }}
      </text>
      <text class="parts-jump__desc">
        {{ t("parts-jump-desc") }}
      </text>

      <input
        v-model="url"
        class="parts-jump__input"
        :placeholder="t('parts-jump-placeholder')"
        :cursor-spacing="32"
        confirm-type="go"
        @confirm="onJump"
      />

      <view
        class="parts-jump__action"
        :class="{ 'parts-jump__action--disabled': !canJump }"
        @tap="onJump"
      >
        <text class="parts-jump__action-text">
          {{ t("parts-jump-action") }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.parts-jump {
  position: fixed;
  z-index: 1200;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.parts-jump__mask {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(13, 13, 13, 0.4);
}

.parts-jump__sheet {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  padding: 48rpx 40rpx calc(48rpx + env(safe-area-inset-bottom));
  border-radius: 40rpx 40rpx 0 0;
  background: #ffffff;
}

.parts-jump__title {
  display: block;
  color: #0d0d0d;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 52rpx;
}

.parts-jump__desc {
  display: block;
  margin-top: 8rpx;
  color: #8f8f8f;
  font-size: 26rpx;
  font-weight: 400;
  line-height: 38rpx;
}

.parts-jump__input {
  box-sizing: border-box;
  width: 100%;
  height: 96rpx;
  margin-top: 32rpx;
  padding: 0 28rpx;
  border: 1px solid #efefef;
  border-radius: 24rpx;
  background: #f7f7f7;
  color: #0d0d0d;
  font-size: 30rpx;
  line-height: 96rpx;
}

.parts-jump__input::placeholder {
  color: #b5b5b5;
}

.parts-jump__action {
  display: flex;
  width: 100%;
  height: 96rpx;
  align-items: center;
  justify-content: center;
  margin-top: 32rpx;
  border-radius: 48rpx;
  background: #fe0000;
}

.parts-jump__action--disabled {
  opacity: 0.4;
}

.parts-jump__action-text {
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 500;
  line-height: 44rpx;
}

/* 深色：弹层 #212121、输入框 #2B2B2B，按钮仍是品牌红 */
.parts-jump--dark {
  .parts-jump__sheet {
    background: #212121;
  }

  .parts-jump__title {
    color: #ffffff;
  }

  .parts-jump__desc {
    color: #8f8f8f;
  }

  .parts-jump__input {
    border-color: #303030;
    background: #2b2b2b;
    color: #ffffff;
  }
}
</style>

<script setup lang="ts">
import type { AssistantNavigationAction, AssistantNavigationPayload } from "@/api/chat/types";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

defineOptions({ name: "AiAssistantNavigationSheet" });

const props = withDefaults(defineProps<{
  payload?: AssistantNavigationPayload | null;
  visible?: boolean;
}>(), {
  payload: null,
  visible: false,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "confirm", payload: AssistantNavigationPayload, action: AssistantNavigationAction): void;
}>();

const { t } = useI18n();

/** 配件助手与维修助手共用这个弹层，兜底文案与动作按 target 切换（后端下发了就以它为准）。 */
const isPartsAssistant = computed(() => props.payload?.target === "parts_assistant");

const title = computed(
  () =>
    String(props.payload?.title || "").trim()
    || t(isPartsAssistant.value ? "assistant-nav-parts-title" : "assistant-nav-title"),
);

/**
 * 进入方式列表：
 * - 后端下发 actions 就用后端的（顺序即设计稿顺序）；
 * - 配件助手兜底成设计稿 1318:1 的四项：拍照 / 上传 / 进入首页 / 暂不进入；
 * - 维修助手仍是「确定 / 暂不进入」两项。
 * note: 设计稿里「暂不进入」的圆角标的是 12px（其余 8px），这里按原值还原，见 --last 规则。
 */
const actions = computed<AssistantNavigationAction[]>(() => {
  const fromPayload = Array.isArray(props.payload?.actions)
    ? props.payload.actions.filter(action => Boolean(action?.key) && Boolean(action?.label))
    : [];
  if (fromPayload.length) return fromPayload;

  if (isPartsAssistant.value) {
    return [
      { key: "camera", label: t("assistant-nav-parts-camera") },
      { key: "upload", label: t("assistant-nav-parts-upload") },
      { key: "home", label: t("assistant-nav-parts-home"), style: "primary" },
      { key: "cancel", label: t("assistant-nav-cancel"), style: "muted" },
    ];
  }

  return [
    { key: "confirm", label: String(props.payload?.confirm_text || "").trim() || t("assistant-nav-confirm") },
    { key: "cancel", label: String(props.payload?.cancel_text || "").trim() || t("assistant-nav-cancel") },
  ];
});

function actionClass(action: AssistantNavigationAction, index: number) {
  return [
    `assistant-navigation-sheet__action--${action.style || "default"}`,
    // 设计稿里只有最末一项是 12px 圆角，其余 8px
    index === actions.value.length - 1 ? "assistant-navigation-sheet__action--last" : "",
  ];
}

function close() {
  emit("update:visible", false);
}

function onActionTap(action: AssistantNavigationAction) {
  if (!props.payload) return;
  // 「暂不进入」只关闭弹层，不触发跳转
  if (action.key === "cancel") {
    close();
    return;
  }
  const payload = props.payload;
  close();
  emit("confirm", payload, action);
}
</script>

<template>
  <view v-if="visible && payload" class="assistant-navigation-sheet">
    <!-- 关闭：设计稿 1318:1 Frame 4，26×26 只有两条 12px / 2px 的叉线，圆形底是隐藏的 -->
    <view class="assistant-navigation-sheet__close" @tap.stop="close">
      <view class="assistant-navigation-sheet__close-line assistant-navigation-sheet__close-line--forward" />
      <view class="assistant-navigation-sheet__close-line assistant-navigation-sheet__close-line--backward" />
    </view>

    <text class="assistant-navigation-sheet__title">
      {{ title }}
    </text>

    <view class="assistant-navigation-sheet__actions">
      <view
        v-for="(action, index) in actions"
        :key="action.key"
        class="assistant-navigation-sheet__action"
        :class="actionClass(action, index)"
        @tap.stop="onActionTap(action)"
      >
        <text class="assistant-navigation-sheet__action-text">
          {{ action.label }}
        </text>
      </view>
    </view>

    <text class="assistant-navigation-sheet__hint">
      {{ t("ai-content-disclaimer") }}
    </text>

    <view class="assistant-navigation-sheet__home">
      <view class="assistant-navigation-sheet__home-bar" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 设计稿 1318:1「查询配件询问」底部弹层：375×342，圆角 22，白底 + 上投影 */
.assistant-navigation-sheet {
  position: fixed;
  z-index: 1002;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  height: 684rpx; // 342px
  border-radius: 44rpx 44rpx 0 0; // 22px
  background: #fff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.06); // 0 -2 21
}

.assistant-navigation-sheet__close {
  position: absolute;
  top: 60rpx; // 30px
  right: 52rpx; // 屏宽 − (323 + 26) = 26px
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52rpx; // 26px
  height: 52rpx;
}

.assistant-navigation-sheet__close-line {
  position: absolute;
  width: 24rpx; // 12px
  height: 4rpx; // 2px
  border-radius: 4rpx;
  background: #c9c9c9;
}

.assistant-navigation-sheet__close-line--forward {
  transform: rotate(45deg);
}

.assistant-navigation-sheet__close-line--backward {
  transform: rotate(-45deg);
}

.assistant-navigation-sheet__title {
  position: absolute;
  top: 68rpx; // 34px
  left: 80rpx; // 40px
  width: 590rpx; // 295px
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 34rpx; // 17px
  color: #1a1a1a;
}

.assistant-navigation-sheet__actions {
  position: absolute;
  top: 134rpx; // 67px
  left: 80rpx; // 40px
  display: flex;
  flex-direction: column;
  gap: 16rpx; // 8px
  width: 590rpx; // 295px
}

.assistant-navigation-sheet__action {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx; // 36px
  padding: 0 24rpx; // 12px
  border-radius: 16rpx; // 8px
  background: #f6f6f6;
}

/* 设计稿原值：最末一项 12px 圆角，其余 8px —— 按文件还原，不在这里「修正」 */
.assistant-navigation-sheet__action--last {
  border-radius: 24rpx; // 12px
}

.assistant-navigation-sheet__action--primary {
  background: #2f2b2b;
}

.assistant-navigation-sheet__action:active {
  opacity: 0.7;
}

.assistant-navigation-sheet__action-text {
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 34rpx;
  color: #000;
}

.assistant-navigation-sheet__action--primary .assistant-navigation-sheet__action-text {
  color: #fff;
}

.assistant-navigation-sheet__action--muted .assistant-navigation-sheet__action-text {
  color: #999;
}

.assistant-navigation-sheet__hint {
  position: absolute;
  top: 604rpx; // 302px
  left: 0;
  width: 750rpx;
  text-align: center;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 24rpx; // 12px
  line-height: 30rpx;
  color: #bababa;
}

.assistant-navigation-sheet__home {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 40rpx; // 20px
}

.assistant-navigation-sheet__home-bar {
  position: absolute;
  top: 18rpx; // 8.84px
  left: 50%;
  width: 271rpx; // 135.66px
  height: 10rpx; // 5.06px
  border-radius: 5rpx; // 2.53px
  background: #000;
  transform: translateX(-50%);
}
</style>

<script setup lang="ts">
import type { AssistantNavigationAction, AssistantNavigationPayload } from "@/api/chat/types";
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 跳转确认卡（COMPONENT type=navigation，`data.target` 决定去哪）：
 * - maintenance_assistant（维修助手）：**消息流内联卡** —— 标题 + 「确定，进入维修助手 / 暂不进入」，
 *   就地排在回答正文下方，不再弹底部白板；
 * - parts_assistant（配件助手）：仍是四项入口（拍照 / 上传 / 首页 / 暂不进入），
 *   气泡里排不下启动原生相机这类动作，继续由页面按 auto_open 弹层。
 */
defineOptions({ name: "AssistantNavigationBlock" });

const props = defineProps({
  payload: { type: Object as () => AssistantNavigationPayload, required: true },
});

const emit = defineEmits<{
  /** 走弹层的 target：块自身不占位，只把 payload 抛给页面开弹框 */
  open: [payload: AssistantNavigationPayload];
  /** 内联卡点了某个进入方式：页面据此落盘上下文并跳转 */
  confirm: [payload: AssistantNavigationPayload, action: AssistantNavigationAction];
}>();

const { t } = useI18n();

/** 深色：跟随 AI 气泡主题（与 GuideLeadBlock / TableBlock 同一套取法） */
const darkContainer = inject("ai-bubble-dark", computed(() => false));
const isDark = computed(() => Boolean(darkContainer?.value));

/** 只有维修助手内联；其它 target（配件助手）保持弹层 */
const inline = computed(() => props.payload.target === "maintenance_assistant");

/** 标题：后端下发了就用它的，否则按 target 兜底 */
const title = computed(
  () => String(props.payload.title || "").trim() || t("assistant-nav-title"),
);

/**
 * 进入方式：后端下发 actions 就用后端的（顺序即设计稿顺序），
 * 维修助手兜底成「确定，进入维修助手 / 暂不进入」两项。
 */
const actions = computed<AssistantNavigationAction[]>(() => {
  const fromPayload = Array.isArray(props.payload.actions)
    ? props.payload.actions.filter(action => Boolean(action?.key) && Boolean(action?.label))
    : [];
  if (fromPayload.length) return fromPayload;

  return [
    { key: "confirm", label: String(props.payload.confirm_text || "").trim() || t("assistant-nav-confirm") },
    { key: "cancel", label: String(props.payload.cancel_text || "").trim() || t("assistant-nav-cancel") },
  ];
});

/** 点了「暂不进入」：卡片收起，与弹层关闭同义 */
const dismissed = ref(false);

const hasOpened = ref(false);

onMounted(() => {
  // 内联形态不弹层；只有弹层形态看 auto_open
  if (inline.value) return;
  if (hasOpened.value || props.payload.auto_open !== true) return;
  hasOpened.value = true;
  emit("open", props.payload);
});

function onActionTap(action: AssistantNavigationAction) {
  // 「暂不进入」只收起卡片，不触发跳转
  if (action.key === "cancel") {
    dismissed.value = true;
    return;
  }
  emit("confirm", props.payload, action);
}
</script>

<template>
  <view
    v-if="inline && !dismissed"
    class="assistant-nav"
    :class="{ 'assistant-nav--dark': isDark }"
  >
    <text v-if="title" class="assistant-nav__title">
      {{ title }}
    </text>

    <view class="assistant-nav__actions">
      <view
        v-for="(action, index) in actions"
        :key="action.key"
        class="assistant-nav__action"
        :class="[
          `assistant-nav__action--${action.style || 'default'}`,
          // 设计稿里只有最末一项是 12px 圆角，其余 8px（与底部弹层同值）
          index === actions.length - 1 ? 'assistant-nav__action--last' : '',
        ]"
        @tap.stop="onActionTap(action)"
      >
        <text class="assistant-nav__action-text">
          {{ action.label }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 内联跳转卡：材质与底部弹层（ai-assistant-navigation-sheet）一致，
   只是从「贴底白板」改成排在回答正文下方 —— 标题 14px / #1A1A1A，
   动作行 #F6F6F6、高 36px、左右内边距 12px，间距 8px */
.assistant-nav {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  margin-top: 16rpx;
  gap: 16rpx; // 8px：标题与动作组
}

.assistant-nav__title {
  display: block;
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 34rpx; // 17px
  color: #1a1a1a;
}

.assistant-nav__actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx; // 8px：动作之间
}

.assistant-nav__action {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  height: 72rpx; // 36px
  padding: 0 24rpx; // 12px
  border-radius: 16rpx; // 8px
  background: #f6f6f6;

  &:active {
    opacity: 0.7;
  }
}

/* 设计稿原值：最末一项 12px 圆角，其余 8px */
.assistant-nav__action--last {
  border-radius: 24rpx; // 12px
}

.assistant-nav__action--primary {
  background: #2f2b2b;
}

.assistant-nav__action-text {
  font-family: "PingFang SC", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 34rpx;
  color: #000;
}

.assistant-nav__action--primary .assistant-nav__action-text {
  color: #fff;
}

.assistant-nav__action--muted .assistant-nav__action-text {
  color: #999;
}

/* ===== 深色：与其它块同一套材质（正文 #E5E5E5、块底 6% 白） ===== */
.assistant-nav--dark {
  .assistant-nav__title {
    color: #e5e5e5;
  }

  .assistant-nav__action {
    background: rgba(255, 255, 255, 0.06);
  }

  .assistant-nav__action--primary {
    background: rgba(255, 255, 255, 0.92);
  }

  .assistant-nav__action-text {
    color: #e5e5e5;
  }

  .assistant-nav__action--primary .assistant-nav__action-text {
    color: #1a1a1a;
  }

  .assistant-nav__action--muted .assistant-nav__action-text {
    color: rgba(255, 255, 255, 0.45);
  }
}
</style>

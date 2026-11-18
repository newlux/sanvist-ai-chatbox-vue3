<script setup lang="ts">
import type { AssistantNavigationAction, AssistantNavigationPayload } from "@/api/chat/types";
import { REPAIR_NAV_INTENT_ENTER, REPAIR_NAV_INTENT_FAULT_CODE } from "@/config";
import { computed, inject, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

/**
 * 跳转确认卡（COMPONENT type=navigation，`data.target` 决定去哪）：
 * - maintenance_assistant（维修助理）由 `data.intent` 再分两种：
 *   · MAINT_FAULT_CODE：**消息流内联卡** —— 标题 + 「确定，进入维修助理 / 暂不进入」，
 *     就地排在回答正文下方，不再弹底部白板；点「确定」只是把确认发回对话（页面处理），
 *     真正的跳转要等后端下发 ENTER_ASSISTANT；
 *   · ENTER_ASSISTANT：后端已确认进入，卡不渲染，流式到达（auto_open）即自动抛 confirm 直接跳页；
 *   · 其它 / 缺省 intent：不弹卡也不跳转；
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

const intent = computed(() => String(props.payload.intent || "").trim().toUpperCase());

/** 是否「故障码 → 询问要不要进维修助理」的确认卡 */
const isRepairFaultCode = computed(
  () => props.payload.target === "maintenance_assistant" && intent.value === REPAIR_NAV_INTENT_FAULT_CODE,
);

/** 是否后端已经确认进入维修助理（此时不出卡，直接跳） */
const isRepairEnter = computed(
  () => props.payload.target === "maintenance_assistant" && intent.value === REPAIR_NAV_INTENT_ENTER,
);

/** 只有「故障码」这一种维修助理内联；配件助手 / 已确认进入的维修助理都不占位 */
const inline = computed(() => isRepairFaultCode.value);

/** 标题：后端下发了就用它的，否则按 target 兜底 */
const title = computed(
  () => String(props.payload.title || "").trim() || t("assistant-nav-title"),
);

/**
 * 进入方式：后端下发 actions 就用后端的（顺序即设计稿顺序），
 * 维修助理兜底成「确定，进入维修助理 / 暂不进入」两项。
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

/** 选项序号：A / B / C…（与「身份选择」那组胶囊同一套写法） */
function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

const hasOpened = ref(false);

/**
 * 同一个 payload 只自动进一次：组件重挂载（切会话回来、列表重建）时不再重复跳页。
 * 用 payload 对象本身做键，流式更新时是同一个对象，历史消息也不会带 auto_open。
 */
const autoEnteredPayloads = new WeakSet<object>();

onMounted(() => {
  // intent=ENTER_ASSISTANT：后端已确认进入，直接抛给页面跳维修助理页。
  // 只认流式到达的这次（带 auto_open），历史消息里的块不自动跳，避免翻旧会话被带走。
  if (isRepairEnter.value) {
    if (props.payload.auto_open !== true) return;
    if (autoEnteredPayloads.has(props.payload)) return;
    autoEnteredPayloads.add(props.payload);
    emit("confirm", props.payload, {
      key: "confirm",
      label: String(props.payload.confirm_text || "").trim() || t("assistant-nav-confirm"),
    });
    return;
  }
  // 内联形态（故障码确认卡）不弹层；只有弹层形态看 auto_open
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
  // 选了任一进入方式后卡片就收起，避免同一张卡被连点两次发出两条确认
  dismissed.value = true;
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
      <!-- 与「身份选择」那组胶囊（GuideSuggestionBlock）同款：A｜文案 + 全圆角 -->
      <view
        v-for="(action, index) in actions"
        :key="action.key"
        class="assistant-nav__action"
        @tap.stop="onActionTap(action)"
      >
        <text class="assistant-nav__action-letter">
          {{ optionLetter(index) }}
        </text>
        <view class="assistant-nav__action-divider" />
        <text class="assistant-nav__action-text">
          {{ action.label }}
        </text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 内联跳转卡：标题 + 选项胶囊。
   选项与「身份选择」那组胶囊（GuideSuggestionBlock，老板 / 设备管理员 / 操作手）同一套材质：
   白底 + 1px #E6E6E6 描边 + 全圆角（999rpx），左侧 A｜文案，纵向排列、左对齐、间距 10px */
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
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 34rpx; // 17px
  color: #1a1a1a;
}

/* 选项组：纵向排列、左对齐，胶囊按内容宽度收缩 */
.assistant-nav__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.assistant-nav__action {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: 100%;
  padding: 18rpx 28rpx;
  border: 1px solid #e6e6e6;
  border-radius: 999rpx; // 真胶囊：左右两端半圆
  background: #ffffff;
}

/* 段间距用 margin 而不是 flex gap：低端安卓 WebView 的 flex gap 支持不稳 */
.assistant-nav__action + .assistant-nav__action {
  margin-top: 20rpx; // 10px
}

.assistant-nav__action:active {
  opacity: 0.7;
}

/* 序号：A / B / C… 与身份选择胶囊逐项对齐 */
.assistant-nav__action-letter {
  flex-shrink: 0;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* 字母与文案之间的细分隔线（设计稿里的「A｜」） */
.assistant-nav__action-divider {
  flex-shrink: 0;
  width: 1px;
  height: 26rpx;
  margin: 0 16rpx;
  background: #dcdcdc;
}

.assistant-nav__action-text {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-size: 28rpx; // 14px
  font-weight: 400;
  line-height: 40rpx;
  color: #1a1a1a;
}

/* ===== 深色：与身份选择胶囊同一套材质（块底 6% 白、正文 #E5E5E5） ===== */
.assistant-nav--dark {
  .assistant-nav__title {
    color: #e5e5e5;
  }

  /* 描边走 1px 内描边线性渐变 #5A5A5A → #F7F7F7 → #5A5A5A：
     原生 border 只能单色，这里把 border 留作占位（透明），再用「渐变底 + mask 挖掉内容区」画 1px 环 */
  .assistant-nav__action {
    position: relative;
    border-color: transparent;
    background: rgba(255, 255, 255, 0.06);
  }

  .assistant-nav__action::before {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 1px;
    border-radius: 999rpx; // 与胶囊半圆端一致
    background: linear-gradient(135deg, #5a5a5a 0%, #f7f7f7 50%, #5a5a5a 100%);
    content: "";
    pointer-events: none;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
  }

  .assistant-nav__action-letter,
  .assistant-nav__action-text {
    color: #e5e5e5;
  }

  .assistant-nav__action-divider {
    background: rgba(255, 255, 255, 0.2);
  }
}
</style>

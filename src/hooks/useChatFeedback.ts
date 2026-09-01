import type { Identifier } from "@/api/chat/types";
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { cancelFeedback, submitFeedback } from "@/api/chat";
import { useChatStore } from "@/stores";

import { createLogger } from "@/utils/logger";

const logger = createLogger("feedback");

interface FeedbackContext {
  index: number;
  messageId: Identifier;
}

export function useChatFeedback() {
  const { t } = useI18n();
  const chatStore = useChatStore();
  const sheetVisible = ref(false);
  const context = ref<FeedbackContext | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCloseTimer() {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  async function onFeedbackChange(payload: { index?: number; msg?: Record<string, unknown>; value?: string }) {
    const index = Number(payload?.index);
    const msg = payload?.msg || {};
    const value = payload?.value || "";
    const targetMsg = Number.isInteger(index) ? chatStore.messages[index] : null;
    const messageId = (msg.messageId ?? targetMsg?.messageId ?? msg.id ?? targetMsg?.id) as Identifier | null;

    if (!targetMsg || !messageId) {
      uni.showToast({ title: t("feedback-unavailable"), icon: "none" });
      return;
    }

    if (value === "bad") {
      context.value = { index, messageId };
      sheetVisible.value = true;
      return;
    }

    const prev = targetMsg;
    if (value === "") {
      chatStore.replaceMessage(index, { ...prev, positive: null, feedbackValue: "", feedbackRemark: "" });
      try {
        await cancelFeedback(messageId);
      } catch (error) {
        logger.error("caught error", error);
        chatStore.replaceMessage(index, { ...prev });
        uni.showToast({ title: t("feedback-failed"), icon: "none" });
      }
      return;
    }

    if (value === "good") {
      chatStore.replaceMessage(index, { ...prev, positive: true, feedbackValue: "good", feedbackRemark: prev.feedbackRemark || "" });
      try {
        await submitFeedback(messageId, { rating: "like" });
      } catch (error) {
        logger.error("caught error", error);
        chatStore.replaceMessage(index, { ...prev });
        uni.showToast({ title: t("feedback-failed"), icon: "none" });
      }
    }
  }

  async function onBadFeedbackConfirm(payload: { remark?: string }) {
    const ctx = context.value;
    if (!ctx) return;
    const remark = String(payload?.remark || "").trim();
    if (!remark) {
      uni.showToast({ title: t("please-enter-feedback-reason"), icon: "none" });
      return;
    }

    const prev = chatStore.messages[ctx.index] || {};
    chatStore.replaceMessage(ctx.index, {
      ...prev,
      positive: false,
      feedbackValue: "bad",
      feedbackRemark: remark,
    });

    try {
      await submitFeedback(ctx.messageId, {
        rating: "dislike",
        content: remark,
      });
      uni.showToast({ title: t("feedback-thanks"), icon: "none", duration: 1500 });
      clearCloseTimer();
      closeTimer = setTimeout(() => {
        context.value = null;
        sheetVisible.value = false;
      }, 1500);
    } catch (error) {
      logger.error("caught error", error);
      chatStore.replaceMessage(ctx.index, {
        ...prev,
        positive: prev.positive ?? null,
        feedbackValue: prev.feedbackValue ?? "",
        feedbackRemark: prev.feedbackRemark ?? "",
      });
      uni.showToast({ title: t("feedback-failed"), icon: "none" });
    }
  }

  function onBadFeedbackClose() {
    sheetVisible.value = false;
    context.value = null;
  }

  onBeforeUnmount(clearCloseTimer);

  return {
    badFeedbackSheetVisible: sheetVisible,
    onFeedbackChange,
    onBadFeedbackConfirm,
    onBadFeedbackClose,
  };
}

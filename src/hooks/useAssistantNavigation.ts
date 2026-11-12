import { ref } from "vue";
import type { AssistantNavigationAction, AssistantNavigationPayload } from "@/api/chat/types";
import { REPAIR_NAV_INTENT_ENTER, REPAIR_NAV_INTENT_FAULT_CODE } from "@/config";
import { useUserStore } from "@/stores";
import { openPartsAssistant } from "@/utils/parts-h5";
import { openRepairAssistant } from "@/utils/repair-h5";
import { stashPendingRepairCallback } from "@/utils/repair-callback";
import { stashPendingRepairNavigationContext } from "@/utils/repair-navigation";

/** 三个助手共用指令卡的执行出口，保留各自发送函数与会话域。 */
export function useAssistantNavigation(sendPrompt: (query: string) => unknown) {
  const userStore = useUserStore();
  const assistantNavigationPayload = ref<AssistantNavigationPayload | null>(null);
  const assistantNavigationVisible = ref(false);

  function onAssistantNavigationOpen(payload: AssistantNavigationPayload) {
    if (payload.target !== "parts_assistant") return;
    assistantNavigationPayload.value = payload;
    assistantNavigationVisible.value = true;
  }

  function onAssistantNavigationConfirm(payload: AssistantNavigationPayload, _action?: AssistantNavigationAction) {
    if (payload.target === "parts_assistant") {
      void openPartsAssistant();
      return;
    }
    if (payload.target !== "maintenance_assistant") return;
    const intent = String(payload.intent || "").trim().toUpperCase();
    if (intent === REPAIR_NAV_INTENT_FAULT_CODE) {
      // 故障码卡先确认，等待后端返回 ENTER_ASSISTANT 后再进入。
      sendPrompt("确认进入维修助理");
      return;
    }
    if (intent !== REPAIR_NAV_INTENT_ENTER) return;
    const aiAskConversationId = String(payload.conversationId || "").trim();
    const aiAskSessionId = String(payload.sessionId || "").trim();
    if (aiAskConversationId && aiAskSessionId) {
      stashPendingRepairCallback({ aiAskConversationId, aiAskSessionId });
    }
    void openRepairAssistant({
      sessionId: aiAskSessionId,
      conversationId: aiAskConversationId,
      // 三方 WebView 通过通知通道获取本轮问题，不能在提取共享逻辑时丢失。
      question: String(payload.context?.query || ""),
      onFallback: () => {
        stashPendingRepairNavigationContext({
          ...payload.context,
          userId: userStore.userId,
          sessionId: payload.sessionId,
          conversationId: payload.conversationId,
        });
      },
    });
  }

  return { assistantNavigationPayload, assistantNavigationVisible, onAssistantNavigationOpen, onAssistantNavigationConfirm };
}

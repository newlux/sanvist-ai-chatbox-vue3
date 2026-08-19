import type { Identifier } from "@/api/chat/types";
import type { UiChatMessage } from "@/stores/chat-types";
import { defineStore } from "pinia";
import { nextTick, ref } from "vue";

export const useChatStore = defineStore("chat", () => {
  const stage = ref<"welcome" | "chat">("welcome");
  const messages = ref<UiChatMessage[]>([]);
  const inputText = ref("");
  const isLoading = ref(false);
  const aiSessionId = ref<Identifier | null>(null);
  const showQuickPrompts = ref(true);
  const showQuickList = ref(true);
  const awakeningLoading = ref(false);
  const scrollTop = ref(0);
  const scrollIntoView = ref("");
  const requestSeq = ref(0);
  const activeRequestSeq = ref(0);
  const activeAiMsgIndex = ref(-1);

  const quickPrompts = [
    "设备的在线或离线情况",
    "最近 7 天设备作业情况",
  ];

  let scrollPending = false;
  let bottomAnchorToggle = false;

  function replaceMessage(index: number, message: UiChatMessage) {
    messages.value.splice(index, 1, message);
  }

  function nextRequestSeq() {
    requestSeq.value += 1;
    activeRequestSeq.value = requestSeq.value;
    return activeRequestSeq.value;
  }

  function invalidateActiveRequest() {
    activeRequestSeq.value = requestSeq.value + 1;
    requestSeq.value = activeRequestSeq.value;
  }

  function resetConversation() {
    messages.value = [];
    inputText.value = "";
    showQuickPrompts.value = true;
    showQuickList.value = true;
    isLoading.value = false;
    aiSessionId.value = null;
    activeAiMsgIndex.value = -1;
  }

  function scrollToBottom() {
    if (scrollPending) return;
    scrollPending = true;
    nextTick(() => {
      bottomAnchorToggle = !bottomAnchorToggle;
      scrollIntoView.value = bottomAnchorToggle
        ? "msg-bottom-anchor-a"
        : "msg-bottom-anchor-b";
      scrollPending = false;
    });
  }

  return {
    stage,
    messages,
    inputText,
    isLoading,
    aiSessionId,
    showQuickPrompts,
    showQuickList,
    awakeningLoading,
    scrollTop,
    scrollIntoView,
    requestSeq,
    activeRequestSeq,
    activeAiMsgIndex,
    quickPrompts,
    replaceMessage,
    nextRequestSeq,
    invalidateActiveRequest,
    resetConversation,
    scrollToBottom,
  };
});

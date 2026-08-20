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
  const scrollIntoView = ref("");
  /** 用户是否还贴着底：上翻看历史时暂停自动滚动，回到底部后恢复 */
  const pinnedToBottom = ref(true);
  const requestSeq = ref(0);
  const activeRequestSeq = ref(0);
  const activeAiMsgIndex = ref(-1);

  const quickPrompts = [
    "设备的在线或离线情况",
    "最近 7 天设备作业情况",
  ];

  let scrollPending = false;
  let bottomAnchorToggle = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

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
    pinnedToBottom.value = true;
  }

  function jumpToAnchor() {
    // 两个锚点交替：scroll-into-view 只在值变化时才生效，连续追加内容必须换 id
    bottomAnchorToggle = !bottomAnchorToggle;
    scrollIntoView.value = bottomAnchorToggle
      ? "msg-bottom-anchor-a"
      : "msg-bottom-anchor-b";
  }

  /**
   * @param force 发送、切会话等场景无视用户上翻，强制回到底部
   */
  function scrollToBottom(force = false) {
    if (force) pinnedToBottom.value = true;
    if (!pinnedToBottom.value) return;
    if (scrollPending) return;
    scrollPending = true;
    nextTick(() => {
      scrollPending = false;
      jumpToAnchor();
      // 图表、表格、markdown 图片是渲染后才撑开高度的，
      // nextTick 这一次只能滚到旧高度，补一次延迟兜底
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (pinnedToBottom.value) jumpToAnchor();
      }, 120);
    });
  }

  function setPinnedToBottom(pinned: boolean) {
    pinnedToBottom.value = pinned;
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
    scrollIntoView,
    pinnedToBottom,
    requestSeq,
    activeRequestSeq,
    activeAiMsgIndex,
    quickPrompts,
    replaceMessage,
    nextRequestSeq,
    invalidateActiveRequest,
    resetConversation,
    scrollToBottom,
    setPinnedToBottom,
  };
});

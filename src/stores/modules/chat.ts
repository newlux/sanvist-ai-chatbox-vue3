import type { Identifier } from "@/api/chat/types";
import type { UiChatMessage } from "@/stores/chat-types";
import { defineStore } from "pinia";
import { getCurrentInstance, inject, nextTick, provide, ref, watch } from "vue";
import { pickRoleQuickPrompts } from "@/config/quick-prompts";
import { useUserStore } from "@/stores/modules/user";

/** 默认会话域：首页那条主对话 */
export const DEFAULT_CHAT_SCOPE = "main";

const CHAT_SCOPE_KEY = Symbol("chat-scope");

/**
 * 声明当前页面属于哪个会话域。
 * 页面 setup 里调一次，之后本页所有 hook 拿到的都是这个域的 store。
 */
export function provideChatScope(scope: string) {
  provide(CHAT_SCOPE_KEY, scope);
  return scope;
}

export function useChatScope() {
  return inject<string>(CHAT_SCOPE_KEY, DEFAULT_CHAT_SCOPE);
}

const storeCache = new Map<string, ReturnType<typeof defineChatStore>>();

function defineChatStore(scope: string) {
  return defineStore(`chat:${scope}`, () => {
    const messages = ref<UiChatMessage[]>([]);
    const inputText = ref("");
    const isLoading = ref(false);
    const aiSessionId = ref<Identifier | null>(null);
    const showQuickPrompts = ref(true);
    const showQuickList = ref(true);
    const awakeningLoading = ref(false);
    /** 智能体分身：report(听汇报) / task(任务协同) / guide(作业指导)，空表示普通问答 */
    const subagent = ref("");
    const scrollIntoView = ref("");
    /** 用户是否还贴着底：上翻看历史时暂停自动滚动，回到底部后恢复 */
    const pinnedToBottom = ref(true);
    const requestSeq = ref(0);
    const activeRequestSeq = ref(0);
    /** 当前正在生成的那条 AI 消息 id。按 id 而不是下标记录，切会话后不会指错 */
    const activeMessageId = ref("");

    const userStore = useUserStore();
    const quickPrompts = ref(pickRoleQuickPrompts(userStore.visitorRole));

    function refreshQuickPrompts() {
      quickPrompts.value = pickRoleQuickPrompts(userStore.visitorRole, undefined, quickPrompts.value);
    }

    watch(() => userStore.visitorRole, refreshQuickPrompts);

    let scrollPending = false;
    let bottomAnchorToggle = false;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    function replaceMessage(index: number, message: UiChatMessage) {
      if (index < 0 || index >= messages.value.length) return;
      messages.value.splice(index, 1, message);
    }

    function findMessageIndex(id?: string) {
      if (!id) return -1;
      return messages.value.findIndex(item => item.id === id);
    }

    /**
     * 按消息 id 就地更新。
     * 流式回包是异步陆续到的，中途可能发生切会话、加载历史、插入新消息，
     * 用下标写回会串到别的消息上，只有 id 是稳的。找不到即视为该消息已不在当前会话。
     */
    function patchMessageById(id: string | undefined, patch: Partial<UiChatMessage>) {
      const index = findMessageIndex(id);
      if (index < 0) return false;
      messages.value.splice(index, 1, { ...messages.value[index], ...patch });
      return true;
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
      // 作废在途请求：不作废的话，旧流的回包会继续往新会话里写
      invalidateActiveRequest();
      messages.value = [];
      inputText.value = "";
      showQuickPrompts.value = true;
      showQuickList.value = true;
      refreshQuickPrompts();
      isLoading.value = false;
      aiSessionId.value = null;
      activeMessageId.value = "";
      pinnedToBottom.value = true;
    }

    function setSubagent(value: string) {
      subagent.value = value || "";
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

    /**
     * 把某个块滚到对话区顶部。
     *
     * scroll-into-view 只在值变化时生效，同一张卡需要重新对齐时（卡片收起后再点开同一步、
     * 步骤卡高度/底部间距量出来后触发的二次对齐）必须先清空再设回，否则不会滚动；
     * 空值是 no-op（uni 的实现里只有非空才滚），不会把列表拉回顶部。
     */
    function scrollBlockToTop(blockId: string) {
      if (scrollIntoView.value !== blockId) {
        scrollIntoView.value = blockId;
        return;
      }
      scrollIntoView.value = "";
      nextTick(() => {
        scrollIntoView.value = blockId;
      });
    }

    /**
     * 定位到某个步骤对应的核对卡（对话区的 .chat-box__card），并把它滚到对话区顶部：
     * 卡片顶在最上方才整张完整可见，贴底时会被底部步骤卡挡住大半。
     *
     * 能不能真的顶到，取决于页面给的底部间距（messageBottomInset 里的
     * max(步骤卡高, 对话区高 − 卡片高)）：间距不够时滚动会被浏览器夹在偏下的位置，
     * 这里只负责把滚动目标指向这张卡。
     * 注意这里不再贴底，也就不会把 pinnedToBottom 置回 true（贴底会让后续追加内容再滚一次、冲掉对齐）。
     * 从最后一条往前找，避免同一份步骤在历史里来回跳。
     */
    function focusStepBlock(stepId: string) {
      const target = String(stepId || "").trim();
      if (!target) return false;
      for (let index = messages.value.length - 1; index >= 0; index -= 1) {
        const block = (messages.value[index]?.blocks || [])
          .find(item => String(item?.payload?.step_id || "") === target);
        if (!block?.id) continue;
        scrollBlockToTop(String(block.id));
        return true;
      }
      return false;
    }

    return {
      messages,
      inputText,
      isLoading,
      aiSessionId,
      showQuickPrompts,
      showQuickList,
      awakeningLoading,
      subagent,
      scrollIntoView,
      pinnedToBottom,
      requestSeq,
      activeRequestSeq,
      activeMessageId,
      quickPrompts,
      refreshQuickPrompts,
      replaceMessage,
      findMessageIndex,
      patchMessageById,
      nextRequestSeq,
      invalidateActiveRequest,
      resetConversation,
      setSubagent,
      scrollToBottom,
      setPinnedToBottom,
      focusStepBlock,
    };
  });
}

/**
 * 取某个会话域的 store。
 *
 * 首页与智能体会话页各自持有一份消息、会话 ID、加载态——共用一份的话，
 * 打开智能体页面就得把首页那轮对话清掉，返回后也回不来。
 * 不传 scope 时从 provide 链上取，取不到再退到默认域。
 */
export function useChatStore(scope?: string) {
  const resolved = scope ?? (getCurrentInstance() ? useChatScope() : DEFAULT_CHAT_SCOPE);
  if (!storeCache.has(resolved)) storeCache.set(resolved, defineChatStore(resolved));
  return storeCache.get(resolved)!();
}

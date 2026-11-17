import type { Identifier } from "@/api/chat/types";
import type { UiChatMessage } from "@/stores/chat-types";
import { defineStore } from "pinia";
import { getCurrentInstance, inject, nextTick, provide, ref, watch } from "vue";
import { pickRoleQuickPrompts } from "@/config/quick-prompts";
import { useUserStore } from "@/stores/modules/user";
import { guideStepCardDomId } from "@/utils/guide-content";

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
    /**
     * 为 true 时自动滚动的落点改成「回复内容末尾（不含参考来源）」：
     * 以内容块容器 `.ai-content-blocks` 的高度减去参考来源 `.guide-source-block` 的高度为准，
     * 参考来源留在对话区下方之外；没有参考来源时就是原来的贴底。
     */
    const stopAtReplyEnd = ref(false);
    /** 滚动请求令牌：自增一次 = 一次请求，由消息列表量完 DOM 自己按 px 定位 */
    const replyEndToken = ref(0);
    /**
     * 「回到底部」请求令牌：自增一次 = 一次请求。
     *
     * 交给消息列表做两件事，顺序不能反：先收回封顶时为「可滚性」垫的空白，再按 px 落到真末尾。
     * 早先这里直接切底部锚点，垫白是下一拍才异步收回的，锚点先把视口滚到「空白最底部」，
     * 空白收回后内容变短、滚动位置被夹在原来那片白里 —— 用户看到的就是「点了回到底部，
     * 结果落在一段空白上，回复被顶出屏幕」。
     */
    const jumpToBottomToken = ref(0);
    /** 顶到上方的请求令牌 + 目标消息 id：自增一次 = 一次请求，由消息列表按 px 定位 */
    const pinMessageToken = ref(0);
    const pinMessageId = ref("");
    /**
     * 本轮跟随的上限（首页普通问答开启）：回答照常边写边贴底跟随，
     * 但一旦本轮提问顶到头部下沿就停住，后面的内容留在屏幕下方 ——
     * 用户主动点「回到底部」时关掉（见 jumpToBottom），否则会被下一次对齐拽回去。
     */
    const capRoundAtTop = ref(false);
    /**
     * 核对卡置顶的请求令牌 + 目标卡片 dom id：自增一次 = 一次请求。
     *
     * 步骤卡要被顶到对话区时不是用 scroll-into-view（那把元素顶部对到滚动容器最上沿，
     * 卡片会钻到悬浮头部下面被糊掉），而是发令牌让消息列表按 px 把卡片顶部对齐到
     * 「悬浮头部下沿」（见 ai-message-list 的 alignCardToHeaderBottom）。
     */
    const cardPinToken = ref(0);
    const cardPinDomId = ref("");
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
      // 新会话从干净状态起步：顶部呼吸位与本轮的跟随上限也一起复位
      pinMessageId.value = "";
      pinMessageToken.value = 0;
      capRoundAtTop.value = false;
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
        // 落点是「内容末尾（不含参考来源）」时，交给消息列表量完 DOM 按 px 定位
        const atReplyEnd = stopAtReplyEnd.value;
        if (atReplyEnd) replyEndToken.value += 1;
        else jumpToAnchor();
        // 图表、表格、markdown 图片是渲染后才撑开高度的，
        // nextTick 这一次只能滚到旧高度，补一次延迟兜底
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          settleTimer = null;
          if (!pinnedToBottom.value) return;
          if (atReplyEnd) replyEndToken.value += 1;
          else jumpToAnchor();
        }, 120);
      });
    }

    /**
     * 直接滚到内容最末：锚点定位，含最后一条消息的操作栏（播报 / 复制 / 反馈 / 分享）
     * 和参考来源，也就是用户肉眼认知的「到底了」。
     *
     * 和 scrollToBottom 的区别只在落点：stopAtReplyEnd 模式下那个落点是「回复正文末尾、
     * 不含参考来源」，尾部操作栏会留在输入栏下面看不见；用户主动点「回到底部」时要的是真末尾。
     */
    function jumpToBottom() {
      pinnedToBottom.value = true;
      // 用户要的是真末尾：本轮的「提问题顶到上方就停」上限一起撤掉，
      // 否则后面图片 / 图表撑高触发的对齐又会把视图拽回提问那边
      const wasCapped = capRoundAtTop.value;
      capRoundAtTop.value = false;
      if (settleTimer) clearTimeout(settleTimer);
      /**
       * 落点交给消息列表：封顶期间列表末尾垫过白，那块白只有列表自己知道多高。
       * 用令牌让它「先收白、再按 px 落到真末尾」（见 ai-message-list 的 bottomJumpToken）。
       */
      jumpToBottomToken.value += 1;
      /**
       * 封顶时底部锚点就在那段垫白之后，这一拍落锚点会先闪进白区 —— 跳过，
       * 等令牌把白收完再落（下面的 120ms 补量同时也是非 H5 端的锚点兜底）。
       */
      if (!wasCapped) jumpToAnchor();
      // 图表 / 表格 / 图片是渲染后才撑开高度的，补一次
      settleTimer = setTimeout(() => {
        settleTimer = null;
        if (!pinnedToBottom.value) return;
        jumpToBottomToken.value += 1;
        jumpToAnchor();
      }, 120);
    }

    /**
     * 只登记「本轮的提问是哪条」，不触发跳转。
     * 消息列表拿它算顶部呼吸位（发过问之后内容从更靠下的位置起步），
     * 和 pinMessageToTop 的区别是不动滚动位置。
     */
    function setPinMessage(messageId: string) {
      pinMessageId.value = String(messageId || "").trim();
    }

    /** 进入 / 退出「提问顶到头部下沿就停」的跟随上限（发问时开，点回到底部 / 换会话时关） */
    function setCapRoundAtTop(value: boolean) {
      capRoundAtTop.value = Boolean(value);
    }

    /**
     * 请求把某条消息顶到对话区上方（悬浮头部下沿）。
     * 只动令牌，真正的 px 定位由消息列表量完 DOM 做 —— 这里拿不到布局。
     */
    function pinMessageToTop(messageId: string) {
      const target = String(messageId || "").trim();
      if (!target) return;
      pinMessageId.value = target;
      pinMessageToken.value += 1;
    }

    function setPinnedToBottom(pinned: boolean) {
      if (pinned === pinnedToBottom.value) return;
      pinnedToBottom.value = pinned;
    }

    /** 进入 / 退出「落到内容末尾（不含参考来源）」模式（页面 setup 时打开一次） */
    function setStopAtReplyEnd(value: boolean) {
      stopAtReplyEnd.value = Boolean(value);
    }

    /**
     * 定位到某个步骤对应的核对卡（对话区的 .chat-box__card），并把它顶到「悬浮头部下沿」。
     * 卡片顶在头部下沿才整张完整可见，贴底时会被底部固定 UI（输入栏 / 步骤白板）挡住大半。
     *
     * 不走 scroll-into-view（那把元素顶部对到滚动容器最上沿，卡片会钻到悬浮头部下面被糊掉），
     * 这里只负责按 step_id 定位到那张卡、发「置顶令牌」，由消息列表量完 DOM 按 px 对齐（见
     * ai-message-list 的 alignCardToHeaderBottom）。命中即关掉贴底——贴底会让后续追加内容滚一次、
     * 冲掉对齐。
     * 从最后一条往前找，避免同一份步骤在历史里来回跳。
     * 卡片在 DOM 上的 id 并进了消息 id（guideStepCardDomId），这里必须按同一规则拼，才能指到那张卡。
     */
    function focusStepBlock(stepId: string) {
      const target = String(stepId || "").trim();
      if (!target) return false;
      for (let index = messages.value.length - 1; index >= 0; index -= 1) {
        const message = messages.value[index];
        const block = (message?.blocks || [])
          .find(item => String(item?.payload?.step_id || "") === target);
        if (!block?.id) continue;
        // 不再用 scroll-into-view 顶部对齐（会把卡片塞到悬浮头部下面被糊掉），
        // 改为发「置顶令牌」：消息列表量完 DOM 按 px 把卡片对齐到悬浮头部下沿。
        cardPinDomId.value = guideStepCardDomId(message?.id, block.id);
        cardPinToken.value += 1;
        return true;
      }
      return false;
    }

    return {
      /**
       * 会话域标识（main / guide / task / podcast）：只读。
       * 少数「页面级差异化」的判断要用它（如历史消息里要不要按新手身份过滤老师傅导语），
       * 页面自己 provide 的 scope 在 store 外拿不到。
       */
      scope,
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
      replyEndToken,
      jumpToBottomToken,
      cardPinToken,
      cardPinDomId,
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
      jumpToBottom,
      setPinnedToBottom,
      setStopAtReplyEnd,
      focusStepBlock,
      pinMessageToken,
      pinMessageId,
      capRoundAtTop,
      setPinMessage,
      setCapRoundAtTop,
      pinMessageToTop,
    };
  });
}

/**
 * 消息在 DOM 上的锚点 id，给「顶到对话区上方」的 px 定位用。
 * 统一在这里拼，消息列表渲染与滚动请求才不会各写一套拼错。
 */
export function chatMessageAnchorDomId(id: Identifier | string | number | null | undefined) {
  return `msg-anchor-${id ?? ""}`;
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

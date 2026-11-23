import type { useChatStore } from "./chat";
import type { Conversation, Identifier } from "@/api/chat/types";
import type { UiChatMessage } from "@/stores/chat-types";
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  batchDeleteConversations,
  deleteConversation,
  getConversations,
  getMessages,
  renameConversation,
} from "@/api/chat";
import { stripEmergencyTags, stripReportStyleTags, stripRoleTags, stripVoiceStyleTags } from "@/utils/ai-stream";
import { extractDifyHistoryBlocks } from "@/utils/ai-stream/dify";
import { parseRepairCallbackSummary } from "@/utils/repair-callback";
import { isPodcastSession } from "@/utils/session-scene";
import { useUserStore } from "./user";

type ChatStore = ReturnType<typeof useChatStore>;

/** 从 file-preview 直链路径取文件标识；仅作附件标识，不再用于拼预览接口地址。 */
function getPreviewFileId(value: unknown) {
  const matched = /\/files\/([^/?#]+)\/(?:preview|file-preview)(?:[/?#]|$)/i.exec(String(value || ""));
  if (!matched?.[1]) return "";
  try {
    return decodeURIComponent(matched[1]);
  } catch {
    return matched[1];
  }
}

function readHistoryFileType(value: unknown) {
  const raw = String(value || "").toLowerCase();
  if (!raw) return "document";
  if (raw === "image" || raw.startsWith("image/")) return "image";
  if (raw === "audio" || raw.startsWith("audio/")) return "audio";
  if (raw === "video" || raw.startsWith("video/")) return "video";
  return raw;
}

/** 历史 / 网关可能把附件放在 message_files、messageFiles 或发送回显的 files。空数组不能当有值。 */
function pickHistoryFileList(item: Record<string, unknown>) {
  const inputs = item.inputs && typeof item.inputs === "object"
    ? item.inputs as Record<string, unknown>
    : {};
  const candidates = [item.messageFiles, item.message_files, item.files, inputs.files];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

/** 历史消息没有本地临时路径，图片由气泡组件根据 fileId 请求 preview 接口。 */
function mapHistoryAttachments(value: unknown) {
  return (Array.isArray(value) ? value : []).map((raw) => {
    const file = raw as Record<string, unknown>;
    const belongsTo = String(file.belongs_to || file.belongsTo || "user").toLowerCase();
    if (belongsTo === "assistant") return null;
    const type = readHistoryFileType(file.type);
    // message_files[].url 本身就是完整的可渲染地址（Dify 带 timestamp/nonce/sign 的
    // file-preview 直链），<img> 直接 GET 即可，不再抠 file id 去拼鉴权预览接口。
    const url = String(file.url || file.source_url || file.sourceUrl || file.preview_url || file.previewUrl || "");
    return {
      // fileId 仅作附件标识：remote_url 投递的文件 upload_file_id 恒为 null，只能从 url 路径派生。
      fileId: String(
        file.upload_file_id
        || file.uploadFileId
        || file.related_id
        || file.relatedId
        || file.file_id
        || file.fileId
        || getPreviewFileId(url)
        || file.id
        || "",
      ),
      url,
      name: String(file.name || file.filename || (type === "image" ? "图片" : "附件")),
      type,
      size: Number(file.size) || undefined,
      mimeType: String(file.mime_type || file.mimeType || ""),
    };
  }).filter((file): file is NonNullable<typeof file> => Boolean(file && (file.fileId || file.url)));
}

export function mapHistoryMessages(
  list: unknown[],
  fallbackSessionId: Identifier | null,
  /**
   * 是否按新手（分步骤）身份过滤老师傅导语（voice 块），默认 true。
   * 任务协同不区分新老手，调用方传 false（见 loadHistory 里的 scope 判断）。
   */
  options: { hideNoviceVoice?: boolean } = {},
): UiChatMessage[] {
  const mapped: UiChatMessage[] = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const item = raw as Record<string, unknown>;
    const sessionId = (item?.conversationId || fallbackSessionId || null) as Identifier | null;
    const messageId = (item?.id ?? null) as Identifier | null;
    const inputs = item?.inputs && typeof item.inputs === "object" ? item.inputs as Record<string, unknown> : {};
    const isAssistantCallback = inputs.entry_type === "assistant_callback";
    const userText = String(item?.query || "").trim();
    // 历史里的回流数据存在 query 上：带 status 的是故障诊断，没有的是快问快答。
    const callbackSummary = isAssistantCallback ? parseRepairCallbackSummary(userText) : null;
    const attachments = mapHistoryAttachments(pickHistoryFileList(item));
    // 标准 Dify answer 中可能内嵌 SANVIST/ASK/GUIDE 协议，按原顺序还原文本与富内容卡片。
    const blocks = extractDifyHistoryBlocks(item?.answer)
      // 历史正文里的 <OWNER>…</OWNER> 身份标签只剔源码、不切身份；
      // <VOICE_STYLE style="…"> 音色、<REPORT_STYLE style="…"> 播报风格同样只剔源码、不改当前配置：
      // 回看旧会话不该把当前音色 / 风格改回去；
      // <EMERGENCY>…</EMERGENCY> 只剔源码、不重复触发加急动作
      .map(block => block.type === "answer"
        ? {
            ...block,
            payload: {
              ...block.payload,
              content: stripEmergencyTags(
                stripReportStyleTags(stripVoiceStyleTags(stripRoleTags(String(block.payload.content || "")))),
              ),
            },
          }
        : block)
      .filter(block => block.type !== "answer" || String(block.payload.content || "").trim())
      // 新手（分步骤）回看旧会话：连播报素材一起丢 —— 老师傅导语（voice）块本身
      // 已经不渲染了（AiContentBlocks 一律不显示），这里留着是为了不让它进整段播报。
      // 任务协同没有新老手之分，调用方传 hideNoviceVoice: false，导语照常念。
      .filter((block) => {
        if (options.hideNoviceVoice === false) return true;
        return !(useUserStore().operatorRole?.roleKey === "novice_operator" && block.type === "voice");
      })
      .map((block, index) => ({
        id: `history-${messageId ?? "message"}-${block.type}-${index}`,
        type: block.type,
        payload: block.payload,
        complete: true,
      }));
    if (!isAssistantCallback && (userText || attachments.length)) {
      mapped.push({ role: "user", content: userText, attachments, sessionId, messageId });
    }
    if (blocks.length) {
      const feedback = item?.feedback as { rating?: string; content?: string } | undefined;
      mapped.push({
        role: "ai",
        content: "",
        blocks,
        loading: false,
        ttsEnabled: Boolean(sessionId && messageId),
        ttsPlaybackMode: "realtime",
        ttsLoading: false,
        ttsPlaying: false,
        sessionId,
        messageId,
        positive: feedback?.rating === "like" ? true : feedback?.rating === "dislike" ? false : null,
        feedbackValue: feedback?.rating === "like" ? "good" : feedback?.rating === "dislike" ? "bad" : "",
        feedbackRemark: feedback?.content || "",
        ...(callbackSummary
          ? {
              assistantCallbackTitle: callbackSummary.title,
              assistantCallbackStatus: callbackSummary.statusText,
              assistantCallbackDetails: callbackSummary.details,
              assistantCallbackConversationId: callbackSummary.repairConversationId,
            }
          : {}),
      });
    }
  });
  return mapped;
}

/** 单页历史消息条数。会话页首屏只拉这一页，上翻再补 */
const HISTORY_PAGE_SIZE = 30;

export const useSessionStore = defineStore("session", () => {
  const sessions = ref<Conversation[]>([]);
  /** 历史消息分页游标：接口按 firstId 往前翻 */
  const historyFirstId = ref<Identifier | null>(null);
  const historyHasMore = ref(false);
  const historyLoading = ref(false);
  const isSessionSwitching = ref(false);
  const hasMore = ref(true);
  const lastId = ref<Identifier | null>(null);

  async function loadSessions(pageNo = 1, pageSize = 20) {
    if (pageNo === 1) {
      lastId.value = null;
      hasMore.value = true;
    }

    const visible: Conversation[] = [];
    while (hasMore.value && visible.length < pageSize) {
      const page = await getConversations({
        lastId: lastId.value || undefined,
        limit: pageSize - visible.length,
        sortBy: "-updated_at",
      });
      const rows = Array.isArray(page?.data) ? page.data : [];
      // 低端安卓 WebView 不支持 ES2022 的 Array.prototype.at
      lastId.value = rows[rows.length - 1]?.id || null;
      hasMore.value = Boolean(page?.hasMore) && rows.length > 0;
      visible.push(...rows.filter(session => !isPodcastSession(session)));
    }

    const pageVisible = visible.slice(0, pageSize);
    sessions.value = pageNo === 1
      ? pageVisible
      : [...sessions.value, ...pageVisible.filter(session => !sessions.value.some(item => item.id === session.id))];
    return { data: pageVisible, hasMore: hasMore.value };
  }

  /**
   * 当前这一批历史消息的请求序号。
   *
   * 载入 / 上翻都是异步的，期间可能切了会话、或把这条会话直接删了 ——
   * 回包落到新会话 / 已清空的列表上，就是「删掉的历史又冒出来」那种串写。
   * 每次载入领一个新号，回包时对不上就丢弃。
   */
  const historyRequestSeq = ref(0);

  /** 这批历史是否已经失效：序号被后一次载入顶掉，或当前会话已经不是它 */
  function isStaleHistory(seq: number, sessionId: Identifier, chatStore: ChatStore) {
    return seq !== historyRequestSeq.value || String(chatStore.aiSessionId) !== String(sessionId);
  }

  /**
   * 载入某个会话的历史消息（最近一页）。
   * chatStore 由调用方传入：首页和智能体页面各有自己的会话域，
   * 这里默认取一个的话就会写错页面。
   */
  async function loadHistory(sessionId: Identifier, chatStore: ChatStore) {
    const seq = ++historyRequestSeq.value;
    try {
      const page = await getMessages({
        conversationId: sessionId,
        limit: HISTORY_PAGE_SIZE,
      });
      /**
       * 回包时再判一次：打开历史会话的过程中，用户可能已经点开了别的会话，
       * 或者把这条会话删掉了（删除会 resetConversation，aiSessionId 被清空）。
       * 此时这批消息已经不属于当前列表，写进去就是「已删除的会话消息复活」——
       * 表现是删完还挂着旧消息、再发问又新开一个会话。
       */
      if (isStaleHistory(seq, sessionId, chatStore)) return;
      const rows = page?.data || [];
      chatStore.messages = mapHistoryMessages(rows, sessionId, { hideNoviceVoice: chatStore.scope !== "task" });
      // 接口按时间正序返回，最早的一条就是下一页的游标
      historyFirstId.value = (rows[0]?.id ?? null) as Identifier | null;
      historyHasMore.value = Boolean(page?.hasMore);
      chatStore.showQuickPrompts = false;
      chatStore.showQuickList = false;
      chatStore.scrollToBottom(true);
    } catch (error) {
      // 会话已经被切走 / 删掉时，这个失败（多为 404）是预期的，不再往上抛，
      // 否则页面会弹一个「加载历史失败」——删除当前会话时最容易被看到
      if (isStaleHistory(seq, sessionId, chatStore)) return;
      throw error;
    } finally {
      historyLoading.value = false;
    }
  }

  /**
   * 上翻加载更早的消息，插到列表头部。
   * 不动滚动位置：滚到顶才会触发，内容插在上方，用户当前看的那条仍在视野里。
   */
  async function loadMoreHistory(chatStore: ChatStore) {
    const sessionId = chatStore.aiSessionId;
    if (!sessionId || !historyHasMore.value || historyLoading.value) return false;
    if (!historyFirstId.value) return false;

    // 与 loadHistory 共用同一个序号：上翻期间切会话 / 删会话，这一页也不能插进来
    const seq = historyRequestSeq.value;
    historyLoading.value = true;
    try {
      const page = await getMessages({
        conversationId: sessionId,
        firstId: historyFirstId.value,
        limit: HISTORY_PAGE_SIZE,
      });
      if (isStaleHistory(seq, sessionId, chatStore)) return false;
      const rows = page?.data || [];
      if (!rows.length) {
        historyHasMore.value = false;
        return false;
      }
      const older = mapHistoryMessages(rows, sessionId, { hideNoviceVoice: chatStore.scope !== "task" });
      chatStore.messages = [...older, ...chatStore.messages];
      historyFirstId.value = (rows[0]?.id ?? null) as Identifier | null;
      historyHasMore.value = Boolean(page?.hasMore);
      return true;
    } finally {
      historyLoading.value = false;
    }
  }

  /**
   * Dify 用来校验会话归属的 user 标识。
   *
   * 口径必须和「创建会话」时完全一致 —— 也就是 /chat-messages 请求体里的那个 user
   * （见 useChatSend 的 `userStore.userId || "guest"`）：归属对不上，DELETE 会按
   * 会话不存在处理，前端只能看到「删除失败」。
   *
   * 所以这里不再抛「缺少 Dify 用户标识」，而是按同一套兜底到 "guest"：
   * 之前宿主没传 userId 的容器里 store 是空的，会话列表接口又不带 user、照样能加载，
   * 结果就是「列表能看、点删除必定失败」，删除 / 批量删除 / 重命名一起失效。
   */
  function getDifyUser() {
    return String(useUserStore().userId || "").trim() || "guest";
  }

  async function removeSession(sessionId: Identifier) {
    await deleteConversation(sessionId, getDifyUser());
    await loadSessions();
  }

  /**
   * 批量删除。
   *
   * 部分成功不抛错：删掉的那部分已经从服务端消失，列表必须刷新，
   * 否则用户会对着已经不存在的会话反复删、反复收「批量删除失败」。
   * 返回 failed（没删掉的 id），调用方可据此提示或重试；
   * 一条都没删掉时 api 层仍然抛错，页面照常提示失败。
   */
  async function removeSessions(ids: Identifier[]) {
    const result = await batchDeleteConversations({
      conversationIds: ids,
      user: getDifyUser(),
    });
    await loadSessions();
    return result;
  }

  async function renameSession(sessionId: Identifier, name: string) {
    await renameConversation(sessionId, {
      name: name.slice(0, 200),
    });
    sessions.value = sessions.value.map(item => (
      item.id === sessionId ? { ...item, name } : item
    ));
    await loadSessions();
  }

  return {
    sessions,
    isSessionSwitching,
    hasMore,
    loadSessions,
    historyHasMore,
    historyLoading,
    loadHistory,
    loadMoreHistory,
    removeSession,
    removeSessions,
    renameSession,
  };
});

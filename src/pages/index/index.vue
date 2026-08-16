<script setup>
import { onShow } from "@dcloudio/uni-app";
import { useHookFetch } from "hook-fetch/vue";
import html2canvas from "html2canvas";
import { useI18n } from "vue-i18n";
import {
  cancelFeedback,
  deleteConversation,
  getConversations,
  interruptChat,
  sendChatMessage,
  submitFeedback,
} from "@/api/chat";
import iconImage from "@/assets/img/icon-share-image.svg";
import iconWechat from "@/assets/img/icon-share-wechat.svg";
import iconQQ from "@/assets/img/icon-share-qq.svg";
import iconLink from "@/assets/img/icon-share-link.svg";
import iconSaveImage from "@/assets/img/icon-save-image.svg";
import iconCopyImage from "@/assets/img/icon-copy-image.svg";
import { GCPAPI } from "@/common/api/gcp";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";

import AiWelcome from "@/components/ai-welcome/index.vue";
import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useSystemStore, useUserStore } from "@/stores";
import {
  applyEventToBlocks,
  buildInitialBlocks,
} from "@/utils/ai-stream/chatStreamParser";
import { parseHistoryBlocks } from "@/utils/ai-stream/sseParser";

defineOptions({ name: "AiChatPage" });

const { t } = useI18n();
const systemStore = useSystemStore();
const userStore = useUserStore();
const { safeAreaStyle } = useSafeArea();
const { stream, cancel } = useHookFetch({
  request: sendChatMessage,
  onError: error => console.error("[AiChatPage] stream request failed", error),
});
const sharePosterWrap = ref(null);

const state = reactive({
  // 页面阶段: 'welcome' | 'chat'
  stage: "welcome",
  sessions: [],
  // 快捷提示词（后续由接口提供；这里用本地默认值兜底）
  quickPrompts: [
    "设备的在线或离线情况",
    "最近 7 天设备作业情况",
  ],
  showQuickPrompts: true,
  showQuickList: true,
  // 消息列表
  messages: [],

  // 输入框
  inputText: "",
  // 键盘高度（px），用于消息列表滚动占位，避免底部空白/按钮被遮挡
  keyboardHeightPx: 0,
  // 键盘打开时间戳（用于判断是否是真正抬起，避免 iPhone 聚焦过程抖动误触发滚动）
  _keyboardOpenedAt: 0,
  _scrollToBottomOnKeyboardHideTimer: null,
  shareSheetVisible: false,
  shareSelectedIndexes: [],
  shareSuppressHighlight: false,

  // 分享长图
  sharePosterVisible: false,
  sharePosterDataUrl: "",
  sharePosterGenerating: false,

  // 底部点踩反馈弹窗
  badFeedbackSheetVisible: false,
  _badFeedbackCtx: null,

  // 加载状态
  isLoading: false,
  // 当前激活的流式请求序号（用于取消/忽略过期结果）
  _requestSeq: 0,
  _activeRequestSeq: 0,
  // H5 fetch-stream 的取消控制器（新发送时 abort 上一次请求）
  _activeStreamAbortController: null,
  _activeStreamHardTimeout: null,
  // uni.request 的取消句柄（由 gcpFetchFactory 注入的 p.abort）
  _activeReplyAbortFn: null,
  // 当前等待回答的 AI 占位消息下标（用于取消时立即收尾 UI）
  _activeAiMsgIndex: -1,
  // 短时去重：避免一次用户操作触发多次 sendMessage
  _lastSendAt: 0,
  _lastSendText: "",
  // 会话切换中的页面级 loading（居中展示）
  isSessionSwitching: false,

  // 滚动控制
  scrollTop: 0,
  scrollIntoView: "",
  _bottomAnchorToggle: false,
  _scrollPending: false,
  _finalScrollTimer: null,
  _audioCtx: null,

  /** AI 会话 id：首条为 null，send 成功后由接口返回写入 */
  aiSessionId: null,
  /** 会话列表游标分页 */
  _sessionHasMore: true,
  _sessionLastId: null,
});

const {
  stage,
  sessions,
  showQuickPrompts,
  showQuickList,
  messages,
  inputText,
  keyboardHeightPx,
  shareSheetVisible,
  shareSelectedIndexes,
  shareSuppressHighlight,
  sharePosterVisible,
  sharePosterDataUrl,
  sharePosterGenerating,
  badFeedbackSheetVisible,
  isLoading,
  isSessionSwitching,
  scrollTop,
  scrollIntoView,
  aiSessionId,
} = toRefs(state);

const shareSheetOptions = computed(() => {
  return [
    {
      key: "wechat",
      label: "微信",
      icon: iconWechat,
    },
    {
      key: "qq",
      label: "QQ",
      icon: iconQQ,
    },
    {
      key: "share-image",
      label: "图片分享",
      icon: iconImage,
    },
    {
      key: "copy-link",
      label: "分享链接",
      icon: iconLink,
    },
  ];
});

const shareRoundMeta = computed(() => {
  const rounds = _buildShareRounds();
  const roundCount = rounds.length;
  const hasInterrupted = rounds.some(r => r.interrupted);
  const selectableIndexes = rounds
    .flatMap(r => r.selectableIndexes || [])
    .filter(x => Number.isInteger(x));
  const uniq = Array.from(new Set(selectableIndexes)).sort((a, b) => a - b);
  return { rounds, roundCount, hasInterrupted, selectableIndexes: uniq };
});

const shareSelectAllDisabled = computed(() => {
  return (shareRoundMeta.value.roundCount || 0) > 5;
});

const shareSelectedRoundCount = computed(() => {
  const rounds = _buildShareRounds();
  const selected = new Set((state.shareSelectedIndexes || []).map(x => x));
  return rounds.filter((r) => {
    const idxs = [r.userIndex].concat(r.aiIndex >= 0 ? [r.aiIndex] : []);
    return idxs.some(idx => selected.has(idx));
  }).length;
});

const shareAllChecked = computed(() => {
  const meta = shareRoundMeta.value;
  const selectable = meta.selectableIndexes || [];
  if (!selectable.length) return false;
  const selected = new Set((state.shareSelectedIndexes || []).map(x => x));
  return selectable.every(i => selected.has(i));
});

const localizedQuickPrompts = computed(() => {
  const prompts = Array.isArray(state.quickPrompts) ? state.quickPrompts : [];
  return prompts.map(item => t(item));
});

watch(
  () => state.messages.length,
  () => {
    nextTick(() => _scrollToBottom());
  },
);

watch(
  () => userStore.userId,
  (val) => {
    if (!val) return;
    getAISessionList().catch(error => console.error("[AiChatPage] preload sessions failed", error));
  },
  { immediate: true },
);

function _replaceMessage(index, message) {
  state.messages.splice(index, 1, message);
}

function _isShareMessageDisabled(index) {
  const list = Array.isArray(state.messages) ? state.messages : [];
  const msg = list[index] || {};
  if (msg.role === "ai") return Boolean(msg.interrupted);
  if (msg.role === "user") {
    const next = list[index + 1];
    return Boolean(next && next.role === "ai" && next.interrupted);
  }
  return false;
}

function _buildShareRounds() {
  const list = Array.isArray(state.messages) ? state.messages : [];
  const rounds = [];
  for (let i = 0; i < list.length; i += 1) {
    const msg = list[i] || {};
    if (msg.role !== "user") continue;
    const next = list[i + 1];
    const aiIndex = next && next.role === "ai" ? i + 1 : -1;
    const interrupted = Boolean(aiIndex >= 0 && list[aiIndex]?.interrupted);
    const indexes = [i].concat(aiIndex >= 0 ? [aiIndex] : []);
    const selectableIndexes = indexes.filter(idx => !_isShareMessageDisabled(idx));
    rounds.push({
      userIndex: i,
      aiIndex,
      interrupted,
      selectableIndexes,
    });
  }
  return rounds;
}

function _isAbortError(err) {
  if (!err) return false;
  const name = err.name || "";
  return (
    name === "AbortError" ||
    String(err.message || "")
      .toLowerCase()
      .includes("aborted") ||
      String(err.message || "")
        .toLowerCase()
        .includes("abort")
  );
}

function onKeyboardHeightChange(heightPx) {
  // 来自 `ai-chat-input`：只在键盘打开时写入，避免拖出多余空白
  const prev = Number(state.keyboardHeightPx) || 0;
  const h = Number(heightPx) || 0;
  const isIOS = Boolean(systemStore.isIOS);
  // iPhone 给足上限，避免按钮被键盘遮住
  const maxH = isIOS ? 520 : 800;
  const next = Math.max(0, Math.min(h, maxH));
  // 抑制 iPhone 键盘动画阶段的小幅抖动更新
  if (Math.abs(next - (Number(state.keyboardHeightPx) || 0)) < 25) return;
  state.keyboardHeightPx = next;

  // 键盘关闭滚到底：需要“持续打开足够时间”+ 再延迟，避免 iPhone 聚焦阶段的高度抖动触发误滚动
  if (state.stage !== "chat") return;

  if (next > 0) {
    state._keyboardOpenedAt = state._keyboardOpenedAt || Date.now();
    if (state._scrollToBottomOnKeyboardHideTimer) {
      clearTimeout(state._scrollToBottomOnKeyboardHideTimer);
      state._scrollToBottomOnKeyboardHideTimer = null;
    }
    return;
  }

  // next === 0
  if (prev <= 0) return;
  const openedDuration = state._keyboardOpenedAt ? Date.now() - state._keyboardOpenedAt : 0;
  if (openedDuration < 300) return;

  if (state._scrollToBottomOnKeyboardHideTimer) {
    clearTimeout(state._scrollToBottomOnKeyboardHideTimer);
  }
  state._scrollToBottomOnKeyboardHideTimer = setTimeout(() => {
    if (state.keyboardHeightPx !== 0) return;
    _scrollToBottom();
    state._scrollToBottomOnKeyboardHideTimer = null;
  }, 200);
}

function _cancelActiveStream() {
  const idx = Number(state._activeAiMsgIndex);
  const activeMessage = Number.isInteger(idx) && idx >= 0 ? state.messages[idx] : null;

  state._activeRequestSeq = state._requestSeq + 1;
  state._requestSeq = state._activeRequestSeq;
  try {
    cancel();
  } catch (error) {
    console.error("[AiChatPage] failed to cancel stream", error);
  }

  if (activeMessage?.sessionId && activeMessage?.messageId) {
    interruptChat({
      conversationId: activeMessage.sessionId,
      messageId: activeMessage.messageId,
    }).catch(error => console.error("[AiChatPage] failed to interrupt chat", error));
  }

  if (activeMessage?.loading) {
    _replaceMessage(idx, {
      ...activeMessage,
      loading: false,
      interrupted: true,
    });
  }
  state._activeAiMsgIndex = -1;
}

function stopGenerating() {
  if (!state.isLoading) return;
  _cancelActiveStream();
  state.isLoading = false;
  _scrollToBottom();
}

function onShareClick(payload) {
  const group = Array.isArray(payload?.group) ? payload.group : [];
  state.shareSelectedIndexes = group;
  state.shareSheetVisible = true;
  state.shareSuppressHighlight = true;
}
function onShareSelectToggle(payload) {
  const group = Array.isArray(payload?.group) ? payload.group : [];
  if (!group.length) return;
  const current = new Set((state.shareSelectedIndexes || []).map(x => x));
  const allSelected = group.every(i => current.has(i));
  const next = new Set(current);
  if (allSelected) {
    group.forEach(i => next.delete(i));
  } else {
    group.forEach(i => next.add(i));
  }

  // 规则1：分享对话不能超过 5 轮（按 user->ai 为一轮统计）
  if (!allSelected) {
    const rounds = _buildShareRounds();
    const nextSelected = next;
    const selectedRoundCount = rounds.filter((r) => {
      const idxs = [r.userIndex].concat(r.aiIndex >= 0 ? [r.aiIndex] : []);
      return idxs.some(idx => nextSelected.has(idx));
    }).length;
    if (selectedRoundCount > 5) {
      uni.showToast({
        title: t("share-max-round-warning"),
        icon: "none",
      });
      return;
    }
  }
  state.shareSelectedIndexes = Array.from(next).sort((a, b) => a - b);
  // 用户手动选择后，恢复正常“选中高亮”表现
  state.shareSuppressHighlight = false;
}
function onShareSelectAll() {
  const meta = shareRoundMeta.value;
  if ((meta.roundCount || 0) > 5) return;
  // 支持反选：若当前已处于“全选”状态，则再次点击清空
  if (shareAllChecked.value) {
    state.shareSelectedIndexes = [];
    state.shareSuppressHighlight = false;
    return;
  }

  state.shareSelectedIndexes = meta.selectableIndexes || [];
  // 规则2：不足 5 轮但存在中断轮次：全选只勾选，不高亮
  state.shareSuppressHighlight =
    (meta.roundCount || 0) <= 5 &&
    (meta.roundCount || 0) > 0 &&
    Boolean(meta.hasInterrupted) &&
    (meta.roundCount || 0) < 5;
}
function closeShareSheet(clear = true) {
  state.shareSheetVisible = false;
  if (clear) {
    state.shareSelectedIndexes = [];
    state.shareSuppressHighlight = false;
  }
}
async function _copyTextToClipboard(text) {
  const safeText = String(text || "");
  if (!safeText) return false;

  try {
    if (typeof uni !== "undefined" && typeof uni.setClipboardData === "function") {
      await new Promise((resolve, reject) => {
        uni.setClipboardData({
          data: safeText,
          success: resolve,
          fail: reject,
        });
      });
      return true;
    }
  } catch (e) {
    console.error("[AiChatPage] uni clipboard error", e);
  }

  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (e) {
    console.error("[AiChatPage] navigator clipboard error", e);
  }

  return false;
}

function _toPlainText(markdown) {
  const source = String(markdown || "");
  const codeBlocks = source.split("```");

  return codeBlocks
    .map((part, index) => {
      const text = index % 2 === 1 ? part.replace(/^[^\n]*\n/, "") : part;
      return text
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/[*`_~]/g, "");
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function _getCopyableMessageContent(msg) {
  const directContent = String(msg?.content || "").trim();
  if (directContent) return _toPlainText(directContent);

  const answerContent = (Array.isArray(msg?.blocks) ? msg.blocks : [])
    .filter(block => block?.type === "answer")
    .map(block => String(block?.payload?.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (answerContent) return _toPlainText(answerContent);

  return _toPlainText(msg?.rawSseText);
}

async function onCopyMessage({ msg }) {
  const content = _getCopyableMessageContent(msg);
  if (!content) {
    uni.showToast({ title: "复制失败，请手动复制", icon: "none" });
    return;
  }

  const copied = await _copyTextToClipboard(content);
  uni.showToast({
    title: copied ? t("copy-success") : "复制失败，请手动复制",
    icon: "none",
  });
}
async function onShareSheetOption(item) {
  const key = item?.key;
  // 生成海报需要保留勾选内容，因此这里不清空 selection
  closeShareSheet(false);
  if (key === "copy-link") {
    // 复制链接 https://portal.sanygroup.com/appDownload/
    const url = "https://portal.sanygroup.com/appDownload/";
    const ok = await _copyTextToClipboard(url);
    if (ok) {
      uni.showToast({ title: t("copy-success"), icon: "none" });
    } else {
      uni.showToast({
        title: t("copy-failed-please-manually-copy"),
        icon: "none",
      });
    }
    closeShareSheet(true);
    return;
  }

  if (key === "share-image") {
    if (state.shareSelectedIndexes.length === 0) return;
    openSharePoster();
    return;
  }

  if (key === "wechat" || key === "qq") {
    uni.showToast({ title: "暂不支持此分享方式", icon: "none" });
    closeShareSheet(true);
    return;
  }

  // 未识别的分享类型：回到可重新选择状态
  closeShareSheet(true);
}

function openSharePoster() {
  if (state.sharePosterGenerating) return;
  state.sharePosterVisible = true;
  state.sharePosterDataUrl = "";
  state.sharePosterGenerating = true;

  nextTick(async () => {
    // 等待 Markdown 渲染、字体与布局稳定
    await new Promise(r => setTimeout(r, 1500));
    try {
      await _generateSharePosterLongImage();
    } catch (e) {
      console.error("[AiChatPage] caught error", e);
      uni.showToast({
        title: t("share-poster-generate-failed"),
        icon: "none",
      });
      console.error(e);
    } finally {
      state.sharePosterGenerating = false;
    }
  });
}

function closeSharePosterModal() {
  state.sharePosterVisible = false;
  state.sharePosterDataUrl = "";
  state.sharePosterGenerating = false;
  // 关闭长图后清空选择态，恢复到可重新选择的状态
  closeShareSheet(true);
}

async function _generateSharePosterLongImage() {
  if (typeof document === "undefined") {
    throw new TypeError("not-h5");
  }

  // html2canvas 只在 Web 环境工作
  const elFromDom =
    typeof document !== "undefined" ? document.getElementById("share-poster-wrap") : null;
  const el = elFromDom || sharePosterWrap.value;
  if (!el) throw new Error("poster-element-missing");

  // 等待海报内部内容把高度撑起来（Markdown 渲染/组件初始化可能是异步）
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let lastHeight = Number(el.scrollHeight || el.offsetHeight || 0);
  const expectedBubbleCount = (() => {
    const list = Array.isArray(state.messages) ? state.messages : [];
    const idxs = Array.isArray(state.shareSelectedIndexes) ? state.shareSelectedIndexes : [];
    return idxs.map(idx => list[idx]).filter(Boolean).length;
  })();

  // 同时等待：气泡数量达到期望 + 高度稳定
  let stable = 0;
  let finalHeightPx = lastHeight;
  for (let i = 0; i < 20; i += 1) {
    await sleep(300);

    let bubbleCount = 0;
    try {
      bubbleCount = el.querySelectorAll ? el.querySelectorAll(".bubble-item").length : 0;
    } catch (e) {
      console.error("[AiChatPage] caught error", e);
      bubbleCount = 0;
    }

    const h = Number(el.scrollHeight || el.offsetHeight || 0);
    finalHeightPx = h || finalHeightPx;

    const bubbleReady = bubbleCount >= expectedBubbleCount && expectedBubbleCount >= 0;
    const heightStable = h > 0 && Math.abs(h - lastHeight) <= 2;

    if (bubbleReady && heightStable) {
      stable += 1;
      if (stable >= 2) break;
    } else {
      stable = 0;
      lastHeight = h;
    }
  }

  // 内容很少时，导出的长图容易过矮影响观感；
  // 给导出设置一个最小高度（基于视口高度），不足就补白撑高。
  const viewportH =
    (typeof window !== "undefined" && window.innerHeight) ||
    (typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.clientHeight) ||
      0;
  const minHeightPx = viewportH ? viewportH * 0.75 : 0;
  if (minHeightPx && finalHeightPx < minHeightPx) {
    finalHeightPx = minHeightPx;
  }

  // 防止在 scroll-view 中被裁切：尽量生成离屏 clone 再截
  // 注意：在 uni-app 某些平台上 ref 可能不是标准 DOM 节点，所以对 cloneNode 做守卫。
  let target = el;
  let clone = null;
  const hasEcharts =
    typeof el.querySelector === "function" && !!el.querySelector(".chart-block__canvas");

  const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
  const computedWidth =
    typeof window !== "undefined" && window.getComputedStyle
      ? Number.parseFloat(window.getComputedStyle(el).width)
      : Number.NaN;
  const widthPx =
    rect?.width ||
    el.offsetWidth ||
    el.clientWidth ||
    (Number.isFinite(computedWidth) ? computedWidth : 0) ||
    0;

  // 内容很多时宽度可能被“压缩”；最小宽度设为屏幕宽度的 60%，用增加高度承载长内容
  const viewportW =
    (typeof window !== "undefined" && window.innerWidth) ||
    (typeof document !== "undefined" &&
      document.documentElement &&
      document.documentElement.clientWidth) ||
      0;
  const minWidthPx = viewportW ? viewportW * 0.6 : 0;
  // JS 侧按 px 计算：把 580rpx 转成 px
  const rpxToPx = viewportW ? viewportW / 750 : 1;
  const fallbackWidthPx = 580 * rpxToPx;
  const finalWidthPx = Math.max(widthPx || fallbackWidthPx, minWidthPx || 0);

  if (hasEcharts) {
    // ECharts 依赖 Vue mounted 初始化，cloneNode 不会触发初始化。
    // 所以存在图表时，直接截图原节点，确保 canvas 已渲染。
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    el.style.zIndex = "-1";
    el.style.margin = "0";
    el.style.width = `${finalWidthPx}px`;
    el.style.minWidth = `${finalWidthPx}px`;
    if (finalHeightPx) el.style.height = `${finalHeightPx}px`;
    el.style.minHeight = `${finalHeightPx || 0}px`;
    el.style.background = "#ffffff";
    el.style.setProperty("visibility", "visible", "important");
    el.style.setProperty("opacity", "1", "important");
    el.style.setProperty("display", "block", "important");
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    target = el;
  } else if (typeof el.cloneNode === "function") {
    // 非图表：cloneNode 规避 scroll-view 裁切
    clone = el.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.top = "0";
    clone.style.left = "0";
    clone.style.zIndex = "-1";
    clone.style.margin = "0";
    clone.style.width = `${finalWidthPx}px`;
    clone.style.minWidth = `${finalWidthPx}px`;
    if (finalHeightPx) clone.style.height = `${finalHeightPx}px`;
    clone.style.minHeight = `${finalHeightPx || 0}px`;
    clone.style.background = "#ffffff";
    clone.style.setProperty("visibility", "visible", "important");
    clone.style.setProperty("opacity", "1", "important");
    clone.style.setProperty("display", "block", "important");
    clone.style.overflow = "visible";
    clone.style.maxHeight = "none";
    document.body.appendChild(clone);
    target = clone;
  }

  const canvas = await html2canvas(target, {
    backgroundColor: "#ffffff",
    useCORS: true,
    allowTaint: true,
    scale: 2,
  });

  if (clone && clone.parentNode) document.body.removeChild(clone);
  console.log(canvas.height, canvas.width, canvas);
  state.sharePosterDataUrl = canvas.toDataURL("image/png");
}

async function onSaveSharePoster() {
  if (!state.sharePosterDataUrl) return;
  if (typeof document === "undefined") {
    uni.showToast({
      title: t("save-not-supported"),
      icon: "none",
    });
    return;
  }

  // H5：触发下载（多数 WebView 容器可用）
  const link = document.createElement("a");
  link.href = state.sharePosterDataUrl;
  link.download = "share-conversation.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  uni.showToast({ title: t("download-start"), icon: "none" });
}

async function onCopySharePoster() {
  if (!state.sharePosterDataUrl) return;

  const canCopyImage =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined";

  if (!canCopyImage) {
    uni.showToast({
      title: t("copy-failed-browser-not-supported"),
      icon: "none",
    });
    return;
  }

  try {
    const response = await fetch(state.sharePosterDataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    uni.showToast({ title: t("copy-success"), icon: "none" });
  } catch (error) {
    console.error("[AiChatPage] clipboard image copy error", error);
    uni.showToast({ title: t("copy-failed"), icon: "none" });
  }
}

function startNewConversation() {
  // 新开会话：清空对话 + 重置会话 id，让后续发送触发创建新 session
  state.messages = [];
  state.inputText = "";
  state.showQuickPrompts = true;
  state.showQuickList = true;
  state.isLoading = false;
  state.aiSessionId = null;
  nextTick(() => _scrollToBottom());
}
function _resetToQuickPrompts() {
  state.aiSessionId = null;
  state.messages = [];
  state.showQuickPrompts = true;
  state.showQuickList = true;
}
function _mapHistoryMessages(list) {
  const rows = Array.isArray(list) ? list : [];
  const mapped = [];
  rows.forEach((item) => {
    const sessionId = state.aiSessionId || item?.conversationId || item?.sessionId || null;
    const messageId = item?.id ?? item?.messageId ?? null;
    const userText = String(item?.userMessage || "").trim();
    const aiText = String(item?.outputMessage || "").trim();
    if (userText) {
      mapped.push({
        role: "user",
        content: userText,
        sessionId,
        messageId,
      });
    }
    if (aiText) {
      const positive =
        item?.positiveFeedback === true ? true : item?.positiveFeedback === false ? false : null;
      mapped.push({
        role: "ai",
        content: "",
        blocks: parseHistoryBlocks(aiText),
        rawSseText: aiText,
        ttsUrl: item?.ttsUrl || "",
        ttsEnabled: !!item?.ttsUrl,
        loading: false,
        sessionId,
        messageId,
        positive,
        feedbackValue:
          item?.positiveFeedback === true ? "good" : item?.positiveFeedback === false ? "bad" : "",
        feedbackRemark: item?.feedbackRemark || "",
      });
    }
  });
  return mapped;
}

async function loadSessionHistory(sessionId) {
  if (!sessionId) return;
  const userId = userStore.userId;
  const res = await GCPAPI.fetchAISessionHistory(sessionId)({
    userId,
    limit: 15,
  });
  const payload = res?.data ? res.data : res;
  const rows = _mapHistoryMessages(payload?.messages || []);
  state.messages = rows;
  state.showQuickPrompts = false;
  state.showQuickList = false;
  nextTick(() => _scrollToBottom());
}

async function getAISessionList(pageNo = 1, pageSize = 20) {
  const user = String(userStore.userId || "");
  if (!user) return { data: [], hasMore: false };

  if (pageNo === 1) {
    state._sessionLastId = null;
    state._sessionHasMore = true;
  }

  try {
    const res = await getConversations({
      user,
      lastId: pageNo > 1 ? state._sessionLastId || undefined : undefined,
      limit: pageSize,
      sortBy: "updated_at_desc",
    });
    const page = res.data;
    const sessions = Array.isArray(page?.data) ? page.data : [];

    state._sessionLastId = sessions.at(-1)?.id || null;
    state._sessionHasMore = Boolean(page?.hasMore);
    state.sessions = pageNo === 1
      ? sessions
      : [...state.sessions, ...sessions.filter(session => !state.sessions.some(item => item.id === session.id))];

    return { data: sessions, hasMore: state._sessionHasMore };
  } catch (e) {
    console.error("[AiChatPage] getAISessionList failed", e);
    throw e;
  }
}

function goToChat() {
  try {
    uni.setStorageSync(AI_ASK_WELCOME_DONE_KEY, true);
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // 写入失败不影响进入聊天
  }
  state.stage = "chat";
}

/** 已要求欢迎页仅首次展示，返回不再回到欢迎页，优先退出当前页 */
function backToWelcome() {
  if (userStore.isVisitor) {
    userStore.setVisitorRole(null);
    userStore.setUserId("");
  }
  const bridge = globalThis.AlipayJSBridge;
  if (bridge?.call) {
    bridge.call("popWindow");
    return;
  }

  const pages = getCurrentPages();
  if (pages.length > 1) {
    uni.navigateBack({ delta: 1 });
  }
}

async function onSessionClick(session) {
  const id = session?.sessionId || session?.id;
  if (!id) return;
  if (state.aiSessionId === id) return;
  state.showQuickPrompts = false;
  state.showQuickList = false;
  state.messages = [];
  state.isSessionSwitching = true;
  state.aiSessionId = id;
  try {
    await loadSessionHistory(id);
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    uni.showToast({
      title: t("load-history-failed"),
      icon: "none",
    });
  } finally {
    state.isSessionSwitching = false;
  }
}

async function onSessionDelete(session) {
  const id = session?.id;
  if (!id) return;
  const userId = userStore.userId;
  const modalRes = await new Promise((resolve) => {
    uni.showModal({
      title: "删除此对话？",
      content: "删除后，这条对话记录将无法找回。确定删除此对话？",
      confirmColor: "#F8315E",
      success: res => resolve(res),
      fail: () => resolve({ confirm: false }),
    });
  });
  if (!modalRes?.confirm) return;
  try {
    await deleteConversation(id, { user: String(userId || "") });
    await getAISessionList();
    if (String(state.aiSessionId) === String(id)) {
      // 删除命中当前选中会话：回到默认状态（logo + 快捷问题）
      _resetToQuickPrompts();
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    uni.showToast({
      title: t("delete-failed"),
      icon: "none",
    });
  }
}

async function onSessionDeleteBatch(ids) {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map(x => String(x)));
  if (!idSet.size) return;
  const modalRes = await new Promise((resolve) => {
    uni.showModal({
      title: "批量删除选中对话？",
      content: `删除后，选中对话记录将无法找回。确定删除选中对话？`,
      confirmColor: "#F8315E",
      success: res => resolve(res),
      fail: () => resolve({ confirm: false }),
    });
  });
  if (!modalRes?.confirm) return;
  const userId = userStore.userId;
  try {
    await GCPAPI.batchDeleteAISession({
      userId,
      sessionIds: Array.from(idSet),
    });
    await getAISessionList();
    if (state.aiSessionId && idSet.has(String(state.aiSessionId))) {
      // 批量删除命中当前选中会话：回到默认状态（logo + 快捷问题）
      _resetToQuickPrompts();
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    uni.showToast({
      title: t("batch-delete-failed"),
      icon: "none",
    });
  }
}

async function onSessionRename(session) {
  const id = session?.id;
  const name = (session?.name || "").trim();
  if (!id || !name) return;
  const userId = userStore.userId;
  try {
    await GCPAPI.updateAISession(id)({
      userId,
      title: name.slice(0, 200),
    });
    state.sessions = state.sessions.map(x =>
      (x.sessionId || x.id) === id
        ? {
            ...x,
            name,
          }
        : x,
    );
    getAISessionList();
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    uni.showToast({
      title: t("rename-failed"),
      icon: "none",
    });
  }
}

async function onFeedbackChange(payload) {
  const index = Number(payload?.index);
  const msg = payload?.msg || {};
  const value = payload?.value || "";
  const targetMsg = Number.isInteger(index) ? state.messages[index] : null;
  const conversationId = msg?.conversationId || msg?.sessionId || targetMsg?.conversationId || targetMsg?.sessionId || state.aiSessionId;
  const messageId = msg?.messageId ?? targetMsg?.messageId ?? msg?.id ?? targetMsg?.id;
  const user = userStore.userId || undefined;

  if (!targetMsg || !conversationId || !messageId) {
    uni.showToast({
      title: t("feedback-unavailable"),
      icon: "none",
    });
    return;
  }

  if (value === "") {
    const prev = targetMsg || {};
    // 乐观清除：立即取消高亮
    _replaceMessage(index, {
      ...prev,
      positive: null,
      feedbackValue: "",
      feedbackRemark: "",
    });
    try {
      await cancelFeedback(messageId, {
        conversationId,
        user,
        messageId,
      });
    } catch (e) {
      console.error("[AiChatPage] caught error", e);
      // 失败则回滚
      _replaceMessage(index, {
        ...prev,
      });
      uni.showToast({
        title: t("feedback-failed"),
        icon: "none",
      });
    }
    return;
  }

  if (value === "good") {
    const prev = targetMsg || {};
    // 乐观高亮：立即点亮点赞
    _replaceMessage(index, {
      ...prev,
      positive: true,
      feedbackValue: "good",
      feedbackRemark: prev.feedbackRemark || "",
    });
    try {
      await submitFeedback(messageId, {
        conversationId,
        user,
        messageId,
        rating: "like",
      });
    } catch (e) {
      console.error("[AiChatPage] caught error", e);
      // 失败则回滚
      _replaceMessage(index, {
        ...prev,
      });
      uni.showToast({
        title: t("feedback-failed"),
        icon: "none",
      });
    }
    return;
  }

  if (value === "bad") {
    state._badFeedbackCtx = { index, conversationId, messageId, user };
    state.badFeedbackSheetVisible = true;
  }
}

// ---- 消息发送 ----
async function onBadFeedbackConfirm(payload) {
  const ctx = state._badFeedbackCtx;
  if (!ctx) return;

  const safeRemark = String(payload?.remark || "").trim();
  if (!safeRemark) {
    uni.showToast({
      title: t("please-enter-feedback-reason"),
      icon: "none",
    });
    return;
  }

  // 乐观高亮：提交后立刻点亮点踩状态
  const prev = state.messages[ctx.index] || {};
  _replaceMessage(ctx.index, {
    ...prev,
    positive: false,
    feedbackValue: "bad",
    feedbackRemark: safeRemark,
  });

  try {
    await submitFeedback(ctx.messageId, {
      conversationId: ctx.conversationId,
      user: ctx.user,
      messageId: ctx.messageId,
      rating: "dislike",
      content: safeRemark,
    });
    uni.showToast({
      title: "感谢反馈",
      icon: "none",
      duration: 1500,
    });
    setTimeout(() => {
      state._badFeedbackCtx = null;
      state.badFeedbackSheetVisible = false;
    }, 1500);
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // 失败回滚
    _replaceMessage(ctx.index, {
      ...prev,
      positive: prev.positive ?? null,
      feedbackValue: prev.feedbackValue ?? "",
      feedbackRemark: prev.feedbackRemark ?? "",
    });
    uni.showToast({
      title: t("feedback-failed"),
      icon: "none",
    });
  }
}

function onBadFeedbackClose() {
  state.badFeedbackSheetVisible = false;
  state._badFeedbackCtx = null;
}
function sendQuickPrompt(text) {
  state.inputText = text;
  sendMessage();
}

function toggleQuickList(show) {
  if (state.messages.length > 0 && show) {
    // 已有消息 并且切换到文字输入时
    return;
  }
  state.showQuickList = show;
}

function _nextRequestSeq() {
  state._requestSeq += 1;
  state._activeRequestSeq = state._requestSeq;
  return state._activeRequestSeq;
}

function _finishStreamMessage(messageIndex, requestSeq) {
  if (requestSeq !== state._activeRequestSeq) return;
  const current = state.messages[messageIndex];
  if (!current) return;
  _replaceMessage(messageIndex, { ...current, loading: false });
  state.isLoading = false;
  state._activeAiMsgIndex = -1;
  _scrollToBottom();
}

async function _sendAiFlow({ aiMsgIndex, content, hadSessionId, requestSeq, userMsgIndex }) {
  let receivedContent = false;

  try {
    for await (const chunk of stream({
      query: content,
      user: String(userStore.userId || ""),
      conversationId: state.aiSessionId,
    }, { timeout: 60_000 })) {
      if (requestSeq !== state._activeRequestSeq) break;
      if (chunk.error) throw chunk.error;
      if (!chunk.result) continue;

      const aiMessage = state.messages[aiMsgIndex];
      if (!aiMessage) break;
      const update = applyEventToBlocks(aiMessage.blocks || [], chunk.result);
      receivedContent ||= update.receivedContent;
      console.log("🚀 ~ _sendAiFlow ~ receivedContent:", receivedContent);

      if (update.conversationId) state.aiSessionId = update.conversationId;
      const nextMessage = {
        ...aiMessage,
        blocks: update.blocks,
        sessionId: update.conversationId ?? aiMessage.sessionId,
        messageId: update.messageId ?? aiMessage.messageId,
        durationMs: update.metadata?.duration_ms ?? aiMessage.durationMs,
        loading: chunk.result.event !== "message_end",
        interrupted: update.metadata?.status === "stopped",
      };
      _replaceMessage(aiMsgIndex, nextMessage);

      const userMessage = state.messages[userMsgIndex];
      if (userMessage && update.conversationId && update.messageId) {
        _replaceMessage(userMsgIndex, {
          ...userMessage,
          sessionId: update.conversationId,
          messageId: update.messageId,
        });
      }

      _scrollToBottom();
      if (chunk.result.event === "message_end") break;
    }
  } catch (error) {
    const aiMessage = state.messages[aiMsgIndex];
    if (aiMessage && requestSeq === state._activeRequestSeq && !_isAbortError(error)) {
      _replaceMessage(aiMsgIndex, {
        ...aiMessage,
        blocks: receivedContent ? aiMessage.blocks : buildInitialBlocks(),
        content: receivedContent ? aiMessage.content : t("ai-unavailable-retry-later"),
        loading: false,
      });
      console.error("[AiChatPage] stream consumption failed", error);
    }
  } finally {
    if (requestSeq === state._activeRequestSeq) {
      _finishStreamMessage(aiMsgIndex, requestSeq);
      if (!hadSessionId && state.aiSessionId) {
        getAISessionList().catch(error => console.error("[AiChatPage] failed to refresh AI sessions", error));
      }
    }
  }
}

async function sendMessage() {
  const text = state.inputText.trim();
  if (!text) return;

  _cancelActiveStream();
  const requestSeq = _nextRequestSeq();
  const hadSessionId = Boolean(state.aiSessionId);
  const uuid = crypto.randomUUID();
  const conversationId = state.aiSessionId;

  state.inputText = "";
  state.showQuickPrompts = false;
  state.isLoading = true;
  const userMsgIndex = state.messages.length;
  state.messages.push({
    id: `user-${uuid}`,
    role: "user",
    content: text,
    sessionId: conversationId,
    messageId: null,
  });
  const aiMsgIndex = state.messages.length;
  state.messages.push({
    id: `ai-${uuid}`,
    role: "ai",
    content: "",
    blocks: buildInitialBlocks(),
    loading: true,
    interrupted: false,
    sessionId: conversationId,
    messageId: null,
    waitingText: text,
  });
  state._activeAiMsgIndex = aiMsgIndex;
  _scrollToBottom();

  await _sendAiFlow({ aiMsgIndex, content: text, hadSessionId, requestSeq, userMsgIndex });
}
// ---- TTS ----
async function onTtsClick(messageIndex) {
  const aiMsg = state.messages[messageIndex];
  if (!aiMsg) return;
  if (!aiMsg.ttsEnabled) return;
  if (aiMsg.ttsLoading) return;

  _replaceMessage(messageIndex, {
    ...aiMsg,
    ttsLoading: true,
  });
  console.log("aiMsg.ttsUrl", aiMsg);
  try {
    // 优先：若消息里已经存了 ttsUrl，直接按该 url 拉取
    const resp = await GCPAPI.fetchAITTS(aiMsg.ttsUrl)({});
    await _playBase64Audio(resp.audioBase64);
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    uni.showToast({
      title: t("tts-play-failed"),
      icon: "none",
    });
    console.error("tts failed", e);
  } finally {
    const latest = state.messages[messageIndex] || {};
    _replaceMessage(messageIndex, {
      ...latest,
      ttsLoading: false,
    });
  }
}

async function _playBase64Audio(base64) {
  const cleaned = String(base64 || "").replace(/^data:.*;base64,/i, "");
  if (!cleaned) return;

  // 停止上一次播放
  try {
    if (state._audioCtx) {
      state._audioCtx.stop();
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // ignore
  }

  const mime = _guessAudioMime(cleaned);
  const audio = uni.createInnerAudioContext();
  state._audioCtx = audio;

  // 优先：写入临时文件（小程序环境更稳定）
  const fs = typeof uni.getFileSystemManager === "function" ? uni.getFileSystemManager() : null;

  const baseDir =
    (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) ||
    (typeof my !== "undefined" && my.env && my.env.USER_DATA_PATH) ||
    (uni && uni.env && uni.env.USER_DATA_PATH ? uni.env.USER_DATA_PATH : "");

  if (fs && fs.writeFile && baseDir) {
    const ext = mime === "audio/wav" ? "wav" : "mp3";
    const filePath = `${baseDir}/tts_${Date.now()}.${ext}`;
    await new Promise((resolve, reject) => {
      fs.writeFile({
        filePath,
        data: cleaned,
        encoding: "base64",
        success: resolve,
        fail: reject,
      });
    });
    audio.src = filePath;
  } else {
    // H5 / fallback：data URI
    audio.src = `data:${mime};base64,${cleaned}`;
  }

  audio.autoplay = true;
  // 监听错误（避免静默失败）
  audio.onError = () => {
    uni.showToast({
      title: t("audio-play-failed"),
      icon: "none",
    });
  };
}

function _guessAudioMime(base64) {
  // 简单嗅探：RIFF(base64 以 UklGR 开头) 通常是 WAV
  if (base64.startsWith("UklGR")) return "audio/wav";
  // MP3 常见以 SUQz / /5Q 开头（不保证），默认按 mpeg
  return "audio/mpeg";
}

function onScrollTop() {
  // 预留：加载更多历史消息
}

function _scrollToBottom() {
  if (state._scrollPending) return;
  state._scrollPending = true;

  nextTick(() => {
    state._bottomAnchorToggle = !state._bottomAnchorToggle;
    state.scrollIntoView = state._bottomAnchorToggle
      ? "msg-bottom-anchor-a"
      : "msg-bottom-anchor-b";
    state._scrollPending = false;
  });
}

function syncPageStage() {
  if (userStore.visitorRole) {
    state.stage = "chat";
    return;
  }

  try {
    const done = uni.getStorageSync(AI_ASK_WELCOME_DONE_KEY);
    if (!userStore.isVisitor && !!done) {
      state.stage = "chat";
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
  }
}

onMounted(syncPageStage);
onShow(syncPageStage);

onBeforeUnmount(() => {
  _cancelActiveStream();
  clearTimeout(state._finalScrollTimer);
  clearTimeout(state._scrollToBottomOnKeyboardHideTimer);
});
</script>

<template>
  <view class="ai-page">
    <!-- 欢迎页 -->
    <AiWelcome v-if="stage === 'welcome'" @start-chat="goToChat" />

    <!-- 问答页 -->
    <view v-else class="ai-page__chat">
      <!-- Background -->
      <div class="ai-chat-bg" />
      <!-- Decorative Glows -->
      <div class="ai-chat-bg__glow ai-chat-bg__glow-blue" />
      <div class="ai-chat-bg__glow ai-chat-bg__glow-red" />

      <!-- Header -->
      <AiChatHeader
        v-model:sessions="sessions"
        :load-sessions="getAISessionList"
        :selected-session-id="aiSessionId"
        :generating="isLoading"
        :share-mode="shareSheetVisible"
        :share-select-all-disabled="shareSelectAllDisabled"
        :share-all-checked="shareAllChecked"
        :share-selected-round-count="shareSelectedRoundCount"
        @back="backToWelcome"
        @new-conversation="startNewConversation"
        @session-click="onSessionClick"
        @session-delete="onSessionDelete"
        @session-delete-batch="onSessionDeleteBatch"
        @session-rename="onSessionRename"
        @share-select-all="onShareSelectAll"
      />
      <AiMessageList
        :key="aiSessionId || 'new-conversation'"
        :messages="messages"
        :quick-prompts="localizedQuickPrompts"
        :show-quick-prompts="showQuickPrompts"
        :scroll-top="scrollTop"
        :scroll-into-view="scrollIntoView"
        :show-quick-list="showQuickList"
        :selected-indexes="shareSelectedIndexes"
        :select-mode="shareSheetVisible"
        :suppress-highlight="shareSuppressHighlight"
        :keyboard-height-px="keyboardHeightPx"
        @quick-prompt="sendQuickPrompt"
        @suggestion-tap="sendQuickPrompt"
        @tts-click="onTtsClick"
        @feedback-change="onFeedbackChange"
        @share-click="onShareClick"
        @copy-click="onCopyMessage"
        @select-toggle="onShareSelectToggle"
        @scroll-top="onScrollTop"
      />
      <!-- 底部快捷导航与输入栏属于同一区域；键盘弹出时隐藏导航，仅保留输入栏/语音浮窗。 -->
      <AiChatNav :visible="showQuickPrompts && keyboardHeightPx <= 0" />

      <view v-if="isSessionSwitching" class="session-loading">
        <view class="session-loading__spinner" />
      </view>

      <view v-if="shareSheetVisible" class="share-sheet-modal">
        <view class="share-sheet-modal__mask" @tap="closeShareSheet" />
        <view class="share-sheet" :style="safeAreaStyle" @tap.stop>
          <text class="share-sheet__title">
            分享到：
          </text>
          <view class="share-sheet__options">
            <view
              v-for="item in shareSheetOptions"
              :key="item.key"
              class="share-sheet__option"
              :class="{
                'share-sheet__option--disabled':
                  item.key === 'share-image' && shareSelectedIndexes.length === 0,
              }"
              @tap="
                item.key === 'share-image' && shareSelectedIndexes.length === 0
                  ? null
                  : onShareSheetOption(item)
              "
            >
              <view class="share-sheet__option-icon">
                <image :src="item.icon" mode="aspectFit" class="share-sheet__option-icon-img" />
              </view>
              <text class="share-sheet__option-label">
                {{ item.label }}
              </text>
            </view>
          </view>
          <view class="share-sheet__divider" />
          <view class="share-sheet__cancel-btn" @tap="closeShareSheet">
            <text class="share-sheet__cancel-text">
              {{ $t("cancel") }}
            </text>
          </view>
        </view>
      </view>

      <!-- 分享图片预览/生成（Figma: 495:809） -->
      <view v-else-if="sharePosterVisible" class="share-poster-modal">
        <view class="share-poster-modal__mask" @tap="closeSharePosterModal" />
        <view class="share-poster-modal__card" @tap.stop>
          <view class="share-poster-modal__content">
            <view v-if="sharePosterGenerating" class="share-poster-modal__loading">
              <view class="share-poster-modal__loading-content">
                <view class="session-loading__spinner share-poster-modal__loading-spinner" />
                <text class="share-poster-modal__loading-text">
                  图片生成中
                </text>
              </view>
            </view>
            <scroll-view
              v-else-if="sharePosterDataUrl"
              class="share-poster-modal__scroll-img"
              scroll-y
              :scroll-with-animation="true"
            >
              <view class="share-poster-modal__img-center">
                <image class="share-poster-modal__img" :src="sharePosterDataUrl" mode="widthFix" />
              </view>
            </scroll-view>
          </view>

          <view class="share-poster-modal__bottom" :style="safeAreaStyle">
            <view class="share-poster-modal__bottom-action-wrap">
              <view class="share-poster-modal__option" @tap="onSaveSharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconSaveImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  保存图片
                </text>
              </view>
              <view class="share-poster-modal__option" @tap="onCopySharePoster">
                <view class="share-poster-modal__option-icon">
                  <image class="share-poster-modal__option-icon-img" :src="iconCopyImage" mode="aspectFit" />
                </view>
                <text class="share-poster-modal__option-label">
                  复制图片
                </text>
              </view>
            </view>
            <view class="share-poster-modal__divider" />
            <view class="share-poster-modal__cancel" @tap="closeSharePosterModal">
              <text class="share-poster-modal__cancel-text">
                取消
              </text>
            </view>
          </view>
        </view>

        <!-- 离屏海报节点：用于 html2canvas 生成图片（不在界面展示） -->
        <view id="share-poster-wrap" ref="sharePosterWrap" class="share-poster-hidden">
          <ShareConversationPoster :messages="messages" :selected-indexes="shareSelectedIndexes" />
        </view>
      </view>

      <AiChatInput
        v-else
        v-model="inputText"
        :is-loading="isLoading"
        @send="sendMessage"
        @stop="stopGenerating"
        @toggle-quick-list="toggleQuickList"
        @keyboard-height-change="onKeyboardHeightChange"
      />

      <AiBadFeedbackSheet
        :visible="badFeedbackSheetVisible"
        @close="onBadFeedbackClose"
        @confirm="onBadFeedbackConfirm"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* Design tokens from Ardot */
$color-text-primary: #1a1a1a;       // r:0.102
$color-text-secondary: #6b6b6b;     // r:0.420
$color-text-muted: #bababa;         // r:0.729
$color-red-accent: #ff0000;
$color-red-btn: #fe0000;             // r:0.996 g:0 b:0
$color-bg-phone: #fafafa;           // r:0.98
$color-bg-voice: #f5f5f5;           // r:0.96
$color-border-light: #efefef;       // r:0.937
$color-white: #ffffff;

/* Background */
.phone-bg {
  position: absolute;
  inset: 0;
  background-color: $color-bg-phone;
  z-index: 0;
}

/* Decorative glows — top corners */
.glow {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}

.glow-blue {
  left: -40px;
  top: -20px;
  width: 280px;
  height: 180px;
  background: radial-gradient(
    ellipse 80% 60% at 40% 40%,
    rgba(123, 167, 217, 0.10) 0%,
    rgba(123, 167, 217, 0.04) 50%,
    rgba(123, 167, 217, 0) 70%
  );
  filter: blur(8px);
}

.glow-red {
  left: 44px;
  top: -20px;
  width: 380px;
  height: 180px;
  background: radial-gradient(
    ellipse 70% 55% at 60% 35%,
    rgba(255, 80, 80, 0.08) 0%,
    rgba(255, 80, 80, 0.03) 50%,
    rgba(255, 80, 80, 0) 70%
  );
  filter: blur(10px);
}

.ai-page {
  min-height: 100vh;
  height: 100%;
  box-sizing: border-box;
  background: #f2f4f8;
  font-family: PingFang SC;
  overflow: hidden;
  overscroll-behavior: none;
}

.ai-page__chat {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #ffffff;
  overflow: hidden;
  position: relative;
}

.ai-chat-bg {
  position: absolute;
  inset: 0;
  background-color: $color-bg-phone;
  z-index: 0;
}

.ai-chat-bg__glow {
  position: absolute;
  z-index: 1;
  pointer-events: none;
}
.ai-chat-bg__glow-blue {
  left: -80rpx;
  top: -40rpx;
  width: 560rpx;
  height: 360rpx;
  background: radial-gradient(
    ellipse 80% 60% at 40% 40%,
    rgba(123, 167, 217, 0.10) 0%,
    rgba(123, 167, 217, 0.04) 50%,
    rgba(123, 167, 217, 0) 70%
  );
  filter: blur(16rpx);
}
.ai-chat-bg__glow-red {
  left: 88rpx;
  top: -40rpx;
  width: 760rpx;
  height: 360rpx;
  background: radial-gradient(
    ellipse 70% 55% at 60% 35%,
    rgba(255, 80, 80, 0.08) 0%,
    rgba(255, 80, 80, 0.03) 50%,
    rgba(255, 80, 80, 0) 70%
  );
  filter: blur(20rpx);
}
.session-loading {
  position: absolute;
  left: 0;
  right: 0;
  top: 180rpx;
  bottom: 200rpx;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.session-loading__spinner {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(95, 103, 117, 0.2);
  border-top-color: #f8315e;
  animation: session-spin 0.9s linear infinite;
}

@keyframes session-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Share sheet (495:759) */
.share-sheet-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
}

.share-sheet-modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.share-sheet {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  box-sizing: border-box;
  border-radius: 32rpx 32rpx 0 0;
  background: #ffffff;
  padding: 40rpx 60rpx calc(32rpx + var(--safe-bottom, env(safe-area-inset-bottom)));
}

.share-sheet__title {
  display: block;
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
}

.share-sheet__options {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-top: 40rpx;
}

.share-sheet__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-sheet__option--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.share-sheet__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-sheet__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-sheet__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-sheet__cancel-btn {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

/* Share Poster Modal */
.share-poster-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

.share-poster-modal__card {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
}

.share-poster-modal__content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 30rpx 42rpx 0;
  box-sizing: border-box;
  overflow: hidden;
}

.share-poster-modal__img-wrap {
  width: 100%;
  height: 100%;
}

.share-poster-modal__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.share-poster-modal__loading-content {
  width: 200rpx;
  height: 200rpx;
  border-radius: 30rpx;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.share-poster-modal__loading-spinner {
  border-top-color: #c8201e;
}

.share-poster-modal__loading-text {
  font-size: 24rpx;
  line-height: 32rpx;
  color: #5f6775;
}

.share-poster-modal__bottom {
  padding: 40rpx 60rpx 32rpx;
  padding-bottom: calc(32rpx + var(--safe-bottom, constant(safe-area-inset-bottom)));
  padding-bottom: calc(32rpx + var(--safe-bottom, env(safe-area-inset-bottom)));
  background: #fff;
  box-shadow: 0 -4rpx 42rpx rgba(0, 0, 0, 0.0601);
  display: flex;
  flex-direction: column;
  border-radius: 32rpx 32rpx 0 0;
}

.share-poster-modal__bottom-action-wrap {
  display: flex;
  align-items: flex-start;
  gap: 61.333rpx;
}

.share-poster-modal__option {
  width: 112rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18rpx;
}

.share-poster-modal__option-icon {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: #f2f2f2;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__option-icon-img {
  width: 56rpx;
  height: 56rpx;
}

.share-poster-modal__option-label {
  height: 40rpx;
  font-family: "PingFang SC";
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
  color: #1a1a1a;
  text-align: center;
  white-space: nowrap;
}

.share-poster-modal__divider {
  height: 2rpx;
  margin-top: 34rpx;
  background: #e4e4e4;
}

.share-poster-modal__cancel {
  height: 40rpx;
  margin-top: 28rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__cancel-text {
  font-family: "PingFang SC";
  font-size: 28rpx;
  font-weight: 500;
  line-height: 40rpx;
  color: #999999;
}

.share-poster {
  width: 656rpx;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 24rpx 30rpx 30rpx;
  box-sizing: border-box;
}

.share-poster-modal__img {
  width: 584rpx;
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 24rpx;
}

.share-poster-modal__scroll-img {
  flex: 1;
  width: 100%;
  height: 100%;
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.share-poster-modal__scroll-img ::v-deep ::-webkit-scrollbar {
  display: none;
}

.share-poster-modal__img-center {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-bottom: 32rpx;
}
.share-poster-hidden {
  position: fixed;
  left: 0;
  top: 0;
  pointer-events: none;
  opacity: 0;
  visibility: visible;
}
</style>

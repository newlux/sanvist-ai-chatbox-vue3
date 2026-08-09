<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRefs, watch } from "vue";
import { useI18n } from "vue-i18n";
import iconCopyLink from "@/assets/img/icon-copyLink.svg";
import iconShareImage from "@/assets/img/icon-shareImage.svg";
import { GCPAPI } from "@/common/api/gcp";
import AiBadFeedbackSheet from "@/components/ai-bad-feedback-sheet/index.vue";
import AiChatHeader from "@/components/ai-chat-header/index.vue";
import AiChatInput from "@/components/ai-chat-input/index.vue";
import AiChatNav from "@/components/ai-chat-nav/index.vue";
import AiMessageList from "@/components/ai-message-list/index.vue";
import ShareConversationPoster from "@/components/ai-share-poster/index.vue";
import AiWelcome from "@/components/ai-welcome/index.vue";

import { AI_ASK_WELCOME_DONE_KEY } from "@/config";
import { useSystemStore } from "@/stores";
import { parseHistoryBlocks, parseSseBlocks } from "@/utils/ai-stream/sseParser";
import { getConversations } from "@/api/chat";

defineOptions({ name: "AiChatPage" });

const { t } = useI18n();
const systemStore = useSystemStore();
const sharePosterWrap = ref(null);

const state = reactive({
  // 页面阶段: 'welcome' | 'chat'
  stage: "welcome",
  sessions: [],
  // 快捷提示词（后续由接口提供；这里用本地默认值兜底）
  quickPrompts: [
    "今天有多少台设备在线？在线率是多少？",
    "BC5230CG1750 设备现在怎么样？帮我看一下BC5230CG1750设备的实时工况。",
    "BC5230CG1750设备现在在哪里？给我看一下BC5230CG1750设备的经纬度。",
    "帮我查下设备BC5230CG1733在7月14日的行驶轨迹？",
    "BC5230CG1750设备还剩多少油/电？需要加油/充电吗？",
    "BC5230CG1750设备当前关键参数怎么样？吊重、转速或温度是多少？",
    "看看BC5230CG1733设备上周/本月的运营情况。",
    "BC5230CG1733设备本月工作多久？工作了几天？日均工时多少？",
    "BC5230CG1733设备上周用了多少油/电？平均能耗怎么样？",
    "BC5230CG1733设备本月跑了多少公里、泵了多少方或吊了多少次？",
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
  /** 避免同一 userId 重复拉会话列表 */
  _sessionListFetchedForUserId: null,
  /** 会话列表游标分页 */
  _sessionHasMore: true,
  _sessionLastId: null,
  _sessionLoading: false,
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
      key: "copy-link",
      label: "复制链接",
      icon: iconCopyLink,
    },
    {
      key: "share-image",
      label: "分享图片",
      icon: iconShareImage,
    },
    // {
    //   key: "whatsapp",
    //   label: "WhatsApp",
    //   icon: "@/assets/img/icon-whatsapp.svg",
    // },
    // {
    //   key: "telegram",
    //   label: "Telegram",
    //   icon: "@/assets/img/icon-telegram.svg",
    // },
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
  () => systemStore.userId,
  (val) => {
    const id = val != null && String(val).trim() !== "" ? String(val).trim() : "";
    if (!id) {
      state._sessionListFetchedForUserId = null;
      return;
    }
    if (state._sessionListFetchedForUserId === id) return;
    state._sessionListFetchedForUserId = id;
    getAISessionList();
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

function _nextRequestSeq() {
  const cur = Number(state._requestSeq);
  const safeCur = Number.isFinite(cur) ? cur : 0;
  const next = safeCur + 1;
  state._requestSeq = next;
  state._activeRequestSeq = next;
  return next;
}

function _cancelActiveStream() {
  // 取消上一次流式请求（仅对 fetch-stream 环境有效）
  if (state._activeReplyAbortFn) {
    try {
      state._activeReplyAbortFn();
    } catch (e) {
      console.error("[AiChatPage] caught error", e);
      // ignore
    }
    state._activeReplyAbortFn = null;
  }

  try {
    if (state._activeStreamHardTimeout) {
      clearTimeout(state._activeStreamHardTimeout);
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // ignore
  }

  state._activeStreamHardTimeout = null;

  try {
    if (state._activeStreamAbortController) {
      state._activeStreamAbortController.abort();
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // ignore
  }

  state._activeStreamAbortController = null;

  // 无论底层是否支持 abort，都要立即结束上一次 AI 占位 loading
  const idx = Number(state._activeAiMsgIndex);
  if (Number.isInteger(idx) && idx >= 0) {
    const cur = state.messages[idx];
    if (cur && cur.loading) {
      _replaceMessage(idx, {
        ...cur,
        loading: false,
        interrupted: true,
      });
    }
  }
  state._activeAiMsgIndex = -1;
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

  // 1) uni-app：在部分平台可能没有实现 setClipboardData
  // 2) H5：navigator.clipboard（部分 WebView 也可用）
  try {
    if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // fallback
  }

  // try {
  //   if (
  //     typeof uni !== "undefined" &&
  //     typeof uni.setClipboardData === "function"
  //   ) {
  //     await new Promise((resolve, reject) => {
  //       uni.setClipboardData({
  //         data: safeText,
  //         success: () => resolve(true),
  //       });
  //     });
  //     return true;
  //   }
  // } catch (e) {
  //   // fallback
  // }

  return false;
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

  if (key === "share-image" || key === "whatsapp" || key === "telegram") {
    if (state.shareSelectedIndexes.length === 0) return;
    openSharePoster();
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
  const html2canvas = require("html2canvas");
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
  if (typeof window !== "undefined" && window.AlipayJSBridge?.call) {
    const granted = await new Promise((resolve) => {
      window.AlipayJSBridge.call("requestPermission", { permissions: "photo" }, result =>
        resolve(String(result?.result) === "1" || result?.status === "granted"),
      );
    });
    if (!granted) {
      uni.showToast({ title: "请允许访问相册", icon: "none", duration: 3000 });
      return;
    }
  }
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
function _toAiBlocks(rawText = "") {
  const text = String(rawText || "").trim();
  const blocks = parseSseBlocks(text);
  if (blocks.length) return blocks;
  if (!text) return [];
  return [
    {
      id: "answer-0",
      type: "answer",
      payload: { content: text },
      complete: true,
    },
  ];
}
function _mergeStreamBlocks(previous, next) {
  const previousById = new Map(
    (Array.isArray(previous) ? previous : []).map(block => [block.id, block]),
  );
  return (Array.isArray(next) ? next : []).map((block) => {
    const oldBlock = previousById.get(block.id);
    if (block.type === "chart" && oldBlock) {
      return { ...oldBlock, complete: block.complete };
    }
    return block;
  });
}
function _applyStreamText(messageIndex, rawSseText, requestSeq) {
  if (requestSeq !== state._activeRequestSeq) return [];
  const current = state.messages[messageIndex];
  if (!current) return [];
  const blocks = _mergeStreamBlocks(current.blocks, parseSseBlocks(rawSseText));
  _replaceMessage(messageIndex, {
    ...current,
    rawSseText,
    blocks,
    loading: true,
  });
  return blocks;
}
function _mapHistoryMessages(list) {
  const rows = Array.isArray(list) ? list : [];
  const mapped = [];
  rows.forEach((item) => {
    const sessionId = state.aiSessionId || item?.sessionId || null;
    const messageId = item?.messageId ?? null;
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
        ttsLoading: false,
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
  const userId = systemStore.userId || "user_001";
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
async function getAISessionList() {
  try {
    const res = await GCPAPI.fetchAISessionList({
      userId: systemStore.userId || "user_001",
    });
    state.sessions = res.sessions || [];
    return state.sessions;
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    console.error("getAISessionList failed", e);
    return [];
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
  const bridge = globalThis.AlipayJSBridge;
  if (bridge?.call) {
    bridge.call("popWindow");
    return;
  }

  const pages = getCurrentPages();
  console.log("backToWelcome", pages);
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
  const id = session?.sessionId || session?.id;
  if (!id) return;
  const userId = systemStore.userId || "user_001";
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
    await GCPAPI.deleteAISession(id, userId)();
    await getAISessionList();
    if (String(state.aiSessionId) === String(id)) {
      // 删除命中当前选中会话：回到默认状态（logo + 快捷问题）
      _resetToQuickPrompts();
      1;
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
      title: t("delete-title"),
      content: t("batch-delete-confirm-content", {
        count: idSet.size,
      }),
      confirmText: t("delete-confirm-text"),
      confirmColor: "#F8315E",
      success: res => resolve(res),
      fail: () => resolve({ confirm: false }),
    });
  });
  if (!modalRes?.confirm) return;
  const userId = systemStore.userId || "user_001";
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
  const id = session?.sessionId || session?.id;
  const title = (session?.title || "").trim();
  if (!id || !title) return;
  const userId = systemStore.userId || "user_001";
  try {
    await GCPAPI.updateAISession(id)({
      userId,
      title: title.slice(0, 200),
    });
    state.sessions = state.sessions.map(x =>
      (x.sessionId || x.id) === id
        ? {
            ...x,
            title,
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
  const sessionId = msg?.sessionId || targetMsg?.sessionId || state.aiSessionId;
  const messageId = msg?.messageId || targetMsg?.messageId;

  if (!targetMsg || !sessionId || !messageId) {
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
      await GCPAPI.fetchAIFeedbackCancel({
        sessionId: Number(sessionId),
        messageId: Number(messageId),
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
      await GCPAPI.fetchAIChatFeedback({
        sessionId: Number(sessionId),
        messageId: Number(messageId),
        positive: true,
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
    state._badFeedbackCtx = { index, sessionId, messageId };
    state.badFeedbackSheetVisible = true;
  }
}

// ---- 消息发送 ----
function onRefreshClick(payload) {
  const idx = Number(payload?.index);
  if (!Number.isInteger(idx)) return;
  sendMessage({ refreshDerivedData: true, refreshAiIndex: idx });
}

async function onBadFeedbackConfirm(remark) {
  const ctx = state._badFeedbackCtx;
  state._badFeedbackCtx = null;
  state.badFeedbackSheetVisible = false;

  if (!ctx) return;
  const safeRemark = String(remark || "").trim();
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
    await GCPAPI.fetchAIChatFeedback({
      sessionId: Number(ctx.sessionId),
      messageId: Number(ctx.messageId),
      positive: false,
      remark: safeRemark,
    });
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

/**
 * 发送并拉流式回复的统一流程（减少 sendMessage 两大分支重复代码）
 * - 负责：fetchAISend -> 写入 sessionId/messageId -> _streamReplyFromApi
 * - 统一兜底：loading/isLoading/_activeAiMsgIndex/需要时刷新会话列表
 */
async function _sendAiFlow({ aiMsgIndex, content, requestSeq, hadSessionId, refreshDerivedData }) {
  const userId = systemStore.userId || "user_001";

  try {
    const sendRes = await GCPAPI.fetchAISend({
      sessionId: state.aiSessionId,
      userId,
      content,
      ...(refreshDerivedData ? { refreshDerivedData: true } : {}),
    });
    const sessionId = sendRes?.sessionId ?? sendRes?.session_id;
    const messageId = sendRes?.messageId ?? sendRes?.message_id;

    // 避免旧轮次覆盖新的会话 id
    if (requestSeq === state._activeRequestSeq && sessionId) {
      state.aiSessionId = sessionId;
    }
    if (!sessionId || !messageId) {
      throw new Error("fetchAISend response missing sessionId/messageId");
    }

    // 仅在当前 requestSeq 生效时写入占位消息的二次字段
    if (requestSeq === state._activeRequestSeq) {
      const aiMsg = state.messages[aiMsgIndex] || {};
      _replaceMessage(aiMsgIndex, {
        ...aiMsg,
        sessionId,
        messageId,
        feedbackValue: aiMsg.feedbackValue || "",
        ttsSessionId: sessionId,
        ttsIndex: aiMsg.ttsIndex || 1,
      });
    }

    await _streamReplyFromApi(aiMsgIndex, sessionId, messageId, requestSeq);
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    const aiMsg = state.messages[aiMsgIndex];
    if (aiMsg) {
      // 被新发送取消：只收尾 loading，不覆写内容为“失败”
      if (requestSeq !== state._activeRequestSeq || _isAbortError(e)) {
        _replaceMessage(aiMsgIndex, {
          ...aiMsg,
          loading: false,
        });
        return;
      }

      _replaceMessage(aiMsgIndex, {
        ...aiMsg,
        content: t("ai-unavailable-retry-later"),
        blocks: [],
        rawSseText: "",
        loading: false,
      });
    }
  } finally {
    // 强制兜底：接口流程结束后，本轮占位消息不得继续处于 loading
    const tailMsg = state.messages[aiMsgIndex];
    if (tailMsg && tailMsg.loading && requestSeq === state._activeRequestSeq) {
      _replaceMessage(aiMsgIndex, {
        ...tailMsg,
        loading: false,
      });
    }

    // 收尾：仅对当前 requestSeq 生效
    if (requestSeq === state._activeRequestSeq) {
      state.isLoading = false;
      _scrollToBottom();
      state._activeAiMsgIndex = -1;
    }

    // 如果此前没有 sessionId，则本次发送会创建新会话
    // 发送结束后刷新一次会话列表，确保 New Conversation 后能显示新会话
    if (!hadSessionId && requestSeq === state._activeRequestSeq) {
      try {
        await getAISessionList();
      } catch (e2) {
        console.error("[AiChatPage] failed to refresh AI sessions", e2);
        // 忽略刷新失败
      }
    }
  }
}

async function sendMessage(options = {}) {
  const refreshDerivedData = Boolean(options?.refreshDerivedData);
  const refreshAiIndex = Number.isInteger(options?.refreshAiIndex) ? options.refreshAiIndex : -1;

  // ---- 刷新最后一条回答（不重复插入 user 消息）----
  if (refreshDerivedData) {
    const prevAiMsg = state.messages[refreshAiIndex];
    if (!prevAiMsg || prevAiMsg.role !== "ai") return;

    const prevPositive =
      typeof prevAiMsg.positive === "boolean"
        ? prevAiMsg.positive
        : prevAiMsg.feedbackValue === "good"
          ? true
          : prevAiMsg.feedbackValue === "bad"
            ? false
            : null;
    const prevFeedbackValue = prevAiMsg.feedbackValue || "";
    const prevFeedbackRemark = prevAiMsg.feedbackRemark || "";

    // 找到紧邻前的 user 内容（兜底向前找）
    let userIndex = refreshAiIndex - 1;
    while (userIndex >= 0 && state.messages[userIndex]?.role !== "user") {
      userIndex -= 1;
    }

    const text = String(state.messages[userIndex]?.content || "").trim();
    if (!text) return;

    // 取消上一次流式请求（避免多个流并发写入）
    _cancelActiveStream();
    const requestSeq = _nextRequestSeq();
    const hadSessionId = !!state.aiSessionId;

    state.showQuickPrompts = false;
    state.isLoading = true;

    // 删除旧 AI 回答，然后在原位置插入新的 AI loading 占位
    state.messages.splice(refreshAiIndex, 1);
    const aiMsgIndex = refreshAiIndex;
    state.messages.splice(aiMsgIndex, 0, {
      role: "ai",
      content: "",
      blocks: [],
      rawSseText: "",
      loading: true,
      interrupted: false,
      sessionId: state.aiSessionId || null,
      messageId: null,
      positive: prevPositive,
      feedbackValue: prevFeedbackValue,
      feedbackRemark: prevFeedbackRemark,
      ttsEnabled: false,
      ttsLoading: false,
      ttsIndex: 1,
      ttsSessionId: null,
      id: prevAiMsg.id,
    });
    state._activeAiMsgIndex = aiMsgIndex;
    _scrollToBottom();

    await _sendAiFlow({
      aiMsgIndex,
      content: text,
      requestSeq,
      hadSessionId,
      refreshDerivedData: true,
    });

    return;
  }

  const text = state.inputText.trim();
  if (!text) return;

  // 避免同一次操作触发多次发送（例如 textarea confirm + 发送按钮）
  const now = Date.now();
  if (text === state._lastSendText && state._lastSendAt && now - state._lastSendAt < 300) {
    return;
  }
  state._lastSendAt = now;
  state._lastSendText = text;

  // 新发送时：取消上一次流式请求（避免多个流并发写入）
  _cancelActiveStream();
  const requestSeq = _nextRequestSeq();

  const hadSessionId = !!state.aiSessionId;
  state.inputText = "";
  state.showQuickPrompts = false;
  state.isLoading = true;

  // 用户消息入队
  const uuid = crypto.randomUUID();
  state.messages.push({ id: `user-${uuid}`, role: "user", content: text });
  _scrollToBottom();

  // AI loading 占位
  const aiMsgIndex = state.messages.length;
  state.messages.push({
    role: "ai",
    id: `ai-${uuid}`,
    content: "",
    blocks: [],
    rawSseText: "",
    loading: true,
    interrupted: false,
    sessionId: state.aiSessionId || null,
    messageId: null,
    positive: null,
    feedbackValue: "",
    feedbackRemark: "",
    // TTS 元信息：是否可播、ttsIndex（接口 /1）、会话 id
    ttsEnabled: false,
    ttsLoading: false,
    ttsIndex: 1,
    ttsSessionId: null,
  });
  state._activeAiMsgIndex = aiMsgIndex;
  _scrollToBottom();

  await _sendAiFlow({
    aiMsgIndex,
    content: text,
    requestSeq,
    hadSessionId,
    refreshDerivedData: false,
  });
}

function _buildAIReplyStreamUrl(sessionId, messageId) {
  const base = systemStore.baseUrl || "";
  return `${base}/ai-question-api/chat/stream/${sessionId}/${messageId}`;
}

function _mergeStreamHeaders() {
  const baseHeaders = systemStore.header || {};
  return {
    ...baseHeaders,
    Accept: "text/event-stream",
  };
}

/**
 * 将 fetchAIReply 返回体统一为气泡可用的字符串
 */
function _normalizeAIReply(data) {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    if (typeof data.content === "string") return data.content;
    if (typeof data.text === "string") return data.text;
    if (typeof data.message === "string") return data.message;
    if (typeof data.body === "string") return data.body;
  }
  try {
    return JSON.stringify(data);
  } catch (err) {
    console.error("[AiChatPage] failed to serialize AI reply", err);
    return String(data);
  }
}

function _extractStreamContent(rawData) {
  const raw = _normalizeAIReply(rawData);
  if (!raw) return "";

  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cleaned = lines[i].replace(/^data:\s?/, "");
    if (!cleaned) continue;

    // 终止标识：[DONE] 后全部忽略
    if (cleaned.includes("[DONE]")) break;

    const chunkText = _extractReplyChunkText(cleaned);
    if (chunkText) out.push(chunkText);
  }

  return out.join("\n").trim();
}

function _extractReplyChunkText(payload) {
  if (payload && typeof payload === "object") {
    const obj = payload || {};
    const picks = [
      obj?.content,
      obj?.text,
      obj?.message,
      obj?.body,
      obj?.answer,
      obj?.response,
      obj?.output,
      obj?.delta?.content,
      obj?.data?.content,
      obj?.data?.text,
      obj?.data?.message,
      obj?.data?.answer,
      obj?.data?.data?.content,
      obj?.data?.data?.text,
      obj?.data?.data?.message,
      obj?.data?.data?.answer,
      obj?.payload?.content,
      obj?.choices?.[0]?.delta?.content,
      obj?.choices?.[0]?.text,
    ];
    for (let i = 0; i < picks.length; i += 1) {
      if (typeof picks[i] === "string" && picks[i]) return picks[i];
    }
    // 无法确定文本字段：返回空，避免 "[object Object]" 进入渲染
    return "";
  }

  // 不整体 trim：流式分片的首尾空格是内容的一部分（英文词间空格、代码缩进）
  const s = String(payload || "");
  if (!s.trim()) return "";

  // done 事件不参与正文拼接
  const lower = s.toLowerCase();
  if (
    s.includes("[DONE]") ||
    lower === "done" ||
    lower.includes('"type":"done"') ||
    lower.includes('"event":"done"') ||
    lower.includes('"done":true')
  ) {
    return "";
  }

  // 优先尝试 JSON chunk（兼容多种后端流格式）
  try {
    const obj = JSON.parse(s);
    const picks = [
      obj?.content,
      obj?.text,
      obj?.message,
      obj?.body,
      obj?.answer,
      obj?.response,
      obj?.output,
      obj?.delta?.content,
      obj?.data?.content,
      obj?.data?.text,
      obj?.data?.message,
      obj?.data?.answer,
      obj?.payload?.content,
      obj?.choices?.[0]?.delta?.content,
      obj?.choices?.[0]?.text,
    ];
    for (let i = 0; i < picks.length; i += 1) {
      if (typeof picks[i] === "string" && picks[i]) return picks[i];
    }
    return "";
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // 非 JSON：直接按文本片段处理
    return s;
  }
}

function _finishStreamMessage(messageIndex, requestSeq) {
  if (requestSeq !== state._activeRequestSeq) return;
  const current = state.messages[messageIndex];
  if (!current) return;
  _replaceMessage(messageIndex, {
    ...current,
    loading: false,
  });
  // 流式已结束：释放 abort 控制器，避免后续误 abort
  state._activeStreamAbortController = null;
  state._activeStreamHardTimeout = null;

  // 图表渲染属于二次初始化（loading=false 后才会 initCharts），
  // 给一点时间等待高度稳定后再贴底，避免“图表高度变化导致抖动”。
  nextTick(() => {
    if (state._finalScrollTimer) clearTimeout(state._finalScrollTimer);
    state._finalScrollTimer = setTimeout(() => {
      _scrollToBottom();
    }, 280);
  });
}

async function _streamReplyFromApi(messageIndex, sessionId, messageId, requestSeq) {
  const streamUrl = _buildAIReplyStreamUrl(sessionId, messageId);
  const headers = _mergeStreamHeaders();

  // 优先恢复原有流式体验：边接收边渲染
  if (typeof fetch === "function" && typeof TextDecoder !== "undefined") {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    state._activeReplyAbortFn =
      controller && typeof controller.abort === "function" ? () => controller.abort() : null;
    state._activeStreamAbortController = controller;
    const hardTimeout = setTimeout(() => {
      controller && controller.abort();
    }, 90000);
    state._activeStreamHardTimeout = hardTimeout;

    const response = await fetch(streamUrl, {
      method: "GET",
      headers,
      ...(controller ? { signal: controller.signal } : {}),
    });
    clearTimeout(hardTimeout);
    state._activeStreamHardTimeout = null;

    if (!response.ok) {
      throw new Error(`stream request failed: ${response.status}`);
    }
    if (!response.body || !response.body.getReader) {
      const fallback = await GCPAPI.fetchAIReply(sessionId, messageId)({});
      await _streamReplyToMessage(messageIndex, fallback, requestSeq);
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let ttsEnabled = false;
    let ttsIndex = 1;
    let ttsUrl = "";
    let allReceived = "";
    const updateTtsMeta = (text) => {
      const ttsUrlMeta = _extractTtsUrlFromText(text);
      if (ttsUrlMeta.enabled) {
        ttsEnabled = true;
        ttsUrl = ttsUrlMeta.ttsUrl;
        return;
      }
      const ttsMeta = _extractTtsMetaFromText(text);
      if (ttsMeta.enabled) {
        ttsEnabled = true;
        ttsIndex = ttsMeta.ttsIndex;
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const decodedText = decoder.decode(value, { stream: true });
      allReceived += decodedText;
      updateTtsMeta(decodedText);
      _applyStreamText(messageIndex, allReceived, requestSeq);
    }
    const remainingText = decoder.decode();
    if (remainingText) {
      allReceived += remainingText;
      updateTtsMeta(remainingText);
      _applyStreamText(messageIndex, allReceived, requestSeq);
    }

    if (ttsEnabled) {
      const cur = state.messages[messageIndex] || {};
      _replaceMessage(messageIndex, {
        ...cur,
        ttsEnabled: true,
        ttsIndex,
        ttsUrl: ttsUrl || cur.ttsUrl || "",
      });
    }

    _finishStreamMessage(messageIndex, requestSeq);
    if (requestSeq === state._activeRequestSeq) {
      state._activeReplyAbortFn = null;
    }
    return;
  }

  // 非流式环境兜底：使用 uni.request，并保留 abort 能力
  const replyReq = GCPAPI.fetchAIReply(sessionId, messageId)({});
  state._activeReplyAbortFn =
    replyReq && typeof replyReq.abort === "function" ? replyReq.abort : null;
  try {
    const fallback = await replyReq;
    await _streamReplyToMessage(messageIndex, fallback, requestSeq);
  } finally {
    if (requestSeq === state._activeRequestSeq) {
      state._activeReplyAbortFn = null;
    }
  }
}

async function _streamReplyToMessage(messageIndex, rawData = "", requestSeq) {
  // 防御：异常值（NaN/undefined）统一视为过期请求
  if (!Number.isFinite(Number(requestSeq)) || requestSeq !== state._activeRequestSeq) {
    const cur = state.messages[messageIndex];
    if (cur) {
      _replaceMessage(messageIndex, {
        ...cur,
        loading: false,
      });
    }
    return;
  }
  const blocks = _toAiBlocks(rawData);
  const aiMsg = state.messages[messageIndex];
  if (!aiMsg) return;

  // 非 fetch stream 回退：tts 标志可能也在 [DONE] 后
  const ttsUrlMeta = _extractTtsUrlFromText(rawData);
  const ttsMeta = _extractTtsMetaFromText(rawData);
  const nextTts =
    ttsUrlMeta.enabled || ttsMeta.enabled
      ? {
          ttsEnabled: true,
          ttsIndex: ttsMeta.ttsIndex,
          ttsUrl: ttsUrlMeta.ttsUrl || aiMsg.ttsUrl || "",
        }
      : {};

  _replaceMessage(messageIndex, {
    ...aiMsg,
    ...nextTts,
    rawSseText: rawData,
    blocks,
    loading: false,
  });
  _scrollToBottom();
}
// ---- TTS ----
function _extractTtsUrlFromText(text) {
  const s = String(text || "");
  // 新协议：tts 行直接携带接口地址（path 或完整 url）
  // 例：/ai-question-api/chat/tts/1774254785505955/1
  const m = s.match(
    /(https?:\/\/[^\s'"]*\/ai-question-api\/chat\/tts\/\d+\/\d+|\/ai-question-api\/chat\/tts\/\d+\/\d+)/,
  );
  if (m && m[1]) {
    return { enabled: true, ttsUrl: m[1] };
  }
  return { enabled: false, ttsUrl: "" };
}

function _extractTtsMetaFromText(text) {
  const s = String(text || "");
  const lower = s.toLowerCase();
  if (!lower.includes("tts")) {
    return { enabled: false, ttsIndex: 1 };
  }

  // 支持：tts/1、tts:1、<TTS>1</TTS> 等
  let ttsIndex = 1;
  const m1 = lower.match(/tts\D*(\d+)/);
  if (m1 && m1[1]) {
    const n = Number.parseInt(m1[1], 10);
    if (!Number.isNaN(n) && n > 0) ttsIndex = n;
  } else {
    const m2 = lower.match(/<\s*tts\s*\/?>\s*(\d+)/i);
    if (m2 && m2[1]) {
      const n2 = Number.parseInt(m2[1], 10);
      if (!Number.isNaN(n2) && n2 > 0) ttsIndex = n2;
    }
  }

  return { enabled: true, ttsIndex };
}

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

onMounted(() => {
  try {
    const done = uni.getStorageSync(AI_ASK_WELCOME_DONE_KEY);
    if (done === true || done === "true" || done === 1) {
      state.stage = "chat";
    }
    // 会话列表在 $store.state.userId 就绪后由 watch 拉取（App 内可能异步 get-user-info）
  } catch (e) {
    console.error("[AiChatPage] caught error", e);
    // 存储不可用时仍展示欢迎页
  }
});

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
      <!-- 背景装饰（Figma: 40432:14 / 40815:502 / 40432:15） -->
      <view class="ai-chat-bg">
        <view class="ai-chat-bg__ellipse ai-chat-bg__ellipse--1" />
        <view class="ai-chat-bg__ellipse ai-chat-bg__ellipse--2" />
        <view class="ai-chat-bg__ellipse ai-chat-bg__ellipse--3" />
      </view>

      <AiChatHeader
        :sessions="sessions"
        :selected-session-id="aiSessionId"
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
        @select-toggle="onShareSelectToggle"
        @refresh-click="onRefreshClick"
        @scroll-top="onScrollTop"
      />
      <!-- 导航 -->
      <AiChatNav :visible="showQuickPrompts" />

      <view v-if="isSessionSwitching" class="session-loading">
        <view class="session-loading__spinner" />
      </view>

      <view v-if="shareSheetVisible" class="share-sheet">
        <view class="share-sheet__header">
          <text class="share-sheet__title"> 分享对话到 </text>
        </view>
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
        <view class="share-sheet__cancel-wrap">
          <view class="share-sheet__cancel-btn" @tap="closeShareSheet">
            <text class="share-sheet__cancel-text">
              {{ $t("cancel") }}
            </text>
          </view>
        </view>
      </view>

      <!-- 分享长图预览/生成（Figma: 41648-647） -->
      <view v-else-if="sharePosterVisible" class="share-poster-modal">
        <view class="share-poster-modal__mask" @tap="closeSharePosterModal" />
        <view class="share-poster-modal__card" @tap.stop>
          <view class="share-poster-modal__content">
            <view v-if="sharePosterGenerating" class="share-poster-modal__loading">
              <view class="share-poster-modal__loading-content">
                <!-- <text class="share-poster-modal__loading-text">{{
                  $t("loading")
                }}</text> -->
                <view class="session-loading__spinner" />
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
          <view class="share-poster-modal__bottom">
            <view class="share-poster-modal__bottom-action-wrap">
              <view class="share-sheet__option" @tap="onSaveSharePoster">
                <view class="share-sheet__option-icon">
                  <image
                    class="share-poster-modal__bottom-action-icon"
                    src="@/assets/img/icon-saveImg.svg"
                    mode="aspectFit"
                  />
                </view>
                <text class="share-poster-modal__bottom-action-text"> 保存图片 </text>
              </view>
            </view>
            <view class="share-sheet__cancel-wrap">
              <view class="share-sheet__cancel-btn" @tap="closeSharePosterModal">
                <text class="share-sheet__cancel-text"> 取消 </text>
              </view>
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
  pointer-events: none;
  overflow: hidden;
}

.ai-chat-bg__ellipse {
  position: absolute;
  border-radius: 50%;
}

// 40432:14 Ellipse 1（可见）
.ai-chat-bg__ellipse--1 {
  left: -410rpx; // -205px
  top: -708rpx; // -354px
  width: 1022rpx; // 511px
  height: 1032rpx; // 516px
  background: radial-gradient(
    circle at 50% 50%,
    rgba(255, 194, 208, 0.74) 0%,
    rgba(252, 74, 120, 0) 95%
  );
  opacity: 0.31;
}

// 40432:15 Ellipse 2（Figma 默认隐藏，先占位保留）
.ai-chat-bg__ellipse--2 {
  display: none;
}

// 40815:502 Ellipse 3（Figma 默认隐藏，先占位保留）
.ai-chat-bg__ellipse--3 {
  display: none;
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

/* Share sheet (41148-602): occupy input area position */
.share-sheet {
  flex-shrink: 0;
  width: 100%;
  background: #ffffff;
  box-shadow: 12rpx 0 28rpx rgba(107, 90, 90, 0.12);
  padding-bottom: calc(32rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
}

.share-sheet__header {
  padding: 32rpx 48rpx 16rpx; /* 16px 24px 8px */
  border-radius: 32rpx 32rpx 0 0;
}

.share-sheet__title {
  font-size: 28rpx; /* 14px */
  line-height: 32rpx;
  color: #2f323c;
  font-weight: 500;
}

.share-sheet__options {
  display: flex;
  align-items: flex-start;
  gap: 32rpx; /* 16px */
  padding: 16rpx 48rpx 40rpx; /* 8px 24px 20px */
}

.share-sheet__option {
  width: 96rpx; /* 48px */
  height: 112rpx; /* 56px */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx; /* 4px */
}

.share-sheet__option--disabled {
  opacity: 0.35;
  pointer-events: none;
}

.share-sheet__option-icon {
  width: 80rpx; /* 40px */
  height: 80rpx; /* 40px */
  border-radius: 14rpx; /* 7px */
  background: #f9f9f9;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.share-sheet__option-icon-img {
  width: 40rpx;
  height: 40rpx;
}

.share-sheet__option-label {
  width: 100%;
  font-size: 18rpx; /* 9px */
  line-height: 24rpx;
  color: #2f323c;
  text-align: center;
}

.share-sheet__cancel-wrap {
  padding: 0 48rpx;
}

.share-sheet__cancel-btn {
  background: #f9f9f9;
  border-radius: 16rpx; /* 8px */
  padding: 24rpx 0; /* 12px */
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-sheet__cancel-text {
  font-size: 28rpx; /* 14px */
  color: #2f323c;
}

.share-sheet__home {
  padding: 32rpx 242rpx 16rpx; /* 16px 121px 8px */
  box-sizing: border-box;
}

.share-sheet__home-bar {
  height: 10rpx; /* 5px */
  border-radius: 100rpx;
  background: #000000;
  opacity: 0.9;
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
  background: transparent;
  display: flex;
  flex-direction: column;
}

.share-poster-modal__topbar {
  display: none;
}

.share-poster-modal__title {
  font-size: 28rpx;
  line-height: 40rpx;
  color: #2f323c;
  font-weight: 600;
}

.share-poster-modal__close {
  background: #f5f5f5;
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
}

.share-poster-modal__close-text {
  font-size: 26rpx;
  color: #2f323c;
}

.share-poster-modal__content {
  flex: 1;
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  padding: 40rpx 32rpx 32rpx;
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
  align-items: center;
  justify-content: center;
}

.share-poster-modal__loading-text {
  font-size: 28rpx;
  color: #5f6775;
}

.share-poster-modal__bottom {
  padding: 48rpx 32rpx calc(32rpx + constant(safe-area-inset-bottom));
  padding: 48rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fff;
  box-shadow: 0 -1rpx 0 rgba(0, 0, 0, 0.04);
  display: flex;
  flex-direction: column;
  gap: 40rpx;
}

.share-poster {
  width: 690rpx;
  margin: 0 auto;
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  box-sizing: border-box;
}

.share-poster__header {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 20rpx;
}

.share-poster__logo {
  width: 64rpx;
  height: 64rpx;
}

.share-poster__header-text {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.share-poster__header-title {
  font-size: 32rpx;
  line-height: 40rpx;
  font-weight: 700;
  color: #2f323c;
}

.share-poster__header-tip {
  font-size: 24rpx;
  line-height: 32rpx;
  color: #7a7f8c;
}

.share-poster__items {
  display: flex;
  flex-direction: column;
  gap: 22rpx;
}

.share-poster__item {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.share-poster__q,
.share-poster__a {
  padding: 18rpx 18rpx;
  border-radius: 18rpx;
}

.share-poster__q {
  background: #f6f7fb;
}

.share-poster__a {
  background: #ffffff;
  border: 1rpx solid rgba(47, 50, 60, 0.12);
}

.share-poster__q-label,
.share-poster__a-label {
  display: inline-block;
  font-size: 22rpx;
  line-height: 28rpx;
  color: #f8315e;
  font-weight: 700;
  margin-right: 12rpx;
}

.share-poster__text {
  font-size: 26rpx;
  line-height: 42rpx;
  color: #2f323c;
  white-space: pre-wrap;
  word-break: break-word;
}

.share-poster__markdown {
  font-size: 26rpx;
  line-height: 42rpx;
  color: #2f323c;
  word-break: break-word;
}

.share-poster__markdown ::v-deep img {
  max-width: 100%;
}

.share-poster-modal__img {
  width: 590rpx;
  height: auto;
  display: block;
  margin: 0 auto;
  border-radius: 16rpx;
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
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.share-poster-modal__bottom-action {
  padding: 24rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  flex: 1;
}

.share-poster-modal__bottom-action-text {
  font-size: 18rpx;
  color: #2f323c;
  font-weight: 700;
}

.share-poster-modal__bottom-cancel {
  flex: 1;
  background: #f0f0f0;
  border-radius: 50rpx;
  padding: 24rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.share-poster-modal__bottom-cancel-text {
  font-size: 28rpx;
  color: #2f323c;
  font-weight: 700;
}

.share-poster-modal__bottom-action-icon {
  width: 32rpx;
  height: 32rpx;
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

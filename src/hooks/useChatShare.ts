import type { Ref } from "vue";
import type { ShareRound, UiChatMessage } from "@/stores/chat-types";
import { computed, nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import iconCopyImage from "@/assets/img/icon-copy-image.svg";
import iconSaveImage from "@/assets/img/icon-save-image.svg";
import iconImage from "@/assets/img/icon-share-image.svg";
import iconLink from "@/assets/img/icon-share-link.svg";
import iconQQ from "@/assets/img/icon-share-qq.svg";
import iconWechat from "@/assets/img/icon-share-wechat.svg";
import { useChatStore } from "@/stores";
import { createLogger } from "@/utils/logger";

import { isMpaasReady, saveImageToAlbum } from "@/utils/platform/mpaas";

const logger = createLogger("share");

function toPlainText(markdown: string) {
  const source = String(markdown || "");
  return source.split("```")
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

function getCopyableMessageContent(msg: UiChatMessage) {
  const directContent = String(msg?.content || "").trim();
  if (directContent) return toPlainText(directContent);
  const answerContent = (msg.blocks || [])
    .filter(block => block?.type === "answer")
    .map(block => String(block?.payload?.content || "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (answerContent) return toPlainText(answerContent);
  return toPlainText(msg.rawSseText || "");
}

async function copyTextToClipboard(text: string) {
  const safeText = String(text || "");
  if (!safeText) return false;
  try {
    await new Promise((resolve, reject) => {
      uni.setClipboardData({ data: safeText, success: resolve, fail: reject });
    });
    return true;
  } catch (error) {
    logger.error("uni clipboard error", error);
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (error) {
    logger.error("navigator clipboard error", error);
  }
  return false;
}

export function useChatShare(posterEl: Ref<unknown>) {
  const { t } = useI18n();
  const chatStore = useChatStore();
  const shareSheetVisible = ref(false);
  const shareSelectedIndexes = ref<number[]>([]);
  const shareSuppressHighlight = ref(false);
  const sharePosterVisible = ref(false);
  const sharePosterDataUrl = ref("");
  const sharePosterGenerating = ref(false);

  const shareSheetOptions = computed(() => [
    { key: "wechat", label: "微信", icon: iconWechat },
    { key: "qq", label: "QQ", icon: iconQQ },
    { key: "share-image", label: "图片分享", icon: iconImage },
    { key: "copy-link", label: "分享链接", icon: iconLink },
  ]);

  function isShareMessageDisabled(index: number) {
    const list = chatStore.messages;
    const msg = list[index] || {};
    if (msg.role === "ai") return Boolean(msg.interrupted);
    if (msg.role === "user") {
      const next = list[index + 1];
      return Boolean(next && next.role === "ai" && next.interrupted);
    }
    return false;
  }

  function buildShareRounds(): ShareRound[] {
    const list = chatStore.messages;
    const rounds: ShareRound[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const msg = list[i] || {};
      if (msg.role !== "user") continue;
      const next = list[i + 1];
      const aiIndex = next && next.role === "ai" ? i + 1 : -1;
      const interrupted = Boolean(aiIndex >= 0 && list[aiIndex]?.interrupted);
      const indexes = [i].concat(aiIndex >= 0 ? [aiIndex] : []);
      rounds.push({
        userIndex: i,
        aiIndex,
        interrupted,
        selectableIndexes: indexes.filter(idx => !isShareMessageDisabled(idx)),
      });
    }
    return rounds;
  }

  const shareRoundMeta = computed(() => {
    const rounds = buildShareRounds();
    const selectableIndexes = Array.from(new Set(rounds.flatMap(round => round.selectableIndexes))).sort((a, b) => a - b);
    return {
      rounds,
      roundCount: rounds.length,
      hasInterrupted: rounds.some(round => round.interrupted),
      selectableIndexes,
    };
  });

  const shareSelectAllDisabled = computed(() => shareRoundMeta.value.roundCount > 5);
  const shareSelectedRoundCount = computed(() => {
    const selected = new Set(shareSelectedIndexes.value);
    return buildShareRounds().filter((round) => {
      const idxs = [round.userIndex].concat(round.aiIndex >= 0 ? [round.aiIndex] : []);
      return idxs.some(idx => selected.has(idx));
    }).length;
  });
  const shareAllChecked = computed(() => {
    const selectable = shareRoundMeta.value.selectableIndexes;
    if (!selectable.length) return false;
    const selected = new Set(shareSelectedIndexes.value);
    return selectable.every(i => selected.has(i));
  });

  function closeShareSheet(clear = true) {
    shareSheetVisible.value = false;
    if (clear) {
      shareSelectedIndexes.value = [];
      shareSuppressHighlight.value = false;
    }
  }

  function onShareClick(payload: { group?: number[] }) {
    shareSelectedIndexes.value = Array.isArray(payload?.group) ? payload.group : [];
    shareSheetVisible.value = true;
    shareSuppressHighlight.value = true;
  }

  function onShareSelectToggle(payload: { group?: number[] }) {
    const group = Array.isArray(payload?.group) ? payload.group : [];
    if (!group.length) return;
    const current = new Set(shareSelectedIndexes.value);
    const allSelected = group.every(i => current.has(i));
    const next = new Set(current);
    if (allSelected) group.forEach(i => next.delete(i));
    else group.forEach(i => next.add(i));

    if (!allSelected) {
      const selectedRoundCount = buildShareRounds().filter((round) => {
        const idxs = [round.userIndex].concat(round.aiIndex >= 0 ? [round.aiIndex] : []);
        return idxs.some(idx => next.has(idx));
      }).length;
      if (selectedRoundCount > 5) {
        uni.showToast({ title: t("share-max-round-warning"), icon: "none" });
        return;
      }
    }
    shareSelectedIndexes.value = Array.from(next).sort((a, b) => a - b);
    shareSuppressHighlight.value = false;
  }

  function onShareSelectAll() {
    const meta = shareRoundMeta.value;
    if (meta.roundCount > 5) return;
    if (shareAllChecked.value) {
      shareSelectedIndexes.value = [];
      shareSuppressHighlight.value = false;
      return;
    }
    shareSelectedIndexes.value = meta.selectableIndexes;
    shareSuppressHighlight.value = meta.roundCount > 0 && meta.roundCount < 5 && meta.hasInterrupted;
  }

  async function onCopyMessage({ msg }: { msg: UiChatMessage }) {
    const content = getCopyableMessageContent(msg);
    if (!content) {
      uni.showToast({ title: t("copy-failed-please-manually-copy"), icon: "none" });
      return;
    }
    const copied = await copyTextToClipboard(content);
    uni.showToast({ title: copied ? t("copy-success") : t("copy-failed-please-manually-copy"), icon: "none" });
  }

  async function generateSharePoster() {
    const { default: html2canvas } = await import("html2canvas");
    const elFromDom = typeof document !== "undefined" ? document.getElementById("share-poster-wrap") : null;
    const el = (elFromDom || posterEl.value) as HTMLElement | null;
    if (!el) throw new Error("poster-element-missing");
    sharePosterDataUrl.value = (await html2canvas(el, {
      backgroundColor: "#ffffff",
      useCORS: true,
      allowTaint: true,
      scale: 2,
    })).toDataURL("image/png");
  }

  function openSharePoster() {
    if (sharePosterGenerating.value) return;
    sharePosterVisible.value = true;
    sharePosterDataUrl.value = "";
    sharePosterGenerating.value = true;
    nextTick(async () => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        await generateSharePoster();
      } catch (error) {
        logger.error("caught error", error);
        uni.showToast({ title: t("share-poster-generate-failed"), icon: "none" });
      } finally {
        sharePosterGenerating.value = false;
      }
    });
  }

  function closeSharePosterModal() {
    sharePosterVisible.value = false;
    sharePosterDataUrl.value = "";
    sharePosterGenerating.value = false;
    closeShareSheet(true);
  }

  async function onShareSheetOption(item: { key?: string }) {
    closeShareSheet(false);
    if (item?.key === "copy-link") {
      const ok = await copyTextToClipboard("https://portal.sanygroup.com/appDownload/");
      uni.showToast({ title: ok ? t("link-copied") : t("copy-failed-please-manually-copy"), icon: "none" });
      closeShareSheet(true);
      return;
    }
    if (item?.key === "share-image") {
      if (!shareSelectedIndexes.value.length) return;
      openSharePoster();
      return;
    }
    if (item?.key === "wechat" || item?.key === "qq") {
      uni.showToast({ title: t("share-not-supported"), icon: "none" });
    }
    closeShareSheet(true);
  }

  async function onSaveSharePoster() {
    if (!sharePosterDataUrl.value) return;

    // 嵌在宿主 APP 里优先走原生存相册；宿主没实现再退回浏览器下载
    if (isMpaasReady()) {
      try {
        await saveImageToAlbum(sharePosterDataUrl.value);
        uni.showToast({ title: t("save-success"), icon: "none" });
        return;
      } catch (error) {
        logger.warn("原生保存图片失败，回退浏览器下载", error);
      }
    }

    const link = document.createElement("a");
    link.href = sharePosterDataUrl.value;
    link.download = "share-conversation.png";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    uni.showToast({ title: t("download-start"), icon: "none" });
  }

  async function onCopySharePoster() {
    if (!sharePosterDataUrl.value) return;
    const canCopyImage = typeof navigator !== "undefined"
      && typeof navigator.clipboard?.write === "function"
      && typeof ClipboardItem !== "undefined";
    if (!canCopyImage) {
      uni.showToast({ title: t("copy-failed-browser-not-supported"), icon: "none" });
      return;
    }
    try {
      const response = await fetch(sharePosterDataUrl.value);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      uni.showToast({ title: t("copy-success"), icon: "none" });
    } catch (error) {
      logger.error("clipboard image copy error", error);
      uni.showToast({ title: t("copy-failed"), icon: "none" });
    }
  }

  return {
    iconCopyImage,
    iconSaveImage,
    shareSheetVisible,
    shareSelectedIndexes,
    shareSuppressHighlight,
    sharePosterVisible,
    sharePosterDataUrl,
    sharePosterGenerating,
    shareSheetOptions,
    shareSelectAllDisabled,
    shareSelectedRoundCount,
    shareAllChecked,
    onShareClick,
    onShareSelectToggle,
    onShareSelectAll,
    closeShareSheet,
    onShareSheetOption,
    onCopyMessage,
    closeSharePosterModal,
    onSaveSharePoster,
    onCopySharePoster,
  };
}

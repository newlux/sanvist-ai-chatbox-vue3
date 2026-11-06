<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { buildRepairH5Url } from "@/utils/repair-h5";
import { consumePendingRepairNavigationContext } from "@/utils/repair-navigation";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 故障维修页：内嵌三方 H5（降级页）。
 *
 * 正常路径是首页 / 听播页直接 pushWindow 开三方 H5（顶层文档，bridge 可直连）；
 * 只有容器里拿不到 bridge 时才会退到这里，用 iframe 内嵌。
 */
defineOptions({ name: "AiRepairPage" });

const logger = createLogger("repair-page");
const { safeTopPx } = useSafeArea();
const embedUrl = ref("");
const loadError = ref("");
const repairIframeRef = ref<HTMLIFrameElement | null>(null);
const repairNavigationContext = ref<Record<string, unknown>>({});
const repairDetailConversationId = ref("");

type RepairInboundMessage =
  | { type: "navigate_back"; source: "maix-chat" }
  | { type: "query_question" };

const iframeSrc = computed(() => {
  console.log("🚀 ~ embedUrl.value:", embedUrl.value);
  return embedUrl.value;
});

const embedStyle = computed(() => ({
  paddingTop: `${safeTopPx.value}px`,
}));

function buildEmbedUrl() {
  try {
    // 参数口径统一在 utils/repair-h5 里（与 pushWindow 直开三方页的那条路径共用一份）
    embedUrl.value = buildRepairH5Url({
      sessionId: String(repairNavigationContext.value.sessionId || ""),
      conversationId: String(repairNavigationContext.value.conversationId || ""),
      chatConversationId: repairDetailConversationId.value,
    });
    loadError.value = "";
  }
  catch (error) {
    loadError.value = "三方页面加载失败";
    logger.error("failed to build repair h5 url", error);
  }
}

function getRepairOrigin() {
  try {
    return new URL(embedUrl.value).origin;
  }
  catch {
    return "";
  }
}

function isRepairInboundMessage(value: unknown): value is RepairInboundMessage {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<RepairInboundMessage>;
  return (payload.type === "navigate_back" && payload.source === "maix-chat")
    || payload.type === "query_question";
}

function postToRepair(payload: Record<string, unknown>) {
  const repairWindow = repairIframeRef.value?.contentWindow;
  const origin = getRepairOrigin();
  if (!repairWindow || !origin) return false;

  console.log("🚀 ~ postToRepair ~ payload:", payload);
  repairWindow.postMessage(payload, origin);
  return true;
}

function handleQueryQuestion() {
  const question = String(repairNavigationContext.value.query || "").trim();
  // const deviceNo = String(repairNavigationContext.value.deviceid || "").trim();
  if (!question) {
    logger.warn("维修 H5 请求问题时缺少 AI 问答导航上下文", repairNavigationContext.value);
    return;
  }

  postToRepair({
    type: "send_question",
    data: { question },
    // data: { question, deviceNo },
  });
}

function handleRepairMessage(event: MessageEvent) {
  if (event.source !== repairIframeRef.value?.contentWindow) return;
  if (event.origin !== getRepairOrigin()) return;
  if (!isRepairInboundMessage(event.data)) return;

  if (event.data.type === "navigate_back") {
    backFromScene();
    return;
  }

  handleQueryQuestion();
}

onMounted(() => {
  repairNavigationContext.value = consumePendingRepairNavigationContext();
  const pages = getCurrentPages();
  const current = pages[pages.length - 1] as { options?: Record<string, unknown> } | undefined;
  repairDetailConversationId.value = String(current?.options?.conversationId || "").trim();
  buildEmbedUrl();
  window.addEventListener("message", handleRepairMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", handleRepairMessage);
});
</script>

<template>
  <view class="ai-page">
    <view class="ai-page__embed" :style="embedStyle">
      <text v-if="loadError" class="ai-page__error">
        {{ loadError }}
      </text>
      <iframe
        v-else-if="iframeSrc"
        ref="repairIframeRef"
        class="ai-page__iframe"
        :src="iframeSrc"
        frameborder="0"
        allow="microphone; camera; autoplay; clipboard-write"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-page {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: #fafafa;
}

.ai-page__embed {
  position: relative;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  background: #fff;
}

.ai-page__iframe {
  display: block;
  width: 100vw;
  height: 100%;
  border: 0;
  overflow: hidden;
}

.ai-page__error {
  display: block;
  padding: 48rpx 40rpx;
  color: #6b6b6b;
  font-size: 28rpx;
  text-align: center;
}
</style>

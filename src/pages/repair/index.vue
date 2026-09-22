<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { consumePendingRepairNavigationContext } from "@/utils/repair-navigation";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 故障维修页：内嵌三方 H5。
 * 入口 URL 由 sanvist H5 加密脚本本地生成，不走业务对话链路。
 */
defineOptions({ name: "AiRepairPage" });

const logger = createLogger("repair-page");
const userStore = useUserStore();
const { safeTopPx } = useSafeArea();
const embedUrl = ref("");
const loadError = ref("");
const repairIframeRef = ref<HTMLIFrameElement | null>(null);
const repairNavigationContext = ref<Record<string, unknown>>({});

type RepairInboundMessage =
  | { type: "navigate_back"; source: "maix-chat" }
  | { type: "query_question" };

const iframeSrc = computed(() => {
  console.log("🚀 ~ embedUrl.value:", embedUrl.value);
  return embedUrl.value;
});

const embedStyle = computed(() => ({
  paddingTop: `${safeTopPx.value}px`,
  // paddingBottom: `${safeBottomPx.value}px`,
}));

function buildEmbedUrl() {
  try {
    const result = buildSanvistH5Url({
      userId: "10",
      externalUserId: String(userStore.userId || "").trim() || undefined,
      name: String(userStore.username || "").trim() || undefined,
      // userId: String(repairNavigationContext.value.userId || userStore.userId || "").trim() || undefined,
      sessionId: String(repairNavigationContext.value.sessionId || "").trim() || undefined,
      conversationId: String(repairNavigationContext.value.conversationId || "").trim() || undefined,
    });
    embedUrl.value = result.url;
    loadError.value = "";
    logger.info("sanvist h5 url ready", result.payload);
  }
  catch (error) {
    loadError.value = "三方页面加载失败";
    logger.error("failed to build sanvist h5 url", error);
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
  height: 100vh;
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

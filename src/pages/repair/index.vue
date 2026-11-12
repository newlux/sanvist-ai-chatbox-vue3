<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { createRepairChannelId } from "@/utils/repair-bridge";
import { buildRepairH5Url } from "@/utils/repair-h5";
import { consumePendingRepairNavigationContext } from "@/utils/repair-navigation";
import { backFromScene } from "@/utils/scene-navigation";

/**
 * 故障维修页：内嵌三方 H5（**兜底壳页**）。
 *
 * 正常入口走 `utils/repair-h5` 的 pushWindow 直达三方页；只有原生容器不可用
 * （浏览器 / PC 内嵌）或 pushWindow 失败时才落到本页，由 iframe 内嵌同一个三方 H5，
 * 并用 postMessage 桥转发「取问题 / 关闭窗口」。
 */
defineOptions({ name: "AiRepairPage" });

const logger = createLogger("repair-page");
const { safeTopPx } = useSafeArea();
const embedUrl = ref("");
const loadError = ref("");
const repairIframeRef = ref<HTMLIFrameElement | null>(null);
const repairNavigationContext = ref<Record<string, unknown>>({});
const repairDetailConversationId = ref("");
/**
 * 通知通道 id：与 pushWindow 那条链路同一个参数（`repairChannelId`），
 * 三方页收到后会把消息打上同一个 id —— 壳页是 iframe，用不了 mPaaS 通知，
 * 这个 id 只用来对齐两端报文，避免旧窗口的消息串进来。
 */
const repairChannelId = createRepairChannelId();

type RepairInboundMessage =
  | { type: "navigate_back"; source: "maix-chat" }
  | { type: "query_question" };

const iframeSrc = computed(() => embedUrl.value);

const embedStyle = computed(() => ({
  paddingTop: `${safeTopPx.value}px`,
}));

/** 日志用：只取 URL 的参数名，ciphertext / access_token 这类鉴权值不落日志 */
function urlParamNames(url: string) {
  try {
    const names: string[] = [];
    new URL(url).searchParams.forEach((_value, key) => {
      names.push(key);
    });
    return names;
  }
  catch {
    return [];
  }
}

/** 地址口径与 pushWindow 直达共用一处（utils/repair-h5），这里只补上壳页才有的上下文来源。 */
function buildEmbedUrl() {
  try {
    embedUrl.value = buildRepairH5Url({
      sessionId: String(repairNavigationContext.value.sessionId || "").trim(),
      conversationId: String(repairNavigationContext.value.conversationId || "").trim(),
      chatConversationId: repairDetailConversationId.value,
      channelId: repairChannelId,
    });
    loadError.value = "";
    logger.info("维修壳页 iframe 地址已就绪", {
      channelId: repairChannelId,
      params: urlParamNames(embedUrl.value),
      hasChannelParam: embedUrl.value.includes("repairChannelId="),
    });
  }
  catch (error) {
    loadError.value = "三方页面加载失败";
    logger.error("维修壳页 iframe 地址生成失败", error);
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
  const payload = value as Partial<RepairInboundMessage> & { channelId?: unknown };
  // 带了 channelId 就必须是本次通道的，否则是旧 iframe / 旧窗口的迟到消息
  if (payload.channelId && String(payload.channelId) !== repairChannelId) return false;
  return (payload.type === "navigate_back" && payload.source === "maix-chat")
    || payload.type === "query_question";
}

function postToRepair(payload: Record<string, unknown>) {
  const repairWindow = repairIframeRef.value?.contentWindow;
  const origin = getRepairOrigin();
  if (!repairWindow || !origin) {
    logger.warn("iframe 还没就绪，消息未发出", { origin: origin || "(空)", payload });
    return false;
  }

  const message = { channelId: repairChannelId, ...payload };
  logger.info("发给维修 H5（iframe postMessage）", message);
  repairWindow.postMessage(message, origin);
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
  if (!isRepairInboundMessage(event.data)) {
    logger.debug("忽略 iframe 消息（非约定类型 / 别的通道）", event.data);
    return;
  }

  logger.info("收到维修 H5 消息（iframe postMessage）", event.data);

  if (event.data.type === "navigate_back") {
    logger.info("维修 H5 要求返回上一场景");
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

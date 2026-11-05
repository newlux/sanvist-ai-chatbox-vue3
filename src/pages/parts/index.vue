<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { onLoad } from "@dcloudio/uni-app";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { waitForMpaas } from "@/utils/platform/mpaas";

/**
 * 配件助手页：全屏内嵌三方 H5。
 *
 * 地址由首页「配件助手」弹层里手填，页面通过 `?url=` 接过来原样使用，
 * 不做域名白名单、不做参数拼接（填什么就打开什么）。
 *
 * 另外把父窗口的 `AlipayJSBridge` 注入给内嵌页，让三方页也能直接
 * `AlipayJSBridge.call("imageChoose", ...)` 调原生能力：
 * - 同源：直接挂到 iframe 的 window 上并补派发 AlipayJSBridgeReady；
 * - 跨域：浏览器禁止读写 contentWindow 的属性，只能由内嵌页 postMessage 过来、父页代为调用。
 */
defineOptions({ name: "AiPartsPage" });

const logger = createLogger("parts-page");

const { t } = useI18n();
const { safeTopPx } = useSafeArea();

const iframeSrc = ref("");
const iframeRef = ref<HTMLIFrameElement | null>(null);

const embedStyle = computed(() => ({
  paddingTop: `${safeTopPx.value}px`,
}));

let nativeBridge: Awaited<ReturnType<typeof waitForMpaas>> = null;

async function ensureBridge() {
  if (!nativeBridge) nativeBridge = await waitForMpaas(2000);
  return nativeBridge;
}

/**
 * iframe 加载完成后注入 bridge。
 * 访问 contentWindow 的属性在同源下才会成功，跨域会抛 SecurityError，这里直接降级。
 */
async function onIframeLoad() {
  const frame = iframeRef.value;
  const win = frame?.contentWindow as (Window & { AlipayJSBridge?: unknown }) | null;
  if (!win) return;

  const bridge = await ensureBridge();
  if (!bridge) {
    logger.warn("[parts] 宿主 bridge 未就绪，内嵌页暂时拿不到原生能力");
    return;
  }

  try {
    win.AlipayJSBridge = bridge;
    // 三方页通常是等这个事件后再取 AlipayJSBridge，注入完补派发一次
    const EventCtor = (win as unknown as { Event?: typeof Event }).Event || Event;
    win.document.dispatchEvent(new EventCtor("AlipayJSBridgeReady"));
    logger.info("[parts] AlipayJSBridge 已注入内嵌页");
  } catch (error) {
    logger.warn("[parts] iframe 跨域，无法直接注入 AlipayJSBridge；内嵌页可改用 postMessage 代理", error);
  }
}

/** 跨域兜底：内嵌页 postMessage 请求，父页代为调原生，再把回参发回去 */
const BRIDGE_CALL_TYPE = "alipayjsbridge-call";
const BRIDGE_RESULT_TYPE = "alipayjsbridge-result";

function replyToFrame(payload: Record<string, unknown>) {
  iframeRef.value?.contentWindow?.postMessage(payload, "*");
}

function onFrameMessage(event: MessageEvent) {
  const frame = iframeRef.value;
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event.data as Record<string, unknown> | null;
  if (!data || data.type !== BRIDGE_CALL_TYPE) return;

  const api = String(data.api || "").trim();
  const requestId = String(data.requestId || "");
  if (!api) return;
  const params = data.params && typeof data.params === "object"
    ? data.params as Record<string, unknown>
    : {};

  logger.debug("[parts] 代理原生调用", { api, requestId });
  void ensureBridge().then((bridge) => {
    if (!bridge) {
      replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, error: "bridge 不可用" });
      return;
    }
    try {
      // 不用 callNative：选图/拍照这类 JSAPI 可能长时间不回调，这里不设超时，回参原样转发
      bridge.call(api, params, (result) => {
        replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, result: result || {} });
      });
    }
    catch (error) {
      replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, error: String((error as Error)?.message || error) });
    }
  });
}

onMounted(() => {
  window.addEventListener("message", onFrameMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onFrameMessage);
  nativeBridge = null;
});

/**
 * 取 `?url=`：uni 或原生窗口（openWebview）通常已经解过一次码，
 * 只有还残留 %xx 转义序列时才再解一层，避免把地址里正常的 % 二次解码坏掉。
 */
function readUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/%[0-9a-f]{2}/i.test(raw)) return raw;
  try {
    return decodeURIComponent(raw).trim() || raw;
  }
  catch {
    return raw;
  }
}

onLoad((options) => {
  iframeSrc.value = readUrl(options?.url);
});
</script>

<template>
  <view class="ai-parts-page">
    <view class="ai-parts-page__embed" :style="embedStyle">
      <text v-if="!iframeSrc" class="ai-parts-page__error">
        {{ t("parts-page-empty") }}
      </text>
      <iframe
        v-else
        ref="iframeRef"
        class="ai-parts-page__iframe"
        :src="iframeSrc"
        frameborder="0"
        allow="microphone; camera; autoplay; clipboard-write"
        @load="onIframeLoad"
      />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-parts-page {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: #fafafa;
}

.ai-parts-page__embed {
  position: relative;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  background: #ffffff;
}

.ai-parts-page__iframe {
  display: block;
  width: 100vw;
  height: 100%;
  border: 0;
  overflow: hidden;
}

.ai-parts-page__error {
  display: block;
  padding: 48rpx 40rpx;
  color: #6b6b6b;
  font-size: 28rpx;
  text-align: center;
}
</style>

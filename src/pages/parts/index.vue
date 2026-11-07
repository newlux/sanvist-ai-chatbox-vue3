<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { onLoad } from "@dcloudio/uni-app";
import { useSafeArea } from "@/hooks/useSafeArea";
import { createLogger } from "@/utils/logger";
import { onNativeEvent, waitForMpaas } from "@/utils/platform/mpaas";

/**
 * 配件助手页：全屏内嵌三方 H5。
 *
 * 地址由首页「配件助手」弹层里手填，页面通过 `?url=` 接过来原样使用，
 * 不做域名白名单、不做参数拼接（填什么就打开什么）。
 *
 * 另外把父窗口的 `AlipayJSBridge` 能力开放给内嵌页，让三方页也能直接
 * `AlipayJSBridge.call("imageChoose", ...)` 调原生能力：
 * - 同源：直接把 bridge 挂到 iframe 的 window 上，并补派发 AlipayJSBridgeReady；
 * - 跨域（当前实际场景）：浏览器禁止读写 contentWindow 的属性，
 *   由三方页引入 `public/alipay-jsbridge-shim.js`（构建后位于 H5 站点根路径
 *   `/alipay-jsbridge-shim.js`），shim 在它自己的 window 上补一个同名对象，
 *   call / on 全部 postMessage 过来，本页代为调原生再把回参发回去。
 *
 *   三方页只需要在 <head> 里加一行（闭合标签这里写成 <\/script>：
 *   直接照抄真正的闭合标签会把本文件的 script 块提前截断，SFC 解析会报
 *   「Element is missing end tag」，连带整页编译失败）：
 *   <script src="https://<chatbox-h5-domain>/alipay-jsbridge-shim.js"><\/script>
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
    // 跨域是设计好的路径：请内嵌页引入 /alipay-jsbridge-shim.js 走 postMessage 代理
    logger.warn(
      "[parts] iframe 跨域，无法直接注入 AlipayJSBridge；请让内嵌页在 <head> 引入 /alipay-jsbridge-shim.js 走代理",
      error,
    );
  }
}

/**
 * 跨域兜底：内嵌页引入 `public/alipay-jsbridge-shim.js` 后，
 * 它那边会有一个「长得跟原生一样」的 AlipayJSBridge，
 * 所有 call / on 都转成 postMessage 过来，由这里代为调用真正的 bridge，再把结果发回去。
 *
 * 协议（两边字段必须一致，改一个就要同步改 shim）：
 *   内嵌 → 父页  { type: "alipayjsbridge-call", requestId, api, params }
 *                { type: "alipayjsbridge-on" | "alipayjsbridge-off", event }
 *   父页 → 内嵌  { type: "alipayjsbridge-result", requestId, result } / { ..., error }
 *                { type: "alipayjsbridge-event", event, data }
 */
const BRIDGE_CALL_TYPE = "alipayjsbridge-call";
const BRIDGE_RESULT_TYPE = "alipayjsbridge-result";
const BRIDGE_EVENT_TYPE = "alipayjsbridge-event";
const BRIDGE_ON_TYPE = "alipayjsbridge-on";
const BRIDGE_OFF_TYPE = "alipayjsbridge-off";

/** 内嵌页的 origin：回包定向投递用，解析失败时退回 "*" */
const frameOrigin = ref("");

function resolveOrigin(url: string) {
  try {
    return new URL(url).origin;
  }
  catch {
    return "";
  }
}

function replyToFrame(payload: Record<string, unknown>) {
  const frame = iframeRef.value;
  if (!frame?.contentWindow) return;
  // origin 为 "null"（sandbox iframe）或解析不到时只能退 "*"，否则消息会打不出去
  const target = frameOrigin.value && frameOrigin.value !== "null" ? frameOrigin.value : "*";
  frame.contentWindow.postMessage(payload, target);
}

/** 内嵌页既可能发对象也可能发 JSON 字符串，两种都接 */
function readFrameMessage(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    }
    catch {
      return null;
    }
  }
  return typeof raw === "object" ? raw as Record<string, unknown> : null;
}

/** 内嵌页订阅的原生事件：eventName → 取消订阅函数 */
const frameEventDisposers = new Map<string, () => void>();

function subscribeFrameEvent(eventName: string) {
  if (!eventName || frameEventDisposers.has(eventName)) return;
  // onNativeEvent 同时挂 bridge.on 与 DOM 事件两条通道，哪条推都能收到
  const dispose = onNativeEvent(eventName, (payload) => {
    replyToFrame({ type: BRIDGE_EVENT_TYPE, event: eventName, data: payload || {} });
  });
  frameEventDisposers.set(eventName, dispose);
  logger.info("[parts] 内嵌页订阅原生事件", eventName);
}

function unsubscribeFrameEvent(eventName: string) {
  const dispose = frameEventDisposers.get(eventName);
  if (!dispose) return;
  dispose();
  frameEventDisposers.delete(eventName);
}

function disposeAllFrameEvents() {
  frameEventDisposers.forEach(dispose => dispose());
  frameEventDisposers.clear();
}

/** 内嵌页是否已经接上 shim（只用来打一条日志，便于排查链路） */
let proxyAttached = false;

/** 把内嵌页的一次调用转给原生，回参原样转发 */
function proxyCall(api: string, params: Record<string, unknown>, requestId: string) {
  if (!proxyAttached) {
    proxyAttached = true;
    logger.info("[parts] 内嵌页已接入 AlipayJSBridge 代理");
  }
  void ensureBridge().then((bridge) => {
    if (!bridge) {
      replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, error: "bridge 不可用" });
      return;
    }
    try {
      // 不用 callNative：选图 / 拍照 / 录音这类 JSAPI 可能长时间不回调，这里不设超时，回参原样转发
      bridge.call(api, params, (result) => {
        replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, result: result || {} });
      });
    }
    catch (error) {
      replyToFrame({ type: BRIDGE_RESULT_TYPE, requestId, error: String((error as Error)?.message || error) });
    }
  });
}

function onFrameMessage(event: MessageEvent) {
  const frame = iframeRef.value;
  // source 必须是这一个 iframe 的窗口：别的窗口伪造不了，安全性靠这一条
  if (!frame || event.source !== frame.contentWindow) return;

  // 内嵌页可能在内部跳转（离线包 fallback → 正式域），origin 会跟着变：
  // 以实际来源为准更新回包目标，否则定向投递会打空、内嵌页永远等不到回调
  if (event.origin && event.origin !== "null" && event.origin !== frameOrigin.value) {
    frameOrigin.value = event.origin;
  }

  const data = readFrameMessage(event.data);
  if (!data) return;

  if (data.type === BRIDGE_ON_TYPE) {
    subscribeFrameEvent(String(data.event || ""));
    return;
  }
  if (data.type === BRIDGE_OFF_TYPE) {
    unsubscribeFrameEvent(String(data.event || ""));
    return;
  }
  if (data.type !== BRIDGE_CALL_TYPE) return;

  const api = String(data.api || "").trim();
  const requestId = String(data.requestId || "");
  const params = data.params && typeof data.params === "object"
    ? data.params as Record<string, unknown>
    : {};
  if (!api || !requestId) return;

  logger.debug("[parts] 代理原生调用", { api, requestId });
  proxyCall(api, params, requestId);
}

onMounted(() => {
  window.addEventListener("message", onFrameMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onFrameMessage);
  disposeAllFrameEvents();
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
  // 先记下内嵌页 origin：回包定向投递 + 收消息时校验来源都要用
  frameOrigin.value = resolveOrigin(iframeSrc.value);
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

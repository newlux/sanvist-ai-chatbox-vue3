/**
 * 维修助理（三方 H5 / maix-bm）入口：地址拼装 + pushWindow 直达。
 *
 * 维修助理有两条打开方式：
 * - **首选（原生）**：本地用 `buildSanvistH5Url` 拼好三方地址，`pushWindow` 直接开一个原生
 *   WebView 加载三方 H5 —— 没有 iframe 套壳，容器给的返回键、顶部安全区都是原生的；
 *   AI 问答上下文（sessionId / conversationId）走 URL 参数，不落盘。
 * - **兜底**：宿主没注入 bridge / pushWindow 失败 / 地址生成失败时，退回本地壳页
 *   `/pages/repair/index`（该页 iframe 内嵌三方 H5）。壳页只能靠本地存储取上下文，
 *   所以 `onFallback` 在这个时机才落盘 pending 上下文。
 *
 * 通信：两个 webview 之间靠 mPaaS 通知通道（见 utils/repair-bridge）。
 * 每次打开生成一个 `channelId` 拼进地址，**先挂监听再 pushWindow** ——
 * 三方页一进来就会来要问题（query_question），晚一步那句提问就丢了。
 */
import type { RepairChannel, RepairInboundMessage } from "@/utils/repair-bridge";
import { useSystemStore, useUserStore } from "@/stores";
import { resolveSelectedLanguage, resolveSelectedVoiceId } from "@/utils/assistant-h5-params";
import { createLogger } from "@/utils/logger";
import { isMpaasReady, openWebview } from "@/utils/platform/mpaas";
import {
  createRepairChannelId,
  onRepairChannelMessage,
  rememberRepairConversationId,
  REPAIR_CHANNEL_PARAM,
  sendRepairQuestion,
} from "@/utils/repair-bridge";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";
import { navigateToScene } from "@/utils/scene-navigation";

const logger = createLogger("repair-h5");

/** 本地维修壳页（iframe 内嵌三方 H5），只在 pushWindow 不可用 / 失败时兜底 */
const REPAIR_SHELL_ROUTE = "/pages/repair/index";

export interface RepairH5UrlOptions {
  /** 来源 SSE 的 sessionId（AI 问答上下文） */
  sessionId?: string;
  /** 来源 SSE 的 conversationId（AI 问答上下文） */
  conversationId?: string;
  /** 维修助理会话 id：接在三方页 `/repair/{id}` 后面（快问快答 / 诊断中 / 诊断完成的回流卡跳转用） */
  chatConversationId?: string;
  /** 通知通道 id：拼进地址（`repairChannelId`），三方页回传消息时原样带回 */
  channelId?: string;
}

export interface OpenRepairAssistantOptions extends RepairH5UrlOptions {
  /**
   * 三方页 `query_question` 时要的那句提问：
   * 由调用方从 AI 问答上下文里取，本模块只负责把它发回去。
   */
  question?: string;
  /** 三方页回传的其它消息（已按 channelId 过滤）：`conversation_created` / `navigate_back` */
  onMessage?: (message: RepairInboundMessage) => void;
  /**
   * 降级回本地壳页前的落盘钩子。
   * 只有壳页（iframe）才需要把 AI 问答上下文写进本地存储，直连三方 H5 时走 URL 参数，
   * 这里不落盘，避免残留数据被首页的回调轮询误消费。
   */
  onFallback?: () => void;
  /** 降级时打开的站内路由，默认维修壳页；带参数的场景（如详情会话）可覆盖 */
  fallbackUrl?: string;
}

/**
 * 拼三方维修 H5 的完整地址（含加密身份、主题、音色、语言、AI 问答上下文、通知通道）。
 * pushWindow 直达与本地壳页 iframe 共用这一处口径，避免两边参数漂移。
 */
export function buildRepairH5Url(options: RepairH5UrlOptions = {}) {
  const userStore = useUserStore();
  const systemStore = useSystemStore();
  const channelId = String(options.channelId || "").trim();
  return buildSanvistH5Url({
    userId: "66",
    externalUserId: String(userStore.userId || "").trim() || undefined,
    name: String(userStore.username || "").trim() || undefined,
    sessionId: String(options.sessionId || "").trim() || undefined,
    conversationId: String(options.conversationId || "").trim() || undefined,
    chatConversationId: String(options.chatConversationId || "").trim() || undefined,
    // 外观：带具体生效值（light / dark），不再把 system 透给内嵌页
    theme: systemStore.appAppearance,
    // 音色：把选中的音色 id 原样带给三方页
    voice: resolveSelectedVoiceId(),
    // 界面语言：中英文值（zh_CN / en_US）以 language 参数带给三方页
    language: resolveSelectedLanguage(),
    // 通知通道：三方页据此把消息发回来，也据此过掉别的窗口的旧消息
    extraParams: channelId ? { [REPAIR_CHANNEL_PARAM]: channelId } : undefined,
  }).url;
}

/** 防止连续点击在 bridge 等待 / 原生转场期间重复开窗 */
let opening = false;
/** 当前这条通道：再次进入维修助理时先把旧监听摘掉 */
let currentChannel: RepairChannel | null = null;
/** `pagehide` 只挂一次：webview 被回收时收起监听 */
let pagehideBound = false;

function bindPagehideCleanup() {
  if (pagehideBound || typeof window === "undefined") return;
  pagehideBound = true;
  window.addEventListener("pagehide", () => {
    logger.info("webview pagehide，收起维修助理通知通道");
    currentChannel?.dispose();
    currentChannel = null;
  });
}

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

/**
 * 打开维修助理：pushWindow 直达三方 H5，失败才降级回本地壳页。
 *
 * 流程与三方约定一致：生成 channelId → 拼地址 → **挂监听** → pushWindow。
 * 返回本次通道（`channelId` + `dispose`），页面卸载时可主动收起。
 */
export async function openRepairAssistant(
  options: OpenRepairAssistantOptions = {},
): Promise<RepairChannel | null> {
  if (opening) {
    logger.info("上一次打开还没结束，忽略这次点击", { channelId: currentChannel?.channelId || "" });
    return currentChannel;
  }
  opening = true;

  const { onFallback, fallbackUrl = REPAIR_SHELL_ROUTE, onMessage } = options;
  const channelId = String(options.channelId || "").trim() || createRepairChannelId();
  const question = String(options.question || "").trim();
  logger.info("打开维修助理", {
    channelId,
    sessionId: options.sessionId || "(空)",
    conversationId: options.conversationId || "(空)",
    chatConversationId: options.chatConversationId || "(空)",
    question: question ? `有(${question.length}字)` : "(空)",
  });

  // 上一轮（可能是上一个窗口 / 上一次进入）的监听先摘掉，避免同一句问题被回两遍
  currentChannel?.dispose();
  const channel = onRepairChannelMessage(channelId, (message) => {
    if (message.type === "query_question") {
      // 「看详情」这类入口没有提问，三方页问了也不该回一句空的
      if (question) void sendRepairQuestion(channelId, question);
      else logger.warn("维修助理来取问题，但本次进入没有携带提问", { channelId });
      return;
    }
    if (message.type === "conversation_created") {
      rememberRepairConversationId(message.conversationId);
    }
    // navigate_back：popWindow 只能由三方页在自己的 webview 里发，宿主不代劳，只透传给调用方
    onMessage?.(message);
  });
  currentChannel = channel;
  bindPagehideCleanup();

  try {
    const fallback = (reason: string) => {
      logger.warn(`维修助理降级为本地壳页：${reason}`, { channelId, fallbackUrl });
      onFallback?.();
      void navigateToScene(fallbackUrl);
    };

    let url = "";
    try {
      url = buildRepairH5Url({
        sessionId: options.sessionId,
        conversationId: options.conversationId,
        chatConversationId: options.chatConversationId,
        channelId,
      });
      logger.info("维修助理地址已拼好", {
        channelId,
        // 只打参数名：ciphertext / access_token 这类鉴权值不能落日志
        params: urlParamNames(url),
        hasChannelParam: url.includes(`${REPAIR_CHANNEL_PARAM}=`),
      });
    }
    catch (error) {
      logger.error("维修助理地址生成失败", error);
      fallback("地址生成失败");
      return channel;
    }

    if (!isMpaasReady() || typeof location === "undefined") {
      // 浏览器 / PC 内嵌没有原生容器：直接走站内壳页
      fallback("没有 mPaaS 容器");
      return channel;
    }

    // 监听挂上再开窗：三方页一进来就 query_question，晚一步这句提问就丢了
    const listening = await channel.ready;
    logger.info(listening ? "通知通道已就绪，开始 pushWindow" : "通知通道不可用，仍然 pushWindow（三方页来取问题时会收不到）", {
      channelId,
    });

    // pushWindow 成功时不保证回调，只有明确失败才降级，避免二次跳转
    await openWebview(url, fallback.bind(null, "pushWindow 调用失败"));
    logger.info("pushWindow 已发出（成功时宿主不回调）", { channelId });
    return channel;
  }
  finally {
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

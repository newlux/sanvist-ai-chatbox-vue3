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
 * 三方页的返回由它自己处理（原生返回键 / 自己跳回）；壳页上的 postMessage 桥只服务兜底路径。
 */
import { useSystemStore, useUserStore } from "@/stores";
import { resolveSelectedLanguage, resolveSelectedVoiceId } from "@/utils/assistant-h5-params";
import { createLogger } from "@/utils/logger";
import { isMpaasReady, openWebview } from "@/utils/platform/mpaas";
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
  /** 维修助理详情会话 id：作为三方页 `/chat/{id}` 路径参数（回流卡「看详情」用） */
  chatConversationId?: string;
}

export interface OpenRepairAssistantOptions extends RepairH5UrlOptions {
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
 * 拼三方维修 H5 的完整地址（含加密身份、主题、音色、语言、AI 问答上下文）。
 * pushWindow 直达与本地壳页 iframe 共用这一处口径，避免两边参数漂移。
 */
export function buildRepairH5Url(options: RepairH5UrlOptions = {}) {
  const userStore = useUserStore();
  const systemStore = useSystemStore();
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
  }).url;
}

/** 防止连续点击在 bridge 等待 / 原生转场期间重复开窗 */
let opening = false;

/**
 * 打开维修助理：pushWindow 直达三方 H5，失败才降级回本地壳页。
 */
export async function openRepairAssistant(options: OpenRepairAssistantOptions = {}) {
  if (opening) return;
  opening = true;

  const { onFallback, fallbackUrl = REPAIR_SHELL_ROUTE } = options;
  try {
    const fallback = () => {
      onFallback?.();
      void navigateToScene(fallbackUrl);
    };

    let url = "";
    try {
      url = buildRepairH5Url(options);
    }
    catch (error) {
      logger.error("维修助理地址生成失败，降级本地壳页", error);
      fallback();
      return;
    }

    if (!isMpaasReady() || typeof location === "undefined") {
      // 浏览器 / PC 内嵌没有原生容器：直接走站内壳页
      fallback();
      return;
    }

    // pushWindow 成功时不保证回调，只有明确失败才降级，避免二次跳转
    await openWebview(url, fallback);
  }
  finally {
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

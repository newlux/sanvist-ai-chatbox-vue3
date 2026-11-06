import { REPORT_VOICE_OPTIONS } from "@/config/report-voices";
import { loadReportVoice } from "@/hooks/useReportVoice";
import { useSystemStore, useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { openWebview } from "@/utils/platform/mpaas";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";
import { navigateToScene } from "@/utils/scene-navigation";

const logger = createLogger("repair-h5");

/** 维修助手在本项目里的本地页（iframe 版），只在 pushWindow 不可用时作为降级 */
export const REPAIR_PAGE_ROUTE = "/pages/repair/index";

export interface RepairH5OpenOptions {
  /** AI 问答侧的会话 id（对话 navigation 卡片 / 听播页带过来） */
  sessionId?: string;
  /** AI 问答侧的会话 id（同上，按三方约定单独透传） */
  conversationId?: string;
  /** 维修助手详情页的会话 id，作为 `/chat/{id}` 路径参数 */
  chatConversationId?: string;
  /** 界面语言 zh_CN / en_US；不传时按 systemStore.header.Lang → uni.getLocale() 兜底 */
  language?: string;
}

/**
 * 当前选中的音色 id：读本机记忆的音色（听播页 saveReportVoice 写入的同一份数据），
 * 没选过时与听播页保持一致的兜底口径 —— 取音色列表第一项。
 */
export function resolveSelectedVoiceId() {
  return loadReportVoice()?.id || REPORT_VOICE_OPTIONS[0]?.id || "";
}

/**
 * 当前界面语言：优先取 systemStore.header.Lang（启动参数注入 + 设置弹层切换都会写这里），
 * 它是宿主与请求头共用的口径（zh_CN / en_US）；拿到前用 uni 的 locale 兜底。
 */
export function resolveSelectedLanguage(language?: string) {
  const explicit = String(language || "").trim();
  if (explicit) return explicit;
  const fromHeader = String(useSystemStore().header?.Lang || "").trim();
  if (fromHeader) return fromHeader;
  try {
    return String(uni.getLocale?.() || "zh_CN");
  }
  catch {
    return "zh_CN";
  }
}

/**
 * 拼维修助手三方 H5 的完整地址。
 *
 * 与 iframe 版（pages/repair/index.vue）用的是同一套参数口径，抽到这里
 * 是为了「pushWindow 直开三方页」和「本地 iframe 降级页」不会各写一份、慢慢漂移。
 */
export function buildRepairH5Url(options: RepairH5OpenOptions = {}): string {
  const userStore = useUserStore();
  const systemStore = useSystemStore();
  const result = buildSanvistH5Url({
    userId: "66",
    externalUserId: String(userStore.userId || "").trim() || undefined,
    name: String(userStore.username || "").trim() || undefined,
    sessionId: String(options.sessionId || "").trim() || undefined,
    conversationId: String(options.conversationId || "").trim() || undefined,
    chatConversationId: String(options.chatConversationId || "").trim() || undefined,
    // 外观：带具体生效值（light / dark），不再把 system 透给内嵌页
    theme: systemStore.appAppearance,
    // 音色：把选中的音色 id 原样带给内嵌页
    voice: resolveSelectedVoiceId(),
    // 界面语言：把选中的中英文值（zh_CN / en_US）以 language 参数带给内嵌页
    language: resolveSelectedLanguage(options.language),
  });
  logger.info("repair h5 url ready", result.payload);
  return result.url;
}

/**
 * 打开维修助手：mPaaS 容器里用 pushWindow 另开一个 WebView 直接加载三方页，
 * 这样三方页是顶层文档，容器会把 AlipayJSBridge 注入进去，原生能力可以直接调
 * （iframe 内嵌跨域拿不到 bridge，见 parts 页的 postMessage 代理方案）。
 *
 * pushWindow 成功不保证有回调，失败 / 无 bridge 时才降级到本地 iframe 页；
 * 降级前先执行 onFallback —— 调用方用它把导航上下文落盘（本地页要从 pending 里取）。
 */
export function openRepairAssistant(options: RepairH5OpenOptions = {}, onFallback?: () => void) {
  let url = "";
  try {
    url = buildRepairH5Url(options);
  }
  catch (error) {
    logger.error("failed to build repair h5 url", error);
  }

  const fallback = () => {
    onFallback?.();
    void navigateToScene(REPAIR_PAGE_ROUTE);
  };

  if (!url) {
    fallback();
    return;
  }
  void openWebview(url, fallback);
}

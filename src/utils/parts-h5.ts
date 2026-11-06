import { useSystemStore, useUserStore } from "@/stores";
import { createLogger } from "@/utils/logger";
import { resolveSelectedLanguage, resolveSelectedVoiceId } from "@/utils/repair-h5";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";

const logger = createLogger("parts-h5");

/** 配件助手在本项目里的本地页（iframe 版） */
export const PARTS_PAGE_ROUTE = "/pages/parts/index";

/**
 * 配件助手三方 H5：与维修助手同一套加密 / 参数口径，只是入口地址不同 ——
 * 它走 hash 路由（`#/agent`），参数全部留在 query 里。
 */
const PARTS_H5_FRONTEND = "https://seed.alexsun.top/dev/dist";
const PARTS_H5_HASH_PATH = "/agent";
/** 与维修助手（sanvist）区分开的来源标识，三方页据此判断是哪个入口进来的 */
const PARTS_H5_SOURCE = "pjzs-sanvist";

export interface PartsH5OpenOptions {
  /** AI 问答侧的会话 id（对话 navigation 卡片带过来） */
  sessionId?: string;
  /** AI 问答侧的会话 id（同上，按三方约定单独透传） */
  conversationId?: string;
  /** 配件助手侧的会话 id：hash 路由下没有 `/chat/{id}`，以 query 参数带给内嵌页 */
  chatConversationId?: string;
  /** 界面语言 zh_CN / en_US；不传时按 systemStore.header.Lang → uni.getLocale() 兜底 */
  language?: string;
}

/**
 * 拼配件助手三方 H5 的完整地址。
 *
 * 参数口径与维修助手（utils/repair-h5 的 buildRepairH5Url）完全一致：
 * userId / externalUserId / name / sessionId / conversationId / chatConversationId /
 * theme / voice / language，避免两条内嵌链路各写一份、慢慢漂移。
 */
export function buildPartsH5Url(options: PartsH5OpenOptions = {}): string {
  const userStore = useUserStore();
  const systemStore = useSystemStore();
  const result = buildSanvistH5Url({
    frontend: PARTS_H5_FRONTEND,
    hashPath: PARTS_H5_HASH_PATH,
    source: PARTS_H5_SOURCE,
    userId: "66",
    externalUserId: String(userStore.userId || "").trim() || undefined,
    name: String(userStore.username || "").trim() || undefined,
    sessionId: String(options.sessionId || "").trim() || undefined,
    conversationId: String(options.conversationId || "").trim() || undefined,
    chatConversationId: String(options.chatConversationId || "").trim() || undefined,
    // 外观：带具体生效值（light / dark），不把 system 透给内嵌页
    theme: systemStore.appAppearance,
    // 音色：把选中的音色 id 原样带给内嵌页
    voice: resolveSelectedVoiceId(),
    // 界面语言：把选中的中英文值（zh_CN / en_US）以 language 参数带给内嵌页
    language: resolveSelectedLanguage(options.language),
  });
  logger.info("parts h5 url ready", result.payload);
  return result.url;
}

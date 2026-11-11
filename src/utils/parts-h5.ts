/**
 * 配件助手（三方 H5 / seed.alexsun.top）入口：地址拼装 + pushWindow 直达。
 *
 * 与维修助理（utils/repair-h5）同一套打开方式与参数口径：加密身份、主题、音色、界面语言、
 * AI 问答上下文都一致，**只有内嵌地址不同**（见 config 的 PARTS_ASSISTANT_EMBED_URL，
 * 该地址自带 `?source=pjzs-sanvist#/agent`，参数会拼在 hash 之前、且不覆盖它已有的 source）。
 *
 * 配件侧额外要求带一组网关参数（固定 key，值来自本机身份）：
 * - `userId` / `companyId` / `organizationId`：用户信息 / 宿主启动参数；
 * - `access_token`：请求层当前生效的宿主 token（去掉 `bearer ` 前缀）；
 * - `gatewayHost`：固定网关地址（config 的 PARTS_ASSISTANT_GATEWAY_HOST）。
 *
 * - **首选（原生）**：`pushWindow` 直接开一个原生 WebView 加载三方 H5，没有 iframe 套壳。
 * - **兜底**：宿主没注入 bridge / pushWindow 失败时，退回本地壳页
 *   `/pages/parts/index?url=...`（该页 iframe 内嵌，并把 AlipayJSBridge 代理给内嵌页）。
 */
import { PARTS_ASSISTANT_EMBED_URL, PARTS_ASSISTANT_GATEWAY_HOST } from "@/config";
import { useSystemStore, useUserStore } from "@/stores";
import {
  resolveAccessToken,
  resolveCompanyId,
  resolveOrganizationId,
  resolveSelectedLanguage,
  resolveSelectedVoiceId,
  resolveUserId,
} from "@/utils/assistant-h5-params";
import { createLogger } from "@/utils/logger";
import { isMpaasReady, openWebview } from "@/utils/platform/mpaas";
import { buildSanvistH5Url } from "@/utils/sanvist-h5-encrypt";
import { navigateToScene } from "@/utils/scene-navigation";

const logger = createLogger("parts-h5");

/** 本地配件壳页（iframe 内嵌 + bridge 代理），只在 pushWindow 不可用 / 失败时兜底 */
const PARTS_SHELL_ROUTE = "/pages/parts/index";

export interface PartsH5UrlOptions {
  /** 覆盖内嵌地址：弹层里手填的地址 / 临时测试地址，缺省用 config 里的地址 */
  frontend?: string;
  /** 来源 SSE 的 sessionId（AI 问答上下文） */
  sessionId?: string;
  /** 来源 SSE 的 conversationId（AI 问答上下文） */
  conversationId?: string;
  /** 三方业务侧 userId 参数；配件侧没有约定值时留空，不硬塞维修专有的内部号 */
  userId?: string;
}

export interface OpenPartsAssistantOptions extends PartsH5UrlOptions {
  /** 等价于 `frontend`，配合调用方「地址」语义的写法（弹层 / 导航项传的都是地址） */
  url?: string;
  /** 降级回本地壳页前的钩子（需要落盘上下文的场景用） */
  onFallback?: () => void;
}

/**
 * 拼三方配件 H5 的完整地址（参数口径与维修助理一致，只有 frontend 不同）。
 * pushWindow 直达与本地壳页 iframe 共用这一处口径。
 */
export function buildPartsH5Url(options: PartsH5UrlOptions = {}) {
  const userStore = useUserStore();
  const systemStore = useSystemStore();
  const frontend = String(options.frontend || "").trim() || PARTS_ASSISTANT_EMBED_URL;
  return buildSanvistH5Url({
    frontend,
    // 配件侧的接入口径固定为 pjzs-sanvist；地址里已写死同值时以地址上的为准（见 composeUrl）
    source: "pjzs-sanvist",
    userId: String(options.userId || "").trim() || resolveUserId() || undefined,
    externalUserId: String(userStore.userId || "").trim() || undefined,
    name: String(userStore.username || "").trim() || undefined,
    sessionId: String(options.sessionId || "").trim() || undefined,
    conversationId: String(options.conversationId || "").trim() || undefined,
    // 公司 / 组织：取不到时由 buildSanvistH5Url 回落 sanvist 默认租户（69 / 2）
    companyId: resolveCompanyId() || undefined,
    organizationId: resolveOrganizationId() || undefined,
    // 外观：带具体生效值（light / dark）
    theme: systemStore.appAppearance,
    // 音色：把选中的音色 id 原样带给三方页
    voice: resolveSelectedVoiceId(),
    // 界面语言：中英文值（zh_CN / en_US）以 language 参数带给三方页
    language: resolveSelectedLanguage(),
    // 配件三方页回连网关所需：固定地址 + 宿主当前 token
    extraParams: {
      gatewayHost: PARTS_ASSISTANT_GATEWAY_HOST,
      access_token: resolveAccessToken(),
    },
  }).url;
}

/** 防止连续点击在 bridge 等待 / 原生转场期间重复开窗 */
let opening = false;

/**
 * 打开配件助手：pushWindow 直达三方 H5，失败才降级回本地壳页。
 */
export async function openPartsAssistant(options: OpenPartsAssistantOptions = {}) {
  if (opening) return;
  opening = true;

  const { onFallback, url } = options;
  const embedUrl = String(url || options.frontend || "").trim() || PARTS_ASSISTANT_EMBED_URL;
  try {
    let target = embedUrl;
    try {
      target = buildPartsH5Url({
        frontend: embedUrl,
        sessionId: options.sessionId,
        conversationId: options.conversationId,
        userId: options.userId,
      });
    }
    catch (error) {
      // 加密参数生成失败也照开：配件地址自带 source，三方侧自己能兜
      logger.error("配件助手参数生成失败，按原地址打开", error);
    }

    const fallback = () => {
      onFallback?.();
      void navigateToScene(`${PARTS_SHELL_ROUTE}?url=${encodeURIComponent(target)}`);
    };

    if (!isMpaasReady() || typeof location === "undefined") {
      // 浏览器 / PC 内嵌没有原生容器：直接走站内壳页
      fallback();
      return;
    }

    // pushWindow 成功时不保证回调，只有明确失败才降级，避免二次跳转
    await openWebview(target, fallback);
  }
  finally {
    setTimeout(() => {
      opening = false;
    }, 600);
  }
}

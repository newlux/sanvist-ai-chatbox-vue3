export const AI_ASK_WELCOME_DONE_KEY = "ai_ask_welcome_done";
export const LISTEN_REPORT_DATE_KEY = "ai-ask-listen-report-date";

// 访客角色选项预取缓存（进入角色选择页前提前拉取，避免页面加载闪动）
export const VISITOR_ROLE_OPTIONS_CACHE_KEY = "visitor_role_options_cache";

/**
 * COS 预签名下载服务的基地址。
 * 与主对话 API（VITE_AI_QUESTION_BASE_URL）不同域、不同前缀，因此独立配置，
 * 不复用 request 的全局 baseURL。
 * 需要切换环境时用环境变量 VITE_COS_PRESIGNED_BASE_URL 覆盖即可。
 */
export const COS_PRESIGNED_BASE_URL = String(
  import.meta.env.VITE_COS_PRESIGNED_BASE_URL || "https://sanvist-api-test.sany.com.cn/hfle",
).replace(/\/$/, "");

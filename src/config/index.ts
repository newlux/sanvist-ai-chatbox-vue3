export const AI_ASK_WELCOME_DONE_KEY = "ai_ask_welcome_done";
export const LISTEN_REPORT_DATE_KEY = "ai-ask-listen-report-date";
export const LISTEN_REPORT_CURRENT_DATE_KEY = "ai-ask-listen-report-current-date";
/** <WORK_REPORT language="…"> 下发的播报语言，随日期一起带进播报页 */
export const LISTEN_REPORT_LANGUAGE_KEY = "ai-ask-listen-report-language";

// 访客角色选项预取缓存（进入角色选择页前提前拉取，避免页面加载闪动）
export const VISITOR_ROLE_OPTIONS_CACHE_KEY = "visitor_role_options_cache";
export const VISITOR_ROLE_CACHE_KEY = "visitor_role";
// 任务协同初始化页选中的身份（/flow/steps?module=TASK 的 IDENTITY 选项，如 DISPATCH-02）
export const TASK_IDENTITY_CACHE_KEY = "task_identity";

/**
 * 维修助手跳转（COMPONENT type=navigation，target=maintenance_assistant）的 intent 取值：
 * - MAINT_FAULT_CODE：故障码场景，先弹「是否进入维修助手」确认卡，点确定只把确认发回对话；
 * - ENTER_ASSISTANT：后端已确认进入，直接跳维修助手页（不再出确认卡）。
 */
export const REPAIR_NAV_INTENT_FAULT_CODE = "MAINT_FAULT_CODE";
export const REPAIR_NAV_INTENT_ENTER = "ENTER_ASSISTANT";

/**
 * 配件助手内嵌的三方 H5 地址。
 * 与维修助手保持一致：入口另开独立场景页 `/pages/parts/index`（不在首页内联），
 * 由该页全屏 iframe 加载这个地址，并把 AlipayJSBridge 代理给内嵌页。
 * 地址含 query 与 hash，作为 `?url=` 传参时必须整体 encodeURIComponent。
 */
export const PARTS_ASSISTANT_EMBED_URL = "https://seed.alexsun.top/dev/dist/?source=pjzs-sanvist#/agent";

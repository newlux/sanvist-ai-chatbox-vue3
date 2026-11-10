export const AI_ASK_WELCOME_DONE_KEY = "ai_ask_welcome_done";
export const LISTEN_REPORT_DATE_KEY = "ai-ask-listen-report-date";
export const LISTEN_REPORT_CURRENT_DATE_KEY = "ai-ask-listen-report-current-date";
/** <WORK_REPORT language="…"> 下发的播报语言，随日期一起带进播报页 */
export const LISTEN_REPORT_LANGUAGE_KEY = "ai-ask-listen-report-language";

/**
 * 语音播报总开关（顶部头部的喇叭按钮）：只管「回答边出边自动播报」，
 * 不影响气泡里手动点的播报按钮。本机偏好，存 "1" 开 / "0" 关，缺省按开。
 */
export const AUTO_TTS_ENABLED_KEY = "ai-ask-auto-tts-enabled";

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
 * 配件助手三方 H5 地址（与维修助手同一套打开方式，只有地址不同）。
 *
 * - 首选：`utils/parts-h5` 用 pushWindow 直达这个地址，参数口径与维修助手一致；
 * - 兜底：原生容器不可用时落到本地壳页 `/pages/parts/index?url=...`，
 *   由该页 iframe 加载同一地址，并把 AlipayJSBridge 代理给内嵌页。
 *
 * 地址自带 query 与 hash：参数会被拼到 hash 之前，已写死的 `source` 不会被覆盖；
 * 走 `?url=` 传参时必须整体 encodeURIComponent。
 */
export const PARTS_ASSISTANT_EMBED_URL = "https://seed.alexsun.top/dev/dist/?source=pjzs-sanvist#/agent";

/**
 * 配件助手三方页回连的网关地址（`gatewayHost` 参数，固定值）。
 *
 * 三方页用它自己去调 sanvist 的接口，不跟本工程的 `VITE_AI_QUESTION_BASE_URL` 联动 ——
 * 换环境（测试 / 正式）时需要同时改这里。
 */
export const PARTS_ASSISTANT_GATEWAY_HOST = "https://sanvist-api-test.sany.com.cn";

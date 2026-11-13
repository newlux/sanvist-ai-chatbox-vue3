/**
 * 任务协同助手 · 车载端消息推送配置（协议 `sanvist.push/1`）。
 *
 * 依据《任务协同助手-车载端MQTT服务器-通信协议规范V2.0》：
 * - 第 2 节：WebSocket + TLS 入口 `wss://mqtt-dev.etripon.com:8084/mqtt`；
 * - 第 3 节：Client ID / 用户名均等于车载设备号，口令由服务方线下交付；
 * - 第 4 节：QoS 1、Keep Alive 30s、Clean Start = false（持久会话 24h）；
 * - 第 6 节：HTTPS 补漏 / 回执接口。
 *
 * 这里的账号是服务方给的联调账号（车载端网页版），换成正式设备号时只改这一个文件。
 * 口令是共享凭据，不属于用户隐私，不做额外加密，但也不要打进对外分发的日志里。
 */

/** MQTT over WebSocket + TLS（车辆网络访问不到 8883 时走这条） */
export const PUSH_BROKER_URL = "wss://mqtt-dev.etripon.com:8084/mqtt";

/** 车载设备号：同时用作 MQTT Client ID 与用户名（协议 3.x 要求三者一致） */
export const PUSH_DEVICE_NO = "SIM-BOSS-SCREEN";

export const PUSH_USERNAME = "SIM-BOSS-SCREEN";
export const PUSH_PASSWORD = "gM1A7UWLPOIYOclmMQVkrEP6";

/** 协议版本标识：不以它开头的消息不属于本协议（协议 5.2） */
export const PUSH_SCHEMA_PREFIX = "sanvist.push/1";

/** 一期唯一的通知类型：任务下发 */
export const PUSH_KIND_TASK_DISPATCH = "task_dispatch";

/** Keep Alive 30 秒（协议 4.1） */
export const PUSH_KEEPALIVE_SECONDS = 30;
/** 持久会话有效期 24 小时（协议 4.1） */
export const PUSH_SESSION_EXPIRY_SECONDS = 86400;
/** 建连超时：WebSocket 握手 + CONNACK，车载网络偏慢，给到 15s */
export const PUSH_CONNECT_TIMEOUT_MS = 15000;

/** 断线重连退避：3s 起，翻倍，最长 60s */
export const PUSH_RECONNECT_MIN_DELAY_MS = 3000;
export const PUSH_RECONNECT_MAX_DELAY_MS = 60000;
/** 认证失败（0x86 / 0x87）不得高频重连，间隔不短于 5 分钟（协议 4.2） */
export const PUSH_AUTH_FAIL_DELAY_MS = 5 * 60 * 1000;

/** HTTP 接口基址（协议 2.x） */
export const PUSH_HTTP_BASE_URL = "https://sanvist-api-dev.etripon.com/sanvist-ai-api";
/** 补漏 / 回执接口超时 */
export const PUSH_HTTP_TIMEOUT_MS = 10000;
/**
 * 是否启用 HTTP 补漏与送达回执。
 *
 * 协议 0.x 第 3、5 步要求「每次连上后补一次漏、交给消息中心后报 delivered」。
 * 联调阶段接口可能被网关挡掉（跨域 / 未开通），失败只记日志、不阻断 MQTT 主通道，
 * 需要纯前端演示时把它改成 false 即可。
 */
export const PUSH_HTTP_SUPPLEMENT_ENABLED = true;

/** 订阅主题：`sanvist/v1/vehicle/{device_no}/dn/#`（协议 0.x 第 2 步 / 4.3） */
export function pushTopicOf(deviceNo: string = PUSH_DEVICE_NO) {
  return `sanvist/v1/vehicle/${deviceNo}/dn/#`;
}

/** 一期唯一的业务主题（协议 4.3），排障时可先只订它 */
export function pushTaskTopicOf(deviceNo: string = PUSH_DEVICE_NO) {
  return `sanvist/v1/vehicle/${deviceNo}/dn/task`;
}

/** 页面内最多保留多少条历史通知（本地存储同此上限，只存文本，不存任务明细） */
export const PUSH_MAX_NOTICES = 30;
/** 判重用的 msg_id 环形队列长度（QoS 1 会重复投递，协议 4.4） */
export const PUSH_MAX_SEEN_IDS = 200;
/** 补漏接口单页条数（协议 6.3：1～100） */
export const PUSH_INBOX_PAGE_SIZE = 50;
/** 补漏接口最多连续翻多少页，防止服务端 has_more 异常时死循环 */
export const PUSH_INBOX_MAX_PAGES = 5;

/** 本地存储 key */
export const PUSH_STORAGE_KEY_INBOX = "push-inbox-v1";
export const PUSH_STORAGE_KEY_SEEN = "push-seen-ids-v1";
export const PUSH_STORAGE_KEY_CURSOR = "push-outbox-cursor-v1";

/** 点「查看详情」后打开的对话页（任务协同场景） */
export const PUSH_CONVERSATION_PAGE = "/pages/task/index";

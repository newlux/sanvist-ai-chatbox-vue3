import type { PushSoundResult } from "@/utils/push/push-sound";
import type { PushConnectionState, PushMessageRecord, TaskDispatchPush } from "@/utils/push/types";
import { computed, getCurrentInstance, onUnmounted, ref } from "vue";
import {
  PUSH_BROKER_URL,
  PUSH_CONVERSATION_PAGE,
  PUSH_DEVICE_NO,
  PUSH_HTTP_SUPPLEMENT_ENABLED,
  PUSH_INBOX_MAX_PAGES,
  PUSH_INBOX_PAGE_SIZE,
  PUSH_PASSWORD,
  PUSH_USERNAME,
  pushTopicOf,
} from "@/config/push";
import { createLogger } from "@/utils/logger";
import { MqttPushClient } from "@/utils/push/mqtt-push-client";
import { ackPushDelivered, fetchPushInbox } from "@/utils/push/push-http";
import { clearPushInbox, getInbox, getOutboxCursor, hasSeenPush, markPushRead, rememberPush, setOutboxCursor } from "@/utils/push/push-inbox";
import { parseTaskDispatchPush, pushActionOf } from "@/utils/push/push-payload";
import { disposePushNoticeSound, playPushNoticeSound } from "@/utils/push/push-sound";
import { stashPendingScheduleAsk } from "@/utils/schedule-ask";

const logger = createLogger("push-notification");

export interface UsePushNotificationOptions {
  /** 车载设备号：同时是 Client ID / 用户名 / 订阅主题里的 {device_no} */
  deviceNo?: string;
  /** 是否在创建时自动连接（默认 true；离页面即断开） */
  autoStart?: boolean;
  /** 是否使用 HTTP 补漏与送达回执 */
  enableHttpSupplement?: boolean;
  /** 收到新通知时是否播放提示音（src/assets/task-notice 里随机一段） */
  playSound?: boolean;
}

/**
 * 消息推送（任务下发通知）的组合式封装。
 *
 * 覆盖协议 0.x 的接入步骤：
 * 1. TLS 连接 + 订阅 `sanvist/v1/vehicle/{device_no}/dn/#`（QoS 1）；
 * 2. 每次连上后调一次补漏接口，把离线期间错过的通知拉回来；
 * 3. 按 `msg_id` 去重后进「消息中心」（这里的收件箱就是消息中心）；
 * 4. 收到后报 `delivered` 回执（可选通道，失败只记日志）；
 * 5. 用户点「查看详情」时新开任务协同会话，把 `action.prompt` 原样作为首条消息发出。
 */
export function usePushNotification(options: UsePushNotificationOptions = {}) {
  const deviceNo = options.deviceNo || PUSH_DEVICE_NO;
  const httpEnabled = options.enableHttpSupplement ?? PUSH_HTTP_SUPPLEMENT_ENABLED;
  const soundEnabled = options.playSound !== false;

  /** 链路状态：idle / connecting / connected / reconnecting / unauthorized / failed */
  const state = ref<PushConnectionState>("idle");
  /** 状态补充说明（认证失败原因、订阅被拒等），空串不展示 */
  const stateDetail = ref("");
  /** 收件箱（新 → 旧），首屏直接读本地存储，进页面就能看到历史通知 */
  const notices = ref<PushMessageRecord[]>(getInbox());
  /** 是否处于「已启动」状态（连接中 / 已连接 / 等待重连都算） */
  const running = ref(false);
  /** 补漏接口进行中 */
  const syncing = ref(false);
  const soundIssue = ref<"blocked" | "failed" | null>(null);

  const unreadCount = computed(() => notices.value.filter(item => !item.read).length);
  const connected = computed(() => state.value === "connected");

  let client: MqttPushClient | null = null;

  async function playNoticeSound(fromGesture = false): Promise<PushSoundResult> {
    const result = await playPushNoticeSound(fromGesture);
    if (result !== "superseded") {
      soundIssue.value = result === "played" ? null : result;
    }
    return result;
  }

  /**
   * 收下一条原始报文（MQTT 与补漏接口共用这条路径）。
   *
   * @param raw UTF-8 JSON 字符串或已解析对象
   * @param source 来源，仅用于日志排障
   */
  function receive(raw: unknown, source: "mqtt" | "http") {
    const payload = parseTaskDispatchPush(raw);
    if (!payload) {
      logger.warn("忽略不属于 sanvist.push/1 的消息", source);
      return;
    }

    // 协议 3.x：每个账号只会收到自己设备号下的通知，这里再兜一层，防止主题配错
    const target = String(payload.terminal?.device_no || "");
    if (target && target !== deviceNo) {
      logger.warn("消息不属于本机，忽略", { target, deviceNo, source });
      return;
    }

    // 协议 4.4：QoS 1 会重复投递，必须按 msg_id 判重
    if (hasSeenPush(payload.msg_id)) {
      logger.debug("重复通知，已忽略", payload.msg_id);
      return;
    }

    const record: PushMessageRecord = {
      msgId: payload.msg_id,
      receivedAt: Date.now(),
      payload,
      read: false,
    };
    if (!rememberPush(record)) return;

    notices.value = getInbox();
    logger.info("收到新通知", { msgId: payload.msg_id, kind: payload.kind });
    // 面板展示所有成功入库的通知，提示音与展示使用同一条件。
    if (soundEnabled) void playNoticeSound();

    // 协议 6.4：交给消息中心后报 delivered（可选通道，失败不影响展示）
    if (httpEnabled) void ackPushDelivered(payload.msg_id);
  }

  /**
   * 补取离线期间的通知（协议 6.3）。
   * 每次连上都会跑一次；结果可能包含已通过 MQTT 收到的消息，交给 receive 判重即可。
   */
  async function syncInbox() {
    const syncingClient = client;
    if (!syncingClient || !httpEnabled || syncing.value) return;
    syncing.value = true;
    try {
      let cursor = getOutboxCursor();
      for (let page = 0; page < PUSH_INBOX_MAX_PAGES; page += 1) {
        const data = await fetchPushInbox(cursor, PUSH_INBOX_PAGE_SIZE);
        if (client !== syncingClient || !data || !Array.isArray(data.items)) return;
        data.items.forEach(item => receive(item?.payload ?? item, "http"));

        const next = Number(data.next_since_id);
        if (Number.isFinite(next) && next > cursor) {
          cursor = next;
          setOutboxCursor(next);
        }
        if (!data.has_more) return;
      }
    }
    finally {
      if (client === syncingClient) syncing.value = false;
    }
  }

  function start() {
    if (client) return;
    running.value = true;
    client = new MqttPushClient({
      url: PUSH_BROKER_URL,
      clientId: deviceNo,
      username: PUSH_USERNAME,
      password: PUSH_PASSWORD,
      topic: pushTopicOf(deviceNo),
      onMessage(topic, payload) {
        logger.debug("收到 MQTT 消息", topic);
        receive(payload, "mqtt");
      },
      onStateChange(next, detail) {
        state.value = next;
        stateDetail.value = detail;
      },
      onReady() {
        // 协议 0.x 第 3 步：每次连上后补一次漏
        void syncInbox();
      },
    });
    client.start();
  }

  function stop() {
    client?.stop();
    client = null;
    syncing.value = false;
    running.value = false;
    state.value = "idle";
    stateDetail.value = "";
  }

  /** 主动重连（认证失败 / 手动点「连接」时用） */
  function restart() {
    stop();
    start();
  }

  function toggle() {
    if (running.value) stop();
    else start();
  }

  /** 标记某条通知已读（点卡片或点「查看详情」时调用） */
  function markRead(msgId: string) {
    markPushRead(msgId);
    notices.value = getInbox();
  }

  /** 清空收件箱（只清列表，判重表保留，避免重投消息又弹一遍） */
  function clear() {
    clearPushInbox();
    notices.value = [];
  }

  /**
   * 执行通知的关联动作（协议 5.3）：新开任务协同会话，首条消息为 `action.prompt`。
   *
   * `prompt` 末尾带机器标记 `[push:<派发记录编号>]`，服务方靠它定位任务，所以必须原样使用。
   * 跳转沿用项目既有通路：先把文本写本地存储，任务对话页 onShow 取走并自动发送
   * （见 utils/schedule-ask）——对话页可能是已存在的实例，query 参数不会再解析一次。
   */
  function openDetail(payload: TaskDispatchPush | null) {
    const action = pushActionOf(payload);
    if (!payload || !action) {
      logger.warn("该通知没有可执行的关联动作", payload?.msg_id);
      return false;
    }

    markRead(payload.msg_id);
    if (action.auto_send !== false) stashPendingScheduleAsk(action.prompt);

    const go = (mode: "navigateTo" | "redirectTo") => {
      uni[mode]({
        url: PUSH_CONVERSATION_PAGE,
        fail: () => {
          if (mode === "navigateTo") go("redirectTo");
        },
      });
    };
    go("navigateTo");
    return true;
  }

  if (options.autoStart !== false) start();
  if (getCurrentInstance()) {
    onUnmounted(() => {
      stop();
      // 释放音频通道，避免离开页面后播放器还挂在后台
      disposePushNoticeSound();
    });
  }

  return {
    /** 车载设备号（面板展示用） */
    deviceNo,
    state,
    stateDetail,
    notices,
    running,
    syncing,
    unreadCount,
    connected,
    soundIssue,
    playNoticeSound,
    start,
    stop,
    restart,
    toggle,
    markRead,
    clear,
    openDetail,
    syncInbox,
  };
}

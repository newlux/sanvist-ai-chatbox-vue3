/**
 * 任务协同助手推送协议 `sanvist.push/1` 的类型定义。
 *
 * 字段口径完全对齐协议文档第 5 节；5.5 的兼容规则（未定义字段忽略、只增不删）
 * 用索引签名兜住，避免服务方加字段时前端类型报错。
 */

/** 通知对象（执行人） */
export interface PushRecipient {
  person_id: string;
  name: string;
  role: string;
}

/** 目标车载终端 */
export interface PushTerminal {
  device_no: string;
  vehicle_id: string;
  plate_no: string;
}

/** 通知内容 */
export interface PushNotice {
  title: string;
  /** 通知正文，模板固定（协议 5.6） */
  text: string;
  /** 适合语音播报的正文 */
  tts?: string;
}

/** 关联业务对象（协议 5.4），仅代表通知生成那一刻的关联关系 */
export interface PushRef {
  dispatch_record_id: string;
  plan_id: string;
  task_ids: string[];
  task_count: number;
}

/** 关联动作（协议 5.3） */
export interface PushAction {
  /** 一期固定 `open_conversation`；未定义类型视为没有可执行动作 */
  type: string;
  /** 动作显示名称，如「查看详情」 */
  label: string;
  /** 一期固定 `TASK` */
  scene: string;
  new_conversation: boolean;
  auto_send: boolean;
  /** 对话首条消息，末尾带机器标记 `[push:<派发记录编号>]`，必须原样使用 */
  prompt: string;
  inputs: Record<string, unknown>;
}

/** 投递追踪信息 */
export interface PushTrace {
  /** 服务端投递序号，与补漏接口的 outbox_id 同源、单调递增 */
  outbox_id: number;
}

/** `variant`：first = 该执行人该业务日期首次收到任务；append = 同日新增任务 */
export type PushVariant = "first" | "append";

/** 一期唯一的业务消息：任务下发通知 */
export interface TaskDispatchPush {
  schema: string;
  msg_id: string;
  kind: string;
  variant: PushVariant | string;
  created_at: string;
  expires_at: string;
  priority: string;
  recipient: PushRecipient;
  terminal: PushTerminal;
  business_date: string;
  notice: PushNotice;
  ref: PushRef;
  action: PushAction;
  trace: PushTrace;
  /** 协议 5.5：服务方只会新增字段，接收方必须忽略未知字段 */
  [key: string]: unknown;
}

/** 链路状态（面板文案按它渲染） */
export type PushConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  /** 认证失败 / 订阅被拒：按协议 4.2 退避 5 分钟后再试 */
  | "unauthorized"
  | "failed";

/** 面板里一条已接收的通知（不含任务明细，只存协议原文 + 落库时间） */
export interface PushMessageRecord {
  msgId: string;
  /** 本地收到的时间戳（毫秒） */
  receivedAt: number;
  payload: TaskDispatchPush;
  read: boolean;
}

/** 补漏接口单条（协议 6.3） */
export interface PushInboxItem {
  outbox_id: number;
  msg_id: string;
  /** 与 MQTT 收到的消息逐字段相同 */
  payload: TaskDispatchPush;
}

/** 补漏接口响应 data（协议 6.3） */
export interface PushInboxPage {
  items: PushInboxItem[];
  next_since_id: number;
  has_more: boolean;
}

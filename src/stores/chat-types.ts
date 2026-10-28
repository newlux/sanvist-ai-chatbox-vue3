import type { Identifier } from "@/api/chat/types";
import type { AiBlock } from "@/utils/ai-stream";

export type ChatRole = "user" | "ai";

/** Dify 工作流节点/工作流结束事件驱动的回答过程标题。 */
export interface ChatProcessStatus {
  phase: "thinking" | "succeeded" | "failed" | "stopped";
  title?: string;
  /** 工作流结束时由 `workflow_finished.data.elapsed_time` 提供，单位秒。 */
  elapsedSeconds?: number;
}

/** 用户消息里随行展示的附件 */
export interface ChatMessageAttachment {
  /** 上传接口返回的 Dify 文件 id：仅历史图片展示时走 GET /files/{file_id}/preview */
  fileId?: string;
  url: string;
  /** 本次选择附件的本地临时路径；新消息优先使用它展示，历史消息没有该字段。 */
  localPath?: string;
  /** 可内联预览地址：COS 预签名 URL 或 blob 兜底地址，优先于 url 展示 */
  previewPath?: string;
  name: string;
  /** image / audio / video / document */
  type: string;
  size?: number;
  mimeType?: string;
}

export interface UiChatMessage {
  id?: string;
  role: ChatRole;
  content?: string;
  blocks?: AiBlock[];
  loading?: boolean;
  interrupted?: boolean;
  sessionId?: Identifier | null;
  conversationId?: Identifier | null;
  messageId?: Identifier | null;
  /** Dify task_id，用于停止当前生成任务。 */
  taskId?: Identifier | null;
  waitingText?: string;
  durationMs?: number | null;
  processStatus?: ChatProcessStatus | null;
  /** SANVIST 自定义状态事件的当前子标题。 */
  processSubtitle?: string | null;
  positive?: boolean | null;
  feedbackValue?: string;
  feedbackRemark?: string;
  ttsEnabled?: boolean;
  /** 新生成消息实时播放，历史加载消息播放整段语音。 */
  ttsPlaybackMode?: "realtime" | "history";
  ttsLoading?: boolean;
  /** 语音播放中（整段 /chat/tts 或流式 /speech/tts/v2/stream/Users/liuyy/Library/Application Support/LarkShell-ka-sasysa542/sdk_storage/5daf88797dd462895dc04bb11feb6a2e/resources/images/img_v3_0216n_77be5a3f-71c4-4ff8-a529-30231a5852bg.jpg，二者互斥） */
  ttsPlaying?: boolean;
  rawSseText?: string;
  attachments?: ChatMessageAttachment[];
  noAnswerGroup?: boolean;
  /** 二维码占位回答：已跳转二维码页，消息列表不再渲染这条 AI 消息 */
  hidden?: boolean;
  /** 只展示卡片、不挂回答操作栏（任务协同的初始化卡片消息） */
  hideActions?: boolean;
  /** 语音已松手、ASR 尚未返回：用户气泡展示「识别中...」 */
  asrPending?: boolean;
  /** 维修助手回流产生的 QA 卡片标题。 */
  assistantCallbackTitle?: string;
  /** 维修助手回流卡片副标题：带 status 的是故障诊断，没有的是快问快答。 */
  assistantCallbackStatus?: string;
  /** 维修助手诊断摘要卡片中的设备、问题、结论和处理信息。 */
  assistantCallbackDetails?: Array<{ label: string; value: string }>;
  /** 维修助手侧会话 ID，有值时摘要卡可打开对应的诊断详情。 */
  assistantCallbackConversationId?: string;
}

export interface ShareRound {
  userIndex: number;
  aiIndex: number;
  interrupted: boolean;
  selectableIndexes: number[];
}

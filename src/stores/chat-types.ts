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
  url: string;
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
  positive?: boolean | null;
  feedbackValue?: string;
  feedbackRemark?: string;
  ttsEnabled?: boolean;
  /** 新生成消息实时播放，历史加载消息播放整段语音。 */
  ttsPlaybackMode?: "realtime" | "history";
  ttsLoading?: boolean;
  /** 语音播放中（整段 /chat/tts 或流式 /speech/tts/stream，二者互斥） */
  ttsPlaying?: boolean;
  rawSseText?: string;
  attachments?: ChatMessageAttachment[];
  noAnswerGroup?: boolean;
  /** 语音已松手、ASR 尚未返回：用户气泡展示「识别中...」 */
  asrPending?: boolean;
}

export interface ShareRound {
  userIndex: number;
  aiIndex: number;
  interrupted: boolean;
  selectableIndexes: number[];
}

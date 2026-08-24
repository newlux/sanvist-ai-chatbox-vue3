import type { Identifier } from "@/api/chat/types";
import type { AiBlock } from "@/utils/ai-stream";

export type ChatRole = "user" | "ai";

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
  waitingText?: string;
  durationMs?: number | null;
  positive?: boolean | null;
  feedbackValue?: string;
  feedbackRemark?: string;
  ttsEnabled?: boolean;
  ttsLoading?: boolean;
  /** 语音播放中（整段 /chat/tts 或流式 /speech/tts/stream，二者互斥） */
  ttsPlaying?: boolean;
  rawSseText?: string;
  attachments?: ChatMessageAttachment[];
}

export interface ShareRound {
  userIndex: number;
  aiIndex: number;
  interrupted: boolean;
  selectableIndexes: number[];
}

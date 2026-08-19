import type { Identifier } from "@/api/chat/types";
import type { AiBlock } from "@/utils/ai-stream";

export type ChatRole = "user" | "ai";

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
  rawSseText?: string;
}

export interface ShareRound {
  userIndex: number;
  aiIndex: number;
  interrupted: boolean;
  selectableIndexes: number[];
}

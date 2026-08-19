export type Identifier = string | number;

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface DeviceInfo {
  deviceId: string;
  deviceModel?: string;
}

export interface ChatInput extends Record<string, unknown> {
  channel?: string;
  deviceList?: DeviceInfo[];
}

export interface ChatFile {
  type: string;
  transferMethod: "remote_url";
  url: string;
}

export interface SendChatMessageParams {
  query: string;
  user?: string;
  conversationId: Identifier | null;
  language?: string;
  responseMode?: "streaming";
  inputs?: ChatInput;
  files?: ChatFile[];
}

export interface MessageStartEvent {
  event: "message_start";
  conversationId: Identifier;
  messageId: Identifier;
}

export interface StatusEvent {
  event: "status";
  conversationId: Identifier;
  messageId: Identifier;
  data: {
    stage?: string;
    phase?: string;
    node?: string;
    call_id?: string;
    duration_ms?: number;
    tool_name?: string;
    message: string;
  };
}

export interface ThinkEvent {
  event: "think";
  conversationId: Identifier;
  messageId: Identifier;
  data: Record<string, unknown>;
}

export interface ToolCallEvent {
  event: "tool_call";
  conversationId: Identifier;
  messageId: Identifier;
  data: {
    name: string;
    args: Record<string, unknown>;
    call_id?: string;
  };
}

export interface MessageEvent {
  event: "message";
  conversationId: Identifier;
  messageId: Identifier;
  answer: string;
}

export interface RichContentEvent {
  event: "suggestion" | "table" | "chart" | "metric";
  conversationId: Identifier;
  messageId: Identifier;
  data: Record<string, unknown>;
}

export interface MessageEndEvent {
  event: "message_end";
  conversationId: Identifier;
  messageId: Identifier;
  metadata: {
    is_end: boolean;
    status: "succeeded" | "stopped" | "failed";
    reason: "normal" | "interrupt" | "timeout" | "exception";
    duration_ms: number | null;
    message?: string | null;
    trace_id?: string;
    timing?: Record<string, number>;
  };
}

export type ChatStreamEvent =
  | MessageStartEvent
  | StatusEvent
  | ThinkEvent
  | ToolCallEvent
  | MessageEvent
  | RichContentEvent
  | MessageEndEvent;

export interface ListConversationsParams {
  user?: string;
  lastId?: Identifier;
  limit?: number;
  sortBy?: "created_at_asc" | "created_at_desc" | "updated_at_asc" | "updated_at_desc";
}

export interface Conversation {
  id: Identifier;
  name: string;
  inputs: Record<string, unknown>;
  status: string;
  introduction: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationDetail extends Omit<Conversation, "inputs"> {}

export interface CursorPage<T> {
  limit: number;
  hasMore: boolean;
  data: T[];
}

export interface GetConversationParams {
  user?: string;
}

export interface DeleteConversationParams {
  user?: string;
}

export interface ListMessagesParams {
  conversationId: Identifier;
  user?: string;
  firstId?: Identifier;
  limit?: number;
}

export interface GetMessageParams {
  conversationId: Identifier;
  user?: string;
}

export interface MessageFile extends Record<string, unknown> {
  url?: string;
}

export interface Feedback {
  rating: "like" | "dislike";
  content: string | null;
}

export interface ChatMessage {
  id: Identifier;
  conversationId: Identifier;
  inputs: Record<string, unknown>;
  query: string;
  answer: string;
  messageFiles: MessageFile[];
  feedback: Feedback | null;
  retrieverResources: Record<string, unknown>[];
  createdAt: number;
}

export interface GetFeedbackParams {
  conversationId: Identifier;
  user?: string;
}

export interface SubmitFeedbackParams extends GetFeedbackParams {
  messageId: Identifier;
  rating: Feedback["rating"];
  content?: string;
}

export interface CancelFeedbackParams extends GetFeedbackParams {
  messageId: Identifier;
}

export interface UploadedFile {
  fileId: string;
  name: string;
  size: number;
  extension: string;
  mimeType: string;
  createdBy: string;
  createdAt: number;
  url: string;
}

export interface UploadFileParams {
  filePath: string;
  name?: string;
  user?: string;
}

export interface SpeechRecognitionResult {
  text: string;
  language: string;
}

export interface RecognizeSpeechByUrlParams {
  audioUrl: string;
  language?: string;
}

export interface RecognizeSpeechByBase64Params {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}

export interface RecognizeSpeechByUploadParams {
  filePath: string;
  name?: string;
  language?: string;
}

export interface AudioBase64Result {
  audioUrl: string;
  audioBase64: string;
  mimeType: string;
  dataUrl: string;
  fileName: string;
  size: number;
}

export interface CreateAudioBase64Params {
  audioUrl: string;
}

export interface TextToSpeechResult {
  format: string;
  audioBase64: string;
  dataUrl?: string;
}

export interface GetTextToSpeechResult {
  audioBase64: string;
  format: string;
}

export interface InterruptChatParams {
  conversationId: Identifier;
  messageId: Identifier;
}

export type Identifier = string | number;

export interface DeviceInfo {
  deviceId: string;
  deviceModel?: string;
}

export interface ChatInput extends Record<string, unknown> {
  channel?: string;
  deviceList?: DeviceInfo[];
}

interface RemoteChatFile {
  type: string;
  transferMethod: "remote_url";
  url: string;
}

interface LocalChatFile {
  type: string;
  transferMethod: "local_file";
  uploadFileId: string;
}

/** Dify files 参数：上传文件传 upload_file_id，外部资源才传 url。 */
export type ChatFile = LocalChatFile | RemoteChatFile;

export type ChatResponseMode = "streaming" | "blocking";

export interface SendChatMessageParams {
  query: string;
  user?: string;
  conversationId: Identifier | null;
  language?: string;
  inputs?: ChatInput;
  files?: ChatFile[];
  responseMode?: ChatResponseMode;
}

/** Dify blocking 模式的完整回答。 */
export interface BlockingChatMessageResponse {
  answer: string;
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
  metadata?: {
    elapsedTime?: number;
  };
}

export interface MessageStartEvent {
  event: "message_start";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
}

export interface StatusEvent {
  event: "status";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
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
  taskId?: Identifier;
  data: Record<string, unknown>;
}

export interface ToolCallEvent {
  event: "tool_call";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
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
  taskId?: Identifier;
  answer: string;
  /** Dify 的 message_replace 和 Agent 收尾 message 均为完整内容。 */
  replace?: boolean;
}

/** SANVIST 自定义流事件中的执行说明，只展示当前一条。 */
export interface SubtitleEvent {
  event: "subtitle";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
  message: string;
}

export interface RichContentEvent {
  event: "suggestion" | "table" | "chart" | "metric" | "image" | "video" | "source";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
  data: Record<string, unknown>;
}

export interface MessageEndEvent {
  event: "message_end";
  conversationId: Identifier;
  messageId: Identifier;
  taskId?: Identifier;
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
  | SubtitleEvent
  | RichContentEvent
  | MessageEndEvent;

export interface ListConversationsParams {
  lastId?: Identifier;
  limit?: number;
  sortBy?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
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

export interface CursorPage<T> {
  limit: number;
  hasMore: boolean;
  data: T[];
}

export interface BatchDeleteConversationsParams {
  conversationIds: Identifier[];
}

export interface BatchDeleteResult {
  deleted: number;
}

export interface RenameConversationParams {
  name: string;
}

export interface ListMessagesParams {
  conversationId: Identifier;
  firstId?: Identifier;
  limit?: number;
}

export interface MessageFile extends Record<string, unknown> {
  id?: string;
  type?: string;
  url?: string;
  name?: string;
  filename?: string;
  upload_file_id?: string;
  file_id?: string;
  mime_type?: string;
  size?: number;
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
  status?: string;
}

export interface SubmitFeedbackParams {
  rating: Feedback["rating"];
  content?: string;
}

export interface SpeechRecognitionResult {
  text: string;
  language: string;
}

export interface RecognizeSpeechByUploadParams {
  filePath: string;
  language?: string;
  timeout?: number;
}

export interface RecognizeSpeechByUrlParams {
  /** 宿主原生录音上传后返回的音频地址 */
  audioUrl: string;
  language?: string;
}

export interface RecognizeSpeechByBase64Params {
  /** Data URL（data:audio/m4a;base64,...）或纯 base64；后者必须同时给 mimeType */
  audioBase64: string;
  mimeType?: string;
  language?: string;
}

export interface UploadChatFileParams {
  filePath: string;
  /**
   * 优先上传的原生 File 对象（H5 形态）：uni-h5 的 uploadFile 会直接用它的
   * 文件名与 MIME 构造 multipart，避免 blob URL 二次转换导致文件名退化。
   */
  file?: File;
  /** 网关要求非空，游客态没有真实用户 ID 时由调用方兜底 */
  user: string;
  fileType?: "image" | "video" | "audio";
  timeout?: number;
}

/**
 * 文件上传接口（项目内 POST /proxy/v1/files/upload，代理 Dify POST /v1/files/upload）响应。
 * Dify 原生字段为 snake_case，网关透传时不带 code/data 包装壳；
 * 图片预览走 GET /files/{file_id}/preview（需鉴权），本响应的 id 即 file_id。
 * 末尾保留旧网关 camelCase 字段作为兼容兜底。
 */
export interface ChatFileUploadResult {
  /** 文件的唯一标识（file_id），预览与引用都靠它 */
  id: string;
  reference?: string | null;
  name: string;
  size: number;
  extension: string;
  mime_type?: string;
  created_by?: string | null;
  created_at?: number | null;
  /** 预览地址（可能为空或需额外鉴权，不作为回显来源） */
  preview_url?: string | null;
  /** 文件源地址：可被服务端拉取，作为发送消息 remote_url 的 url */
  source_url?: string | null;
  original_url?: string | null;
  user_id?: string | null;
  tenant_id?: string | null;
  conversation_id?: string | null;
  file_key?: string | null;
  /** 兼容旧网关 camelCase 形态（仅兜底） */
  fileId?: string;
  mimeType?: string;
  url?: string;
  createdBy?: string;
  createdAt?: number;
}

export interface TextToSpeechResult {
  audioUrl?: string;
  audioBase64?: string;
  format?: string;
}

/** 分句并发合成的实时 TTS 请求。text 传整段回答，后端自行按句切分并并发合成。 */
export interface RealtimeTtsParams {
  text: string;
  language?: string;
}

/**
 * /speech/tts/stream 的 SSE 帧。audio_chunk 的 data 带 seq；done 的 data 形如 { event: "done" }。
 * 某句失败时后端会推占位帧，audioBase64/dataUrl 为 null，前端应跳过该 seq 继续播下一句。
 */
export interface RealtimeTtsChunk {
  seq?: number;
  format?: string | null;
  audioBase64?: string | null;
  dataUrl?: string | null;
  event?: "done";
}

export interface InterruptChatParams {
  taskId: Identifier;
}

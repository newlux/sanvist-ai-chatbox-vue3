import type {
  BatchDeleteConversationsParams,
  BatchDeleteResult,
  BlockingChatMessageResponse,
  ChatFileUploadResult,
  ChatMessage,
  Conversation,
  CursorPage,
  Identifier,
  InterruptChatParams,
  ListConversationsParams,
  ListMessagesParams,
  RecognizeSpeechByBase64Params,
  RecognizeSpeechByUploadParams,
  RecognizeSpeechByUrlParams,
  RenameConversationParams,
  SendChatMessageParams,
  SpeechRecognitionResult,
  SubmitFeedbackParams,
  TextToSpeechResult,
  UploadChatFileParams,
} from "./types";
import { toDifyChatMessagesRequest } from "@/utils/ai-stream/dify";
import { request } from "@/utils/request";

export { consumeTextToSpeechStream } from "./tts-stream";
export type { TtsStreamHandle } from "./tts-stream";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

/** Dify 对 DELETE 同样按 JSON 读取请求体；显式传空对象，避免 WebView 丢失 JSON Content-Type。 */
const jsonDeleteOptions = {
  ...jsonOptions,
  data: {},
};

/** Dify 原生字段使用 snake_case；在 API 边界转换为页面沿用的 camelCase。 */
interface DifyCursorPage<T> {
  limit: number;
  has_more?: boolean;
  hasMore?: boolean;
  data: T[];
}

interface DifyConversation {
  id: Identifier;
  name?: string;
  inputs?: Record<string, unknown>;
  status?: string;
  introduction?: string | null;
  created_at?: number;
  updated_at?: number;
}

interface DifyChatMessage {
  id: Identifier;
  conversation_id?: Identifier;
  conversationId?: Identifier;
  inputs?: Record<string, unknown>;
  query?: string;
  answer?: string;
  message_files?: ChatMessage["messageFiles"];
  /** 兼容部分网关已经转成 camelCase 的返回。 */
  messageFiles?: ChatMessage["messageFiles"];
  /** 部分网关 / 发送回显把附件放在 files，而不是 message_files。 */
  files?: ChatMessage["messageFiles"];
  feedback?: ChatMessage["feedback"];
  retriever_resources?: ChatMessage["retrieverResources"];
  retrieverResources?: ChatMessage["retrieverResources"];
  created_at?: number;
  createdAt?: number;
  status?: string;
}

/** `[]` 在 JS 里是 truthy，不能用 `a || b` 取附件列表。 */
function firstNonEmptyList<T>(...candidates: Array<T[] | undefined | null>): T[] {
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function toConversation(item: DifyConversation): Conversation {
  return {
    id: item.id,
    name: item.name || "",
    inputs: item.inputs || {},
    status: item.status || "normal",
    introduction: item.introduction ?? null,
    createdAt: Number(item.created_at || 0),
    updatedAt: Number(item.updated_at || item.created_at || 0),
  };
}

function toChatMessage(item: DifyChatMessage): ChatMessage {
  return {
    id: item.id,
    conversationId: (item.conversation_id ?? item.conversationId) as ChatMessage["conversationId"],
    inputs: item.inputs || {},
    query: item.query || "",
    answer: item.answer || "",
    messageFiles: firstNonEmptyList(item.message_files, item.messageFiles, item.files),
    feedback: item.feedback || null,
    retrieverResources: item.retriever_resources || item.retrieverResources || [],
    createdAt: Number(item.created_at ?? item.createdAt ?? 0),
    status: item.status,
  };
}

interface DifyBlockingChatMessageResponse {
  answer?: string;
  conversation_id: Identifier;
  message_id: Identifier;
  task_id?: Identifier;
  metadata?: {
    elapsed_time?: number;
  };
}

function toBlockingChatMessageResponse(item: DifyBlockingChatMessageResponse): BlockingChatMessageResponse {
  return {
    answer: item.answer || "",
    conversationId: item.conversation_id,
    messageId: item.message_id,
    taskId: item.task_id,
    metadata: item.metadata
      ? { elapsedTime: Number(item.metadata.elapsed_time) || 0 }
      : undefined,
  };
}

function toCursorPage<T, R>(page: DifyCursorPage<T>, mapper: (item: T) => R): CursorPage<R> {
  return {
    limit: Number(page?.limit || 0),
    hasMore: Boolean(page?.has_more ?? page?.hasMore),
    data: Array.isArray(page?.data) ? page.data.map(mapper) : [],
  };
}

export function interruptChat(params: InterruptChatParams) {
  return request.post<null>(`/proxy/v1/chat-messages/${params.taskId}/stop`, {}, jsonOptions).json();
}

/** Dify blocking 模式一次性返回完整回答。 */
export function sendBlockingChatMessage(params: SendChatMessageParams) {
  return request
    .post<DifyBlockingChatMessageResponse>(
      "/proxy/v1/chat-messages",
      toDifyChatMessagesRequest({ ...params, responseMode: "blocking" }),
      jsonOptions,
    )
    .json()
    .then(toBlockingChatMessageResponse);
}

export function getConversations(params: ListConversationsParams) {
  // Dify 标准：GET /v1/conversations?user=&last_id=&limit=&sort_by=
  return request.get<DifyCursorPage<DifyConversation>>("/proxy/v1/conversations", {
    last_id: params.lastId,
    limit: params.limit,
    sort_by: params.sortBy,
  }).json().then(page => toCursorPage(page, toConversation));
}

export function deleteConversation(conversationId: Identifier) {
  return request.delete<null>(`/proxy/v1/conversations/${conversationId}`, jsonDeleteOptions).json();
}

export async function batchDeleteConversations(params: BatchDeleteConversationsParams): Promise<BatchDeleteResult> {
  // Dify 没有批量删除会话接口，保留原有批量操作体验，逐条调用标准 DELETE 接口。
  await Promise.all(params.conversationIds.map(conversationId => (
    deleteConversation(conversationId)
  )));
  return { deleted: params.conversationIds.length };
}

export function renameConversation(conversationId: Identifier, params: RenameConversationParams) {
  return request.post<null>(`/proxy/v1/conversations/${conversationId}/name`, {
    name: params.name,
  }, jsonOptions).json();
}

export function getMessages(params: ListMessagesParams) {
  return request.get<DifyCursorPage<DifyChatMessage>>("/proxy/v1/messages", {
    conversation_id: params.conversationId,
    first_id: params.firstId,
    limit: params.limit,
  }).json().then(page => toCursorPage(page, toChatMessage));
}

/**
 * 消息详情：返回单条消息对象（不带分页壳），query 的 conversationId 必填。
 * 用于实时 TTS 从服务端取权威 answer 文本。
 */
export function getMessage(messageId: Identifier, params: { conversationId: Identifier }) {
  return request.get<ChatMessage>(`/messages/${messageId}`, params).json();
}

export function submitFeedback(messageId: Identifier, params: SubmitFeedbackParams) {
  // Dify 标准：POST /v1/messages/{message_id}/feedbacks
  return request.post<null>(`/proxy/v1/messages/${messageId}/feedbacks`, {
    rating: params.rating,
    content: params.content || "",
  }, jsonOptions).json();
}

export function cancelFeedback(messageId: Identifier) {
  // Dify 标准：DELETE /v1/messages/{message_id}/feedbacks?user={user}
  return request.delete<null>(`/proxy/v1/messages/${messageId}/feedbacks`, jsonDeleteOptions).json();
}

/**
 * 录音文件直传识别。相比 base64 通道少一次整文件编码，
 * 也绕开了小程序对 JSON 请求体体积的限制。
 * 契约：multipart 字段名固定为 `file`，language 走 query。
 */
export function getTextToSpeech(conversationId: Identifier, messageId: Identifier) {
  return request.get<TextToSpeechResult>(`/chat/tts/${conversationId}/${messageId}`).json();
}

/**
 * 对话附件上传。契约：multipart 字段名固定为 `file`，`user` 走表单字段且不能为空。
 * 返回的 id 作为 Dify `/chat-messages` 的 files[].upload_file_id
 *（transfer_method=local_file）。
 */
export function uploadChatFile(params: UploadChatFileParams) {
  return request.upload<ChatFileUploadResult>("/proxy/v1/files/upload", {
    filePath: params.filePath,
    file: params.file,
    name: "file",
    fileType: params.fileType || "image",
    formData: { user: params.user },
    timeout: params.timeout,
  }).json();
}

/**
 * 按音频地址识别。原生录音（microphoneEnd）已经把文件传好了，只会给回一个 URL，
 * 这时候没有本地文件可传，走这个接口。
 */
export function recognizeSpeechByUrl(params: RecognizeSpeechByUrlParams) {
  return request.post<SpeechRecognitionResult>("/speech/asr", {
    audioUrl: params.audioUrl,
    ...(params.language ? { language: params.language } : {}),
  }, jsonOptions).json();
}

/**
 * 按 base64 识别。宿主原生录音直接回传音频内容（而不是地址）时走这条。
 * 纯 base64 必须带 mimeType，Data URL 形式则可省略。
 */
export function recognizeSpeechByBase64(params: RecognizeSpeechByBase64Params) {
  return request.post<SpeechRecognitionResult>("/speech/asr/base64", {
    audioBase64: params.audioBase64,
    ...(params.mimeType ? { mimeType: params.mimeType } : {}),
    ...(params.language ? { language: params.language } : {}),
  }, jsonOptions).json();
}

export function recognizeSpeechByUpload(params: RecognizeSpeechByUploadParams) {
  const query = params.language ? `?language=${encodeURIComponent(params.language)}` : "";
  return request.upload<SpeechRecognitionResult>(`/speech/asr/upload${query}`, {
    filePath: params.filePath,
    name: "file",
    fileType: "audio",
    timeout: params.timeout,
  }).json();
}

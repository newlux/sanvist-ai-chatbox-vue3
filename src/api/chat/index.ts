import type {
  BatchDeleteConversationsParams,
  BatchDeleteResult,
  CancelFeedbackParams,
  ChatFileUploadResult,
  ChatMessage,
  Conversation,
  CosPresignedUrlVO,
  CursorPage,
  DeleteConversationParams,
  Identifier,
  InterruptChatParams,
  ListConversationsParams,
  ListMessagesParams,
  RecognizeSpeechByBase64Params,
  RecognizeSpeechByUploadParams,
  RecognizeSpeechByUrlParams,
  RenameConversationParams,
  SpeechRecognitionResult,
  SubmitFeedbackParams,
  TextToSpeechResult,
  UploadChatFileParams,
} from "./types";
import { request } from "@/utils/request";

export { consumeTextToSpeechStream } from "./tts-stream";
export type { TtsStreamHandle } from "./tts-stream";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

export function interruptChat(params: InterruptChatParams) {
  return request.post<null>(`/proxy/v1/chat-messages/${params.taskId}/stop`, {}, jsonOptions).json();
}

export function getConversations(params: ListConversationsParams) {
  return request.get<CursorPage<Conversation>>("/conversations", params).json();
}

export function deleteConversation(conversationId: Identifier, params: DeleteConversationParams) {
  return request.delete<null, DeleteConversationParams>(`/conversations/${conversationId}`, {
    ...jsonOptions,
    data: params,
  }).json();
}

export function batchDeleteConversations(params: BatchDeleteConversationsParams) {
  return request.delete<BatchDeleteResult, BatchDeleteConversationsParams>("/conversations", {
    ...jsonOptions,
    data: params,
  }).json();
}

export function renameConversation(conversationId: Identifier, params: RenameConversationParams) {
  return request.post<null>(`/conversations/${conversationId}/name`, params, jsonOptions).json();
}

export function getMessages(params: ListMessagesParams) {
  return request.get<CursorPage<ChatMessage>>("/messages", params).json();
}

/**
 * 消息详情：返回单条消息对象（不带分页壳），query 的 conversationId 必填。
 * 用于实时 TTS 从服务端取权威 answer 文本。
 */
export function getMessage(messageId: Identifier, params: { conversationId: Identifier }) {
  return request.get<ChatMessage>(`/messages/${messageId}`, params).json();
}

export function submitFeedback(messageId: Identifier, params: SubmitFeedbackParams) {
  return request.post<null>(`/messages/${messageId}/feedbacks`, params, jsonOptions).json();
}

export function cancelFeedback(messageId: Identifier, params: CancelFeedbackParams) {
  return request.delete<null, CancelFeedbackParams>(`/messages/${messageId}/feedbacks`, {
    ...jsonOptions,
    data: params,
  }).json();
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
 * 返回的 url 直接作为 Dify `/chat-messages` 的 files[].url（transfer_method=remote_url）。
 */
export function uploadChatFile(params: UploadChatFileParams) {
  return request.upload<ChatFileUploadResult>("/files/upload", {
    filePath: params.filePath,
    name: "file",
    fileType: params.fileType || "image",
    formData: { user: params.user },
    timeout: params.timeout,
  }).json();
}

/**
 * 获取 COS 下载/读取预签名 URL。
 * 上传返回的 url 可能带 Content-Disposition: attachment 导致无法内联预览，
 * 前端用 objectKey 换预签名地址用于图片预览/下载。
 */
export function getCosPresignedDownloadUrl(objectKey: string) {
  // 该服务与主对话 API 不同域、不同前缀：固定走
  // https://sanvist-api-test.sany.com.cn/ 网关（/hfle 服务前缀），
  // 不随宿主注入的 baseUrl / setRequestBaseURL 变化
  // 登录凭证（Authorization）由 request 层统一注入：App.vue 启动时通过 setRequestAuth 写入，
  // getRequestHeaders 会自动带上，这里无需重复声明
  return request.get<CosPresignedUrlVO>("/hfle/v1/cos/presigned/download", { objectKey }, {
    baseURL: "https://sanvist-api-test.sany.com.cn/",
    headers: { Accept: "application/json" },
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

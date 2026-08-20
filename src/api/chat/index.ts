import type {
  BatchDeleteConversationsParams,
  BatchDeleteResult,
  CancelFeedbackParams,
  ChatFileUploadResult,
  ChatMessage,
  Conversation,
  CursorPage,
  DeleteConversationParams,
  Identifier,
  InterruptChatParams,
  ListConversationsParams,
  ListMessagesParams,
  RecognizeSpeechByUploadParams,
  RenameConversationParams,
  SpeechRecognitionResult,
  SubmitFeedbackParams,
  TextToSpeechResult,
  UploadChatFileParams,
} from "./types";
import { request } from "@/utils/request";

const jsonOptions = {
  headers: {
    "Content-Type": "application/json",
  },
};

export function interruptChat(params: InterruptChatParams) {
  return request.post<null>("/chat/interrupt", params, jsonOptions).json();
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
 * 返回的 url 直接作为 /chat/send 的 files[].url（transferMethod=remote_url）。
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

export function recognizeSpeechByUpload(params: RecognizeSpeechByUploadParams) {
  const query = params.language ? `?language=${encodeURIComponent(params.language)}` : "";
  return request.upload<SpeechRecognitionResult>(`/speech/asr/upload${query}`, {
    filePath: params.filePath,
    name: "file",
    fileType: "audio",
    timeout: params.timeout,
  }).json();
}

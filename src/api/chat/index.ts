import type {
  AudioBase64Result,
  CancelFeedbackParams,
  ChatMessage,
  Conversation,
  ConversationDetail,
  CreateAudioBase64Params,
  CursorPage,
  DeleteConversationParams,
  Feedback,
  GetConversationParams,
  GetFeedbackParams,
  GetMessageParams,
  GetTextToSpeechResult,
  Identifier,
  InterruptChatParams,
  ListConversationsParams,
  ListMessagesParams,
  RecognizeSpeechByBase64Params,
  RecognizeSpeechByUploadParams,
  RecognizeSpeechByUrlParams,
  SpeechRecognitionResult,
  SubmitFeedbackParams,
  TextToSpeechResult,
  UploadedFile,
  UploadFileParams,
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

export function getConversation(conversationId: Identifier, params: GetConversationParams) {
  return request.get<ConversationDetail>(`/conversations/${conversationId}`, params).json();
}

export function deleteConversation(conversationId: Identifier, params: DeleteConversationParams) {
  return request.delete<null, DeleteConversationParams>(`/conversations/${conversationId}`, {
    ...jsonOptions,
    data: params,
  }).json();
}

export function getMessages(params: ListMessagesParams) {
  return request.get<CursorPage<ChatMessage>>("/messages", params).json();
}

export function getMessage(messageId: Identifier, params: GetMessageParams) {
  return request.get<ChatMessage>(`/messages/${messageId}`, params).json();
}

export function getFeedback(messageId: Identifier, params: GetFeedbackParams) {
  return request.get<Feedback>(`/messages/${messageId}/feedbacks`, params).json();
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

export function uploadFile(params: UploadFileParams) {
  return request.upload<UploadedFile>("/files/upload", {
    filePath: params.filePath,
    name: params.name || "file",
    formData: { user: params.user || "" },
  }).json();
}

export function recognizeSpeechByUrl(params: RecognizeSpeechByUrlParams) {
  return request.post<SpeechRecognitionResult>("/speech/asr", params, jsonOptions).json();
}

export function recognizeSpeechByBase64(params: RecognizeSpeechByBase64Params) {
  return request.post<SpeechRecognitionResult>("/speech/asr/base64", params, jsonOptions).json();
}

export function recognizeSpeechByUpload(params: RecognizeSpeechByUploadParams) {
  return request.upload<SpeechRecognitionResult>("/speech/asr/upload", {
    filePath: params.filePath,
    name: params.name || "file",
    formData: params.language ? { language: params.language } : undefined,
  }).json();
}

export function getAudioBase64(params: CreateAudioBase64Params) {
  return request.post<AudioBase64Result>("/speech/audio/base64", params, jsonOptions).json();
}

export function testTextToSpeech(text: string) {
  return request.post<TextToSpeechResult>("/speech/tts/test", { text }, jsonOptions).json();
}

export function getTextToSpeech(conversationId: Identifier, messageId: Identifier) {
  return request.get<GetTextToSpeechResult>(`/chat/tts/${conversationId}/${messageId}`).json();
}

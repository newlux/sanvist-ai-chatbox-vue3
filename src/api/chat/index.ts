import type {
  AudioBase64Result,
  CancelFeedbackParams,
  ChatMessage,
  ChatStreamEvent,
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
  SendChatMessageParams,
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

function unwrapData<T>(response: { data: T }) {
  return response.data;
}

export function sendChatMessage(params: SendChatMessageParams) {
  return request
    .post("chat/send", {
      ...params,
      responseMode: "streaming",
    }, jsonOptions)
    .stream<ChatStreamEvent>();
}

export function interruptChat(params: InterruptChatParams) {
  return request.post<null>("chat/interrupt", params, jsonOptions).json().then(unwrapData);
}

export function getConversations(params: ListConversationsParams) {
  return request.get<CursorPage<Conversation>>("conversations", params).json().then(unwrapData);
}

export function getConversation(conversationId: Identifier, params: GetConversationParams) {
  return request.get<ConversationDetail>(`conversations/${conversationId}`, params).json().then(unwrapData);
}

export function deleteConversation(conversationId: Identifier, params: DeleteConversationParams) {
  return request.delete<null, DeleteConversationParams>(`conversations/${conversationId}`, {
    ...jsonOptions,
    data: params,
  }).json().then(unwrapData);
}

export function getMessages(params: ListMessagesParams) {
  return request.get<CursorPage<ChatMessage>>("messages", params).json().then(unwrapData);
}

export function getMessage(messageId: Identifier, params: GetMessageParams) {
  return request.get<ChatMessage>(`messages/${messageId}`, params).json().then(unwrapData);
}

export function getFeedback(messageId: Identifier, params: GetFeedbackParams) {
  return request.get<Feedback>(`messages/${messageId}/feedbacks`, params).json().then(unwrapData);
}

export function submitFeedback(messageId: Identifier, params: SubmitFeedbackParams) {
  return request.post<null>(`messages/${messageId}/feedbacks`, params, jsonOptions).json().then(unwrapData);
}

export function cancelFeedback(messageId: Identifier, params: CancelFeedbackParams) {
  return request.delete<null, CancelFeedbackParams>(`messages/${messageId}/feedbacks`, {
    ...jsonOptions,
    data: params,
  }).json().then(unwrapData);
}

export function uploadFile(params: UploadFileParams) {
  const formData = new FormData();
  formData.append("file", params.file);
  formData.append("user", params.user);

  return request.upload<UploadedFile>("files/upload", formData).json().then(unwrapData);
}

export function recognizeSpeechByUrl(params: RecognizeSpeechByUrlParams) {
  return request.post<SpeechRecognitionResult>("speech/asr", params, jsonOptions).json().then(unwrapData);
}

export function recognizeSpeechByBase64(params: RecognizeSpeechByBase64Params) {
  return request.post<SpeechRecognitionResult>("speech/asr/base64", params, jsonOptions).json().then(unwrapData);
}

export function recognizeSpeechByUpload(params: RecognizeSpeechByUploadParams) {
  const formData = new FormData();
  formData.append("file", params.file);
  if (params.language) {
    formData.append("language", params.language);
  }

  return request.upload<SpeechRecognitionResult>("speech/asr/upload", formData).json().then(unwrapData);
}

export function getAudioBase64(params: CreateAudioBase64Params) {
  return request.post<AudioBase64Result>("speech/audio/base64", params, jsonOptions).json().then(unwrapData);
}

export function testTextToSpeech(text: string) {
  return request.post<TextToSpeechResult>("speech/tts/test", { text }, jsonOptions).json().then(unwrapData);
}

export function getTextToSpeech(conversationId: Identifier, messageId: Identifier) {
  return request.get<GetTextToSpeechResult>(`chat/tts/${conversationId}/${messageId}`).json().then(unwrapData);
}

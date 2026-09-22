export interface GetConversationSummaryParams {
  aiAskConversationId: string;
  aiAskSessionId: string;
}

/** 接口响应结构待后端协议确认，调用方按实际字段消费。 */
export type ConversationSummary = Record<string, unknown>;

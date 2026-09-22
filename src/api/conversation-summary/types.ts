export interface GetConversationSummaryParams {
  aiAskConversationId: string;
  aiAskSessionId: string;
}

export interface ConversationSummaryData {
  problem?: string;
  conclusion?: string;
  treatment?: string;
  status?: string;
  equipmentCategory?: string | null;
  model?: string | null;
  deviceId?: string | null;
}

export type ConversationSummary = ConversationSummaryData;

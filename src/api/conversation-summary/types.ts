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
  /** 维修助手侧会话 ID，用于打开对应的诊断详情。 */
  repairConversationId?: string | null;
}

export type ConversationSummary = ConversationSummaryData;
